import { beforeEach, describe, expect, it } from 'vitest'
import { env } from 'cloudflare:workers'
import { MAX_BODY_BYTES, app } from '../src/app'
import { MAX_MEDIA_BYTES, MAX_MEDIA_DIMENSION, MAX_MEDIA_FILENAME_LENGTH } from '../src/lib/constants'
import { ULID_REGEX, ulid } from '../src/lib/ids'
import { AVATAR_KEY_PATTERN, mediaUrlFor } from '../src/lib/media'
import { invalidateRateLimitCache } from '../src/middleware/rate-limit'
import { SETTING_KEYS } from '../src/services/settings.service'
import type { ApiUser } from '../src/types'
import {
  TEST_PASSWORD,
  api,
  apiBytes,
  countRows,
  createTestUser,
  impersonatedCookieFor,
  loginAs,
  resetIsolateCaches,
  setSettingValue,
  type ApiResult,
  type Envelope,
  type ErrorEnvelope,
} from './helpers'

// ============================================================================
// R1.3 — /api/v1/media.
//
// The bytes in these tests are built by hand rather than shipped as fixtures,
// because the whole point of the route is that it reads the FILE and not the
// request: a fixture file would let a test pass by agreeing with itself. Each
// builder below writes exactly the header the sniff in `lib/image.ts` reads, and
// nothing else — `sniffImage` needs a signature and dimensions, and a real encoder
// would only add bytes no assertion here could see.
// ============================================================================

interface MediaAssetDto {
  id: string
  key: string
  url: string
  width: number
  height: number
  bytes: number
}

const writeU16be = (b: Uint8Array, o: number, v: number): void => {
  b[o] = (v >>> 8) & 0xff
  b[o + 1] = v & 0xff
}
const writeU16le = (b: Uint8Array, o: number, v: number): void => {
  b[o] = v & 0xff
  b[o + 1] = (v >>> 8) & 0xff
}
const writeU24le = (b: Uint8Array, o: number, v: number): void => {
  b[o] = v & 0xff
  b[o + 1] = (v >>> 8) & 0xff
  b[o + 2] = (v >>> 16) & 0xff
}
const writeU32be = (b: Uint8Array, o: number, v: number): void => {
  b[o] = (v >>> 24) & 0xff
  b[o + 1] = (v >>> 16) & 0xff
  b[o + 2] = (v >>> 8) & 0xff
  b[o + 3] = v & 0xff
}

/** `\x89PNG\r\n\x1a\n`, an `IHDR` chunk header, then width and height at 16 and 20. */
function png(width: number, height: number): Uint8Array {
  const bytes = new Uint8Array(24)
  bytes.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a], 0)
  bytes.set([0x49, 0x48, 0x44, 0x52], 12)
  writeU32be(bytes, 16, width)
  writeU32be(bytes, 20, height)
  return bytes
}

/** `GIF89a` and the logical screen descriptor: both dimensions little-endian. */
function gif(width: number, height: number): Uint8Array {
  const bytes = new Uint8Array(10)
  bytes.set([0x47, 0x49, 0x46, 0x38, 0x39, 0x61], 0)
  writeU16le(bytes, 6, width)
  writeU16le(bytes, 8, height)
  return bytes
}

/** A minimal JPEG: `SOI`, then a `SOF0` segment stating height and width. */
function jpeg(width: number, height: number): Uint8Array {
  const bytes = new Uint8Array(11)
  bytes.set([0xff, 0xd8, 0xff, 0xc0, 0x00, 0x11, 0x08], 0)
  writeU16be(bytes, 7, height)
  writeU16be(bytes, 9, width)
  return bytes
}

/** A RIFF container with the extended (`VP8X`) header, which states the canvas. */
function webp(width: number, height: number): Uint8Array {
  const bytes = new Uint8Array(30)
  bytes.set([0x52, 0x49, 0x46, 0x46], 0)
  bytes.set([0x57, 0x45, 0x42, 0x50], 8)
  bytes.set([0x56, 0x50, 0x38, 0x58], 12)
  writeU24le(bytes, 24, width - 1)
  writeU24le(bytes, 27, height - 1)
  return bytes
}

const errorOf = (result: ApiResult<unknown>): ErrorEnvelope => result.body as ErrorEnvelope

