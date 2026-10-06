import { Hono } from 'hono'
import { MAX_MEDIA_FILENAME_LENGTH, MEDIA_KINDS } from '../lib/constants'
import { notFound, validationError } from '../lib/errors'
import { noContent, ok } from '../lib/http'
import { servableKeyFrom } from '../lib/media'
import { readEnum, readString } from '../lib/params'
import {
  requireActiveAccount,
  requirePasswordSettled,
  requireUnimpersonated,
} from '../middleware/auth'
import { rateLimit } from '../middleware/rate-limit'
import { createMediaAsset, deleteMediaAsset } from '../services/media.service'
import { actorInfoOf } from '../services/user.service'
import { currentUser } from './helpers'
import type { AppEnv } from '../types'

// ============================================================================
// /api/v1/media — upload (R1.3), delete, and serve.
//
// Three routes, two of them deliberate departures from every other file here.
//
// **1. `GET /*` is public and unguarded.** An avatar is rendered on a public page
// (R1.7), and a browser loading an `<img>` brings no cookie flow of its own, so
// anything that fetched it would have to be open anyway. Nothing leaks by being
// open, because the WHITELIST decides: `servableKeyFrom` returns a key only for the
// two public roots and the four image extensions, so a key naming private evidence
// — or anything this API did not mint — is a plain `404`. Maintenance mode does not
// cover it either: a visitor's avatar should not vanish because the console is
// closed for upgrades.
//
// It is matched as `/*` rather than `/:key` on purpose: a key has THREE segments
// (`avatars/{userId}/{ulid}.webp`), so a single-segment param could never match one.
// The key is read from the path and whitelisted, never taken on trust from the
// router's idea of what a path segment is.
//
// **2. `POST /` takes RAW BYTES, not a JSON envelope.** It is the one endpoint in
// this API whose body is not JSON, which is why it reads `c.req.arrayBuffer()`
// itself instead of going through `readJson`. `kind` and `filename` ride in the
// query string because the body is the file and cannot carry anything else.
//
// Guards compose exactly as on `PATCH /auth/me`, in this order: active account,
// password settled, not impersonated, rate limit, and only then the body. The
// impersonation guard matters more here than anywhere else — without it a support
// session could upload content as the account it is acting for.
//
// `DELETE /:id` carries no rate limit of its own: it is cheap, it is guarded by
// ownership (a foreign id is a `404`), and the one rule that exists for media
// (`media_upload_user`) is about the expensive half of the surface.
// ============================================================================

export const mediaRoutes = new Hono<AppEnv>()

const uploadLimit = rateLimit('media_upload_user')

// ------------------------------------------------------------------- serve --

mediaRoutes.get('/*', async (c) => {
  const key = servableKeyFrom(c.req.path)
  if (key === null) throw notFound('Media asset')

  // `onlyIf` lets R2 answer a conditional request itself — a `304` with no body is
  // the cheap path for an object the browser already holds.
  const object = await c.env.PUBLIC_BUCKET.get(key, { onlyIf: c.req.raw.headers })
  if (object === null) throw notFound('Media asset')

  const headers = new Headers()
  // Content type and cache headers come from the object's OWN metadata, the values
  // `bucket.put` stored, so what is served and what was written are one decision
  // rather than two that could drift.
  object.writeHttpMetadata(headers)
  headers.set('etag', object.httpEtag)

  // A conditional request that matched comes back as an `R2Object`: all headers, no
  // body. `body` is what tells the two apart, and its absence IS the `304`.
  if (!('body' in object)) return new Response(null, { status: 304, headers })
  return new Response(object.body, { headers })
})

// ------------------------------------------------------------------ upload --

mediaRoutes.post(
  '/',
  requireActiveAccount,
  requirePasswordSettled,
  requireUnimpersonated,
  uploadLimit,
  async (c) => {
    const kind = readEnum(c, 'kind', MEDIA_KINDS)
    if (kind === undefined) {
      // A missing `kind` is a body-shaped problem rather than a bad query value,
      // which is why `readEnum`'s own refusal (a `400` for garbage) is not the one
      // raised here.
      throw validationError(`A "kind" of ${MEDIA_KINDS.join(' or ')} is required.`)
    }

    const asset = await createMediaAsset(
      c.env.DB,
      c.env.PUBLIC_BUCKET,
      actorInfoOf(currentUser(c)),
      {
        kind,
        // A label, bounded here so a megabyte of "filename" never reaches a row.
        filename: readString(c, 'filename', MAX_MEDIA_FILENAME_LENGTH) ?? null,
        bytes: new Uint8Array(await c.req.arrayBuffer()),
        declaredType: c.req.header('content-type') ?? null,
      },
      c.get('auditor'),
    )

    // `201`, and no `Location`: the response carries the `url` the object is served
    // at, but that URL is not the resource this endpoint created — the ASSET is,
    // and its id is in the body.
    return ok(c, asset, { status: 201 })
  },
)

// ------------------------------------------------------------------ delete --

mediaRoutes.delete(
  '/:id',
  requireActiveAccount,
  requirePasswordSettled,
  requireUnimpersonated,
  async (c) => {
    await deleteMediaAsset(
      c.env.DB,
      c.env.PUBLIC_BUCKET,
      actorInfoOf(currentUser(c)),
      c.req.param('id'),
      c.get('auditor'),
    )
    return noContent(c)
  },
)