/** Uploads bytes the way a browser would, with `kind` and `filename` in the query. */
function upload(
  cookie: string | null,
  options: {
    bytes: Uint8Array
    kind?: string
    filename?: string
    contentType?: string | null
  },
): Promise<ApiResult<Envelope<MediaAssetDto>>> {
  const params = new URLSearchParams()
  if (options.kind !== undefined) params.set('kind', options.kind)
  if (options.filename !== undefined) params.set('filename', options.filename)

  return apiBytes<Envelope<MediaAssetDto>>('POST', `/api/v1/media?${params}`, {
    bytes: options.bytes,
    contentType: options.contentType === undefined ? 'image/png' : options.contentType,
    cookie,
  })
}

/**
 * Fetches a served object the way a browser does: no cookie, and the bytes read
 * back whole so they can be compared with what went in.
 */
async function fetchObject(url: string) {
  const response = await app.request(`http://localhost${url}`, {}, env)
  return {
    status: response.status,
    headers: response.headers,
    bytes: new Uint8Array(await response.arrayBuffer()),
  }
}

/** Uploads an avatar for a signed-in user and hands back the DTO. */
async function uploadAvatar(cookie: string, bytes = png(512, 512)): Promise<MediaAssetDto> {
  const result = await upload(cookie, { bytes, kind: 'avatar', filename: 'portrait.png' })
  expect(result.status).toBe(201)
  return result.body.data
}

/**
 * The keys in the public bucket right now.
 *
 * `resetDatabase` (test/apply-migrations.ts) empties D1 between tests but R2 is
 * Miniflare storage that outlives that hook, so a refused upload cannot be proven
 * by the bucket being empty — only by the bucket not having GROWN.
 */
async function storedKeys(): Promise<string[]> {
  const { objects } = await env.PUBLIC_BUCKET.list()
  return objects.map((object) => object.key).sort()
}

async function auditsFor(action: string) {
  const { results } = await env.DB.prepare(
    `SELECT target_id, actor_user_id, metadata, before
       FROM audit_logs WHERE action = ? ORDER BY created_at ASC, id ASC`,
  )
    .bind(action)
    .all<{ target_id: string; actor_user_id: string; metadata: string; before: string | null }>()
  return results
}

/** The `user.profile_update` audit rows, oldest first — the avatar trail. */
async function profileAudits() {
  const { results } = await env.DB.prepare(
    `SELECT before, after FROM audit_logs
      WHERE action = 'user.profile_update' ORDER BY created_at ASC, id ASC`,
  ).all<{ before: string | null; after: string | null }>()
  return results
}

/** `PATCH /api/v1/auth/me` — the one write every account holds. */
function updateProfile(cookie: string, body: Record<string, unknown>) {
  // `{ user }`, not the bare user: the route answers with the same envelope shape
  // `GET /me` returns (`routes/auth.ts`), so the SPA can swap the session user.
  return api<Envelope<{ user: ApiUser }>>('PATCH', '/api/v1/auth/me', { body, cookie })
}

/** Flips one seeded rate-limit rule; the rule cache is per isolate. */
async function setRateLimit(
  key: string,
  patch: { maxRequests: number; action: string },
): Promise<void> {
  await env.DB.prepare('UPDATE rate_limits SET max_requests = ?, action = ? WHERE key = ?')
    .bind(patch.maxRequests, patch.action, key)
    .run()
  invalidateRateLimitCache()
}

beforeEach(async () => {
  resetIsolateCaches()

  // The two pieces of platform state this file's own tests move. Both are PUT BACK
  // rather than assumed untouched: vitest isolates storage per test FILE, not per
  // test, so the maintenance switch and the media rule would otherwise follow a test
  // into every test that runs after it.
  await setSettingValue(SETTING_KEYS.maintenanceMode, 'false')
  await setRateLimit('media_upload_user', { maxRequests: 60, action: 'throttle' })
})

describe('POST /api/v1/media', () => {
  it('requires a session', async () => {
    const result = await upload(null, { bytes: png(64, 64), kind: 'avatar' })
    expect(result.status).toBe(401)
    expect(errorOf(result).error.code).toBe('UNAUTHENTICATED')
    expect(await countRows('SELECT COUNT(*) AS total FROM media_assets')).toBe(0)
  })

  it('stores the bytes under a minted key and answers the object it created', async () => {
    const user = await createTestUser()
    const cookie = await loginAs(user)
    const bytes = png(512, 384)

    const result = await upload(cookie, { bytes, kind: 'avatar', filename: 'portrait.png' })

    expect(result.status).toBe(201)
    const asset = result.body.data
    expect(asset.id).toMatch(ULID_REGEX)
    expect(asset.key).toMatch(AVATAR_KEY_PATTERN)
    expect(asset.key.startsWith(`avatars/${user.id}/`)).toBe(true)
    expect(asset.key.endsWith('.png')).toBe(true)
    expect(asset.url).toBe(mediaUrlFor(asset.key))
    expect(asset.bytes).toBe(bytes.byteLength)
    expect(asset.width).toBe(512)
    expect(asset.height).toBe(384)

    // The object really is in the bucket, served with the type the SNIFF decided...
    const served = await fetchObject(asset.url)
    expect(served.status).toBe(200)
    expect(served.headers.get('content-type')).toBe('image/png')
    expect(served.headers.get('cache-control')).toContain('immutable')
    expect(served.bytes).toEqual(bytes)

    // ...and the row describes the same thing, checksum included.
    const row = await env.DB.prepare(
      `SELECT owner_user_id, kind, mime, size_bytes, width, height, checksum, status
         FROM media_assets WHERE id = ?`,
    )
      .bind(asset.id)
      .first<Record<string, unknown>>()
    expect(row).toMatchObject({
      owner_user_id: user.id,
      kind: 'avatar',
      mime: 'image/png',
      size_bytes: bytes.byteLength,
      width: 512,
      height: 384,
      status: 'active',
    })
    expect(row?.checksum).toMatch(/^[0-9a-f]{64}$/)

    // One audit row, written by the handler. The middleware would have logged
    // something either way, so this asserts the entry the route MEANT to write:
    // the object's key and the format facts a later investigation would need.
    const audits = await auditsFor('media.upload')
    expect(audits).toHaveLength(1)
    expect(audits[0]?.target_id).toBe(asset.id)
    expect(audits[0]?.actor_user_id).toBe(user.id)
    expect(JSON.parse(audits[0]?.metadata ?? '{}')).toMatchObject({
      kind: 'avatar',
      key: asset.key,
      mime: 'image/png',
      filename: 'portrait.png',
      declaredType: 'image/png',
    })
  })

  it('puts a page_image under its own prefix, which no avatar key can name', async () => {
    const user = await createTestUser()
    const cookie = await loginAs(user)

    const result = await upload(cookie, {
      bytes: gif(64, 48),
      kind: 'page_image',
      contentType: 'image/gif',
    })

    expect(result.status).toBe(201)
    expect(result.body.data.key.startsWith(`page-images/${user.id}/`)).toBe(true)
    expect(result.body.data.key.endsWith('.gif')).toBe(true)
    // The avatar whitelist is a prefix, not a shape: a page image can never be
    // named as somebody's avatar, however well formed its key is.
    expect(result.body.data.key).not.toMatch(AVATAR_KEY_PATTERN)
  })

  it('believes the bytes over the declared type', async () => {
    const user = await createTestUser()
    const cookie = await loginAs(user)

    // A PNG that claims to be a GIF. The claim is the client's, so the sniff wins:
    // stored, named and served as what it actually is.
    const result = await upload(cookie, {
      bytes: png(32, 32),
      kind: 'avatar',
      contentType: 'image/gif',
    })

    expect(result.status).toBe(201)
    expect(result.body.data.key.endsWith('.png')).toBe(true)
    expect((await fetchObject(result.body.data.url)).headers.get('content-type')).toBe('image/png')
    expect(
      await env.DB.prepare('SELECT mime FROM media_assets WHERE id = ?')
        .bind(result.body.data.id)
        .first<{ mime: string }>(),
    ).toMatchObject({ mime: 'image/png' })
  })

  it('accepts an upload that declares no type at all', async () => {
    const user = await createTestUser()
    const cookie = await loginAs(user)

    const result = await upload(cookie, { bytes: jpeg(200, 100), kind: 'avatar', contentType: null })

    expect(result.status).toBe(201)
    expect(result.body.data.key.endsWith('.jpg')).toBe(true)
    expect(result.body.data.width).toBe(200)
    expect(result.body.data.height).toBe(100)
  })

  it('reads a WebP canvas from the extended header', async () => {
    const user = await createTestUser()
    const cookie = await loginAs(user)

    const result = await upload(cookie, {
      bytes: webp(600, 600),
      kind: 'avatar',
      contentType: 'image/webp',
    })

    expect(result.status).toBe(201)
    expect(result.body.data).toMatchObject({ width: 600, height: 600 })
  })

  it('keeps the filename out of the key, bounded, and on the audit row', async () => {
    const user = await createTestUser()
    const cookie = await loginAs(user)
    const filename = 'a'.repeat(MAX_MEDIA_FILENAME_LENGTH + 40)

    const result = await upload(cookie, { bytes: png(8, 8), kind: 'avatar', filename })

    expect(result.status).toBe(201)
    // A filename is a label a client chose. Nothing in the object's identity is
    // allowed to depend on it, so the key is minted from the owner and the row id.
    expect(result.body.data.key).not.toContain('a'.repeat(20))

    const audits = await auditsFor('media.upload')
    expect(JSON.parse(audits[0]?.metadata ?? '{}')).toMatchObject({
      filename: 'a'.repeat(MAX_MEDIA_FILENAME_LENGTH),
    })
  })

  it('refuses bytes that are not an image, even when nothing is declared', async () => {
    const user = await createTestUser()
    const cookie = await loginAs(user)
    const before = await storedKeys()

    const result = await upload(cookie, {
      bytes: new TextEncoder().encode('<html>definitely not a picture</html>'),
      kind: 'avatar',
      contentType: null,
    })

    expect(result.status).toBe(422)
    expect(errorOf(result).error.code).toBe('VALIDATION_ERROR')
    expect(errorOf(result).error.message).toContain('not a WebP, PNG, JPEG or GIF')
    // Refused before anything was stored — both halves of "stored" stayed put.
    expect(await countRows('SELECT COUNT(*) AS total FROM media_assets')).toBe(0)
    expect(await storedKeys()).toEqual(before)
  })

  it('refuses a declared type that is not an image', async () => {
    const user = await createTestUser()
    const cookie = await loginAs(user)

    // The declared type is a claim, and it is a claim about FORMAT: a client that
    // says "text/html" is telling us it did not send a picture. Saying so is more
    // useful than sniffing and reporting the weaker "not an image".
    const result = await upload(cookie, {
      bytes: png(16, 16),
      kind: 'avatar',
      contentType: 'text/html',
    })

    expect(result.status).toBe(422)
    expect(errorOf(result).error.message).toContain('Unsupported image type')
    expect(await countRows('SELECT COUNT(*) AS total FROM media_assets')).toBe(0)
  })

  it('refuses a file over the byte cap, naming the cap', async () => {
    const user = await createTestUser()
    const cookie = await loginAs(user)
    // A valid header plus padding: the sniff has to succeed for the byte cap to be
    // the check that decides, and the body stays under `MAX_BODY_BYTES` so this is
    // this route's limit being tested rather than the platform's.
    const oversized = new Uint8Array(MAX_MEDIA_BYTES + 1)
    oversized.set(png(64, 64))
    const before = await storedKeys()

    const result = await upload(cookie, { bytes: oversized, kind: 'avatar' })

    expect(result.status).toBe(422)
    const error = errorOf(result).error
    expect(error.code).toBe('VALIDATION_ERROR')
    expect(error.message).toContain(`at most ${Math.floor(MAX_MEDIA_BYTES / 1024)} KiB`)
    expect(await countRows('SELECT COUNT(*) AS total FROM media_assets')).toBe(0)
    expect(await storedKeys()).toEqual(before)
  })

  it('leaves a body over the platform limit to the platform, which answers 413', async () => {
    const user = await createTestUser()
    const cookie = await loginAs(user)
    // The band between the two caps is the test above: a body this route refuses
    // itself, with a message that names a number. Past `MAX_BODY_BYTES` the request
    // never reaches the route at all — `bodyLimit` (`app.ts`) refuses it before it is
    // parsed, which is the only way a body that size can be rejected without being
    // buffered first. So the two limits are a ladder, not a duplicate: this one is the
    // platform's, and it can only say "too large".
    const before = await storedKeys()

    const result = await upload(cookie, {
      bytes: new Uint8Array(MAX_BODY_BYTES + 1),
      kind: 'avatar',
    })

    expect(result.status).toBe(413)
    expect(errorOf(result).error.message).toMatch(/too large/i)
    expect(await countRows('SELECT COUNT(*) AS total FROM media_assets')).toBe(0)
    expect(await storedKeys()).toEqual(before)
  })

  it('refuses an image whose pixels are over the cap, naming the size', async () => {
    const user = await createTestUser()
    const cookie = await loginAs(user)

    // A 4097x40 PNG is a couple of dozen bytes: a header can declare fifty thousand
    // times the pixels the file actually carries, which is why the pixel cap is a
    // backstop of its own rather than a consequence of the byte cap.
    const result = await upload(cookie, {
      bytes: png(MAX_MEDIA_DIMENSION + 1, 40),
      kind: 'avatar',
    })

    expect(result.status).toBe(422)
    const error = errorOf(result).error
    expect(error.code).toBe('VALIDATION_ERROR')
    expect(error.message).toContain(`at most ${MAX_MEDIA_DIMENSION}x${MAX_MEDIA_DIMENSION}`)
    expect(await countRows('SELECT COUNT(*) AS total FROM media_assets')).toBe(0)
  })

  it('requires a kind', async () => {
    const user = await createTestUser()
    const cookie = await loginAs(user)

    const result = await upload(cookie, { bytes: png(16, 16) })

    expect(result.status).toBe(422)
    expect(errorOf(result).error.message).toContain('"kind"')
  })

  it('refuses a kind this API does not serve', async () => {
    const user = await createTestUser()
    const cookie = await loginAs(user)

    // `report_evidence` and `appeal_evidence` are real `media_assets.kind` values —
    // written by moderation flows, private, and unreachable from a public upload.
    const result = await upload(cookie, { bytes: png(16, 16), kind: 'report_evidence' })

    expect(result.status).toBe(400)
    expect(errorOf(result).error.code).toBe('BAD_REQUEST')
    expect(await countRows('SELECT COUNT(*) AS total FROM media_assets')).toBe(0)
  })

  it('refuses an upload from an impersonated session', async () => {
    const cookie = await impersonatedCookieFor('media-imp-target', TEST_PASSWORD)

    const result = await upload(cookie, { bytes: png(16, 16), kind: 'avatar' })

    expect(result.status).toBe(403)
    expect(errorOf(result).error.code).toBe('FORBIDDEN')
    expect(await countRows('SELECT COUNT(*) AS total FROM media_assets')).toBe(0)
  })

  it('blocks a suspended account that still holds a valid session', async () => {
    const user = await createTestUser()
    const cookie = await loginAs(user)

    await env.DB.prepare(
      `UPDATE users SET status = 'suspended', suspended_until = ?, status_reason = 'paused'
        WHERE id = ?`,
    )
      .bind(Date.now() + 3_600_000, user.id)
      .run()

    const result = await upload(cookie, { bytes: png(16, 16), kind: 'avatar' })

    expect(result.status).toBe(403)
    expect(errorOf(result).error.code).toBe('ACCOUNT_DISABLED')
    expect(await countRows('SELECT COUNT(*) AS total FROM media_assets')).toBe(0)
  })

  it('meters uploads with the seeded media_upload_user rule', async () => {
    const user = await createTestUser()
    const cookie = await loginAs(user)

    const first = await upload(cookie, { bytes: png(16, 16), kind: 'avatar' })
    expect(first.status).toBe(201)
    expect(first.headers.get('x-ratelimit-limit')).toBe('60')
    expect(first.headers.get('x-ratelimit-remaining')).toBe('59')

    // HONEST LIMITATION, asserted rather than assumed: the seeded rule is
    // `throttle`, which surfaces the headers and never rejects (see
    // middleware/rate-limit.ts). A caller can therefore spend the whole allowance
    // and the sixty-first upload still succeeds. The next test flips the same rule
    // to `block` and proves the plumbing CAN reject — which action a deployment
    // wants is a config change, not a code one.
    for (let extra = 0; extra < 60; extra++) {
      expect((await upload(cookie, { bytes: png(16, 16), kind: 'avatar' })).status).toBe(201)
    }
    expect(
      await countRows('SELECT COUNT(*) AS total FROM media_assets WHERE owner_user_id = ?', user.id),
    ).toBe(61)
  })

  it('rejects with 429 once the rule is set to block', async () => {
    const user = await createTestUser()
    const cookie = await loginAs(user)
    await setRateLimit('media_upload_user', { maxRequests: 1, action: 'block' })

    const allowed = await upload(cookie, { bytes: png(16, 16), kind: 'avatar' })
    expect(allowed.status).toBe(201)

    const blocked = await upload(cookie, { bytes: png(16, 16), kind: 'avatar' })
    expect(blocked.status).toBe(429)
    expect(errorOf(blocked).error.code).toBe('RATE_LIMITED')
    expect(blocked.headers.get('retry-after')).toBeTruthy()

    // The limit is spent before the body is read, so the refused upload left
    // nothing behind: a limiter in front of a write must not half-apply it.
    expect(await countRows('SELECT COUNT(*) AS total FROM media_assets')).toBe(1)
  })

  it('is refused while maintenance mode is on', async () => {
    const user = await createTestUser()
    const cookie = await loginAs(user)
    await setSettingValue(SETTING_KEYS.maintenanceMode, 'true')

    const result = await upload(cookie, { bytes: png(16, 16), kind: 'avatar' })

    expect(result.status).toBe(503)
    expect(errorOf(result).error.code).toBe('MAINTENANCE')
    expect(await countRows('SELECT COUNT(*) AS total FROM media_assets')).toBe(0)
  })
})

describe('GET /api/v1/media/*', () => {
  it('serves a stored avatar to a request with no cookie', async () => {
    const user = await createTestUser()
    const cookie = await loginAs(user)
    const bytes = png(96, 96)
    const asset = await uploadAvatar(cookie, bytes)

    // `fetchObject` sends no cookie at all, which is the whole requirement: an
    // `<img>` on a public page carries nothing this API could check.
    const served = await fetchObject(asset.url)

    expect(served.status).toBe(200)
    expect(served.headers.get('content-type')).toBe('image/png')
    expect(served.headers.get('cache-control')).toContain('max-age=31536000')
    expect(served.headers.get('etag')).toBeTruthy()
    expect(served.bytes).toEqual(bytes)
  })

  it('answers 404 for a key this API never minted', async () => {
    // A perfectly shaped key: what is missing is the object, not the permission.
    const missing = `/api/v1/media/avatars/${ulid()}/${ulid()}.webp`

    expect((await fetchObject(missing)).status).toBe(404)
  })

  it('answers 404 for anything outside the whitelist', async () => {
    const user = await createTestUser()
    const id = ulid()

    // Every one of these is a key the public bucket could plausibly hold, and not
    // one of them may be served: the whitelist in `lib/media.ts` is the shape of a
    // URL this API is willing to answer, and it is the ONLY thing standing between
    // a public endpoint and the private objects that live beside them.
    const refused = [
      `/api/v1/media/report_evidence/${user.id}/${id}.webp`,
      `/api/v1/media/appeal_evidence/${user.id}/${id}.webp`,
      `/api/v1/media/avatars/${user.id}/${id}.svg`,
      `/api/v1/media/avatars/${user.id}/${id}`,
      '/api/v1/media/avatars',
      '/api/v1/media/',
    ]

    for (const path of refused) {
      expect((await fetchObject(path)).status).toBe(404)
    }

    // Traversal is refused by normalisation rather than by string matching, which
    // is the point: `..` is resolved by the URL parser before the key is read, so
    // the request lands on a path the whitelist already rejects.
    const traversed = await fetchObject(`/api/v1/media/avatars/${user.id}/../../report_evidence/x.webp`)
    expect(traversed.status).toBe(404)
  })

  it('keeps serving while maintenance mode is on', async () => {
    const user = await createTestUser()
    const cookie = await loginAs(user)
    const asset = await uploadAvatar(cookie)

    await setSettingValue(SETTING_KEYS.maintenanceMode, 'true')

    // Maintenance blocks writes (`middleware/maintenance.ts`), and reads keep
    // working on purpose: a visitor already looking at a page should not lose the
    // images on it because the console is closed.
    expect((await fetchObject(asset.url)).status).toBe(200)
  })
})

describe('DELETE /api/v1/media/:id', () => {
  it('requires a session', async () => {
    const user = await createTestUser()
    const cookie = await loginAs(user)
    const asset = await uploadAvatar(cookie)

    const result = await api('DELETE', `/api/v1/media/${asset.id}`, {})

    expect(result.status).toBe(401)
    // Nothing moved: an unauthenticated request is not a partial delete.
    expect((await fetchObject(asset.url)).status).toBe(200)
  })

  it('removes the object and the row, and audits it', async () => {
    const user = await createTestUser()
    const cookie = await loginAs(user)
    const asset = await uploadAvatar(cookie)

    const result = await api('DELETE', `/api/v1/media/${asset.id}`, { cookie })

    expect(result.status).toBe(204)
    expect((await fetchObject(asset.url)).status).toBe(404)
    expect(await countRows('SELECT COUNT(*) AS total FROM media_assets')).toBe(0)

    // The `before` snapshot is the object's own facts, so an investigation can see
    // what was removed after the row and the object are both gone.
    const audits = await auditsFor('media.delete')
    expect(audits).toHaveLength(1)
    expect(audits[0]?.target_id).toBe(asset.id)
    expect(JSON.parse(audits[0]?.metadata ?? '{}')).toMatchObject({
      kind: 'avatar',
      key: asset.key,
      bytes: asset.bytes,
    })
    expect(JSON.parse(audits[0]?.before ?? '{}')).toMatchObject({ key: asset.key, kind: 'avatar' })
  })

  it("treats somebody else's asset as missing", async () => {
    const owner = await createTestUser()
    const ownerCookie = await loginAs(owner)
    const asset = await uploadAvatar(ownerCookie)

    const stranger = await createTestUser()
    const strangerCookie = await loginAs(stranger)

    const result = await api<ErrorEnvelope>('DELETE', `/api/v1/media/${asset.id}`, {
      cookie: strangerCookie,
    })

    // `404`, not `403`: nothing here confirms that the id names anything at all.
    expect(result.status).toBe(404)
    expect(result.body.error.code).toBe('NOT_FOUND')
    expect(await countRows('SELECT COUNT(*) AS total FROM media_assets')).toBe(1)
    expect((await fetchObject(asset.url)).status).toBe(200)
    expect(await auditsFor('media.delete')).toHaveLength(0)
  })

  it('is a 404 the second time', async () => {
    const user = await createTestUser()
    const cookie = await loginAs(user)
    const asset = await uploadAvatar(cookie)
    const path = `/api/v1/media/${asset.id}`

    expect((await api('DELETE', path, { cookie })).status).toBe(204)
    expect((await api('DELETE', path, { cookie })).status).toBe(404)
    expect(await auditsFor('media.delete')).toHaveLength(1)
  })

  it('refuses an upload removal from an impersonated session', async () => {
    const cookie = await impersonatedCookieFor('media-imp-delete', TEST_PASSWORD)

    const result = await api<ErrorEnvelope>('DELETE', `/api/v1/media/${ulid()}`, { cookie })

    expect(result.status).toBe(403)
    expect(result.body.error.code).toBe('FORBIDDEN')
  })
})

describe('avatar wiring: upload, then point a profile at it', () => {
  it('accepts a key this account owns and derives the URL', async () => {
    const user = await createTestUser()
    const cookie = await loginAs(user)
    const asset = await uploadAvatar(cookie)

    const result = await updateProfile(cookie, { avatarKey: asset.key })

    expect(result.status).toBe(200)
    expect(result.body.data.user.avatarKey).toBe(asset.key)
    expect(result.body.data.user.avatarUrl).toBe(mediaUrlFor(asset.key))

    // The column in the database is the key, never the URL: the URL is derived, so
    // it cannot go stale when the bucket moves.
    expect(
      await env.DB.prepare('SELECT avatar_key FROM users WHERE id = ?')
        .bind(user.id)
        .first<{ avatar_key: string | null }>(),
    ).toMatchObject({ avatar_key: asset.key })

    // `avatarKey` used to be accepted by the schema and then dropped on the floor by
    // the service, so the audit trail is the assertion that closes that gap: a field
    // that does not reach the write cannot reach the log either.
    const audits = await profileAudits()
    expect(audits).toHaveLength(1)
    expect(JSON.parse(audits[0]?.after ?? '{}')).toMatchObject({ avatarKey: asset.key })
  })

  it("refuses a key owned by somebody else", async () => {
    const owner = await createTestUser()
    const ownerCookie = await loginAs(owner)
    const asset = await uploadAvatar(ownerCookie)

    const stranger = await createTestUser()
    const strangerCookie = await loginAs(stranger)

    // The key is perfectly shaped — it has to be, it was minted by this API — so a
    // pattern check cannot be what refuses it. Ownership is the only thing that can.
    const result = await updateProfile(strangerCookie, { avatarKey: asset.key })

    expect(result.status).toBe(422)
    expect(errorOf(result).error.code).toBe('VALIDATION_ERROR')
    expect(errorOf(result).error.message).toMatch(/does not name one of your uploads/i)
    expect(
      await env.DB.prepare('SELECT avatar_key FROM users WHERE id = ?')
        .bind(stranger.id)
        .first<{ avatar_key: string | null }>(),
    ).toMatchObject({ avatar_key: null })
  })

  it('refuses a key that names an upload of another kind', async () => {
    const user = await createTestUser()
    const cookie = await loginAs(user)

    const pageImage = await upload(cookie, {
      bytes: png(64, 64),
      kind: 'page_image',
      filename: 'cover.png',
    })
    expect(pageImage.status).toBe(201)

    // An avatar field may only name an avatar. The SHAPE is the schema's business, so
    // this refusal arrives as the generic message every schema failure shares, with
    // the specificity in `details.issues` (`routes/helpers.ts`).
    const result = await updateProfile(cookie, { avatarKey: pageImage.body.data.key })

    expect(result.status).toBe(422)
    expect(errorOf(result).error.code).toBe('VALIDATION_ERROR')
    const { issues } = errorOf(result).error.details as {
      issues: { path: string; message: string }[]
    }
    expect(issues.map((issue) => `${issue.path}: ${issue.message}`)).toContain(
      'avatarKey: That is not an avatar key.',
    )
  })

  it('clears the avatar with null', async () => {
    const user = await createTestUser()
    const cookie = await loginAs(user)
    const asset = await uploadAvatar(cookie)
    await updateProfile(cookie, { avatarKey: asset.key })

    const cleared = await updateProfile(cookie, { avatarKey: null })

    expect(cleared.status).toBe(200)
    expect(cleared.body.data.user.avatarKey).toBeNull()
    expect(cleared.body.data.user.avatarUrl).toBeNull()
    // Removing the avatar is a pointer change, not a delete: the object is still
    // in the bucket for the account to point at again.
    expect((await fetchObject(asset.url)).status).toBe(200)
  })

  it('clears the avatar when the object behind it is deleted', async () => {
    const user = await createTestUser()
    const cookie = await loginAs(user)
    const asset = await uploadAvatar(cookie)
    await updateProfile(cookie, { avatarKey: asset.key })

    expect((await api('DELETE', `/api/v1/media/${asset.id}`, { cookie })).status).toBe(204)

    // One call, and no page can be left rendering an image whose object is gone:
    // the delete nulls `avatar_key` itself (media.service.ts) rather than trusting
    // the client to do a second PATCH.
    const me = await api<Envelope<{ user: ApiUser }>>('GET', '/api/v1/auth/me', { cookie })
    expect(me.body.data.user.avatarKey).toBeNull()
    expect(me.body.data.user.avatarUrl).toBeNull()
  })

  it('leaves the avatar alone when a different upload is deleted', async () => {
    const user = await createTestUser()
    const cookie = await loginAs(user)
    const kept = await uploadAvatar(cookie)
    const spare = await uploadAvatar(cookie, png(16, 16))
    await updateProfile(cookie, { avatarKey: kept.key })

    const before = await env.DB.prepare('SELECT updated_at FROM users WHERE id = ?')
      .bind(user.id)
      .first<{ updated_at: number }>()

    expect((await api('DELETE', `/api/v1/media/${spare.id}`, { cookie })).status).toBe(204)

    const me = await api<Envelope<{ user: ApiUser }>>('GET', '/api/v1/auth/me', { cookie })
    expect(me.body.data.user.avatarUrl).toBe(mediaUrlFor(kept.key))
    expect(await countRows('SELECT COUNT(*) AS total FROM media_assets')).toBe(1)

    // The clearing statement is guarded by `avatar_key = ?`, so an unrelated delete
    // touches nothing at all — not even `updated_at`, which would otherwise make a
    // profile look edited by an action that had nothing to do with it.
    const after = await env.DB.prepare('SELECT updated_at FROM users WHERE id = ?')
      .bind(user.id)
      .first<{ updated_at: number }>()
    expect(after?.updated_at).toBe(before?.updated_at)
  })
})



