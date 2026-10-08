import { now } from '../lib/clock'
import { MAX_MEDIA_BYTES, MAX_MEDIA_DIMENSION, MEDIA_KINDS, type MediaKind } from '../lib/constants'
import { sha256HexOfBytes } from '../lib/crypto'
import { notFound, validationError } from '../lib/errors'
import { ulid } from '../lib/ids'
import {
  declaredImageMime,
  extensionForMime,
  isGenericContentType,
  sniffImage,
  type SniffedImage,
} from '../lib/image'
import { AVATAR_KEY_PATTERN, mediaObjectKey } from '../lib/media'
import { asCount } from '../lib/query'
import { auditInsertStmt } from './audit.service'
import { toMediaAssetDto } from './mappers'
import type { ActorInfo, Auditor, MediaAssetRow } from '../types'

// ============================================================================
// Media (R1.3) — the object half.
//
// One operation, twice: bytes arrive, they are identified, they are stored in
// `PUBLIC_BUCKET`, and a row remembers what was stored. `kind` picks the prefix and
// the DTO does not mention it, because a `page_image` and an `avatar` are the same
// thing to everything downstream — an object with a URL.
//
// **The bytes are the only source of truth about the bytes.** The declared
// `Content-Type` is a CLAIM: it can name a format this API does not store (which is
// a refusal), and it can name the wrong one of the four (which is ignored — the
// sniff decides). Nothing here trusts an extension or a filename, and the filename
// is only ever a label on the audit row.
//
// **Two refusals are not one refusal.** Bytes over `MAX_MEDIA_BYTES`, or pixels
// over `MAX_MEDIA_DIMENSION`, are the caller's file being wrong: a `422` naming the
// limit, which is the message a client can act on. A body over `MAX_BODY_BYTES`
// never reaches here at all — `bodyLimit` in `app.ts` answers that with a generic
// `413` before the request is parsed.
//
// **The D1 tombstone is the recovery record for every cross-store operation.**
// Uploads create it before R2 is touched; deletes commit it before removing R2.
// This leaves a durable key for maintenance whether the Worker fails during the
// upload, during compensation, or after retirement.
//
// Tombstones are never served. Maintenance retries R2 deletion and removes the
// D1 row only after storage deletion succeeds.
//
// Both mutations claim their audit entry before any write and bind it into the
// SAME `db.batch()` as the change it describes — so the log row commits with the
// change, or neither does.
//
// Ownership is `media_assets.owner_user_id = actor.id`, and a foreign id answers
// `404` exactly like a missing one. That is the whole access seam: there is one
// owner per asset and no sharing, so nothing else has to be consulted.
// ============================================================================

/** What a route hands over: the bytes, and the two claims a client made about them. */
export interface UploadMediaInput {
  kind: MediaKind
  /** Label only — recorded on the audit row, never used to build a path. */
  filename: string | null
  bytes: Uint8Array
  declaredType: string | null
}

/**
 * A media object is immutable and its key is unique per upload, so a served object
 * can be cached indefinitely. One year is the conventional maximum, and
 * `immutable` is what stops a revalidation that could never change anything.
 */
export const MEDIA_CACHE_CONTROL = 'public, max-age=31536000, immutable'

/** Longest declared type worth echoing back in a message; a header is client input. */
const MAX_ECHOED_HEADER = 60

/**
 * What these bytes are, or a refusal naming why.
 *
 * The one place where "is this storable" is decided: the declared type, the
 * signature, the byte cap and the pixel cap, each stricter than the last and each a
 * `422` — because every one of them is a statement about the file the caller sent.
 */
export function assertStorableImage(input: UploadMediaInput): SniffedImage {
  if (declaredImageMime(input.declaredType) === null && !isGenericContentType(input.declaredType)) {
    const echoed = (input.declaredType ?? '').slice(0, MAX_ECHOED_HEADER)
    throw validationError(`Unsupported image type "${echoed}". Upload a WebP, PNG, JPEG or GIF.`)
  }

  const sniffed = sniffImage(input.bytes)
  if (sniffed === null) {
    throw validationError('That file is not a WebP, PNG, JPEG or GIF image.')
  }

  if (input.bytes.byteLength > MAX_MEDIA_BYTES) {
    throw validationError(
      `Images must be at most ${Math.floor(MAX_MEDIA_BYTES / 1024)} KiB; ` +
        `that one is ${Math.ceil(input.bytes.byteLength / 1024)} KiB.`,
    )
  }

  if (sniffed.width > MAX_MEDIA_DIMENSION || sniffed.height > MAX_MEDIA_DIMENSION) {
    throw validationError(
      `Images must be at most ${MAX_MEDIA_DIMENSION}x${MAX_MEDIA_DIMENSION} pixels; ` +
        `that one is ${sniffed.width}x${sniffed.height}.`,
    )
  }

  return sniffed
}

// ------------------------------------------------------------------ storage --

/**
 * Stores one image and remembers it.
 *
 * The stored type is the SNIFFED one, never the declared one, so an object's
 * `content-type` cannot be a client's mistake — and `mime` in the database is the
 * same value, because the row describing an object should agree with the object.
 *
 * The row is built in memory rather than read back: the DTO is derived from exactly
 * the values that were just written, and a re-read would only prove that D1 echoes
 * what it was given.
 */
export async function createMediaAsset(
  db: D1Database,
  bucket: R2Bucket,
  actor: ActorInfo,
  input: UploadMediaInput,
  auditor: Auditor,
): Promise<Record<string, unknown>> {
  const sniffed = assertStorableImage(input)

  const id = ulid()
  // The key is minted, never received: the owner's id first so two accounts can
  // never collide, and the row's own id last so a re-upload replaces nothing.
  const key = mediaObjectKey(input.kind, actor.id, id, extensionForMime(sniffed.mime))
  const timestamp = now()

  const entry = auditor.claim({
    action: 'media.upload',
    targetType: 'media',
    targetId: id,
    targetLabel: input.filename,
    actorUserId: actor.id,
    actorRole: actor.role,
    actorLabel: actor.label,
    metadata: {
      kind: input.kind,
      key,
      mime: sniffed.mime,
      bytes: input.bytes.byteLength,
      width: sniffed.width,
      height: sniffed.height,
      filename: input.filename,
      declaredType: input.declaredType,
    },
  })

  const checksum = await sha256HexOfBytes(input.bytes)
  const row: MediaAssetRow = {
    id,
    owner_user_id: actor.id,
    page_id: null,
    r2_key: key,
    bucket: 'public',
    kind: input.kind,
    original_filename: input.filename,
    mime: sniffed.mime,
    size_bytes: input.bytes.byteLength,
    width: sniffed.width,
    height: sniffed.height,
    checksum,
    uploaded_by: actor.id,
    status: 'active',
    created_at: timestamp,
    deleted_at: null,
  }

  // Persist a tombstone before touching R2. If the Worker stops between the
  // object write and activation, maintenance still has the key to clean up.
  await db
    .prepare(
      `INSERT INTO media_assets (
         id, owner_user_id, page_id, r2_key, bucket, kind, original_filename,
         mime, size_bytes, width, height, checksum, uploaded_by, status,
         created_at, deleted_at
       ) VALUES (?,?,NULL,?,'public',?,?,?,?,?,?,?,?,'deleted',?,?)`,
    )
    .bind(
      row.id,
      row.owner_user_id,
      row.r2_key,
      row.kind,
      row.original_filename,
      row.mime,
      row.size_bytes,
      row.width,
      row.height,
      row.checksum,
      row.uploaded_by,
      row.created_at,
      timestamp,
    )
    .run()

  try {
    await bucket.put(key, input.bytes, {
      httpMetadata: { contentType: sniffed.mime, cacheControl: MEDIA_CACHE_CONTROL },
    })

    await db.batch([
      db
        .prepare(
          `UPDATE media_assets SET status='active', deleted_at=NULL
            WHERE id=? AND status='deleted'`,
        )
        .bind(row.id),
      auditInsertStmt(db, entry, true),
    ])
  } catch (error) {
    // Mark it non-public before compensating. If R2 deletion fails, the durable
    // tombstone lets scheduled maintenance retry without exposing the object.
    try {
      const result = await db
        .prepare("UPDATE media_assets SET status='deleted', deleted_at=coalesce(deleted_at, ?) WHERE id=?")
        .bind(now(), id)
        .run()
      if (result.meta.changes !== 1) throw new Error('Could not retain the media cleanup record.')
      await bucket.delete(key)
      await db.prepare("DELETE FROM media_assets WHERE id=? AND status='deleted'").bind(id).run()
    } catch (cleanupError) {
      console.error(JSON.stringify({
        level: 'error',
        msg: 'media_upload_compensation_deferred',
        key,
        requestId: entry.requestId,
        message: cleanupError instanceof Error ? cleanupError.message : String(cleanupError),
      }))
    }
    throw error
  }

  return toMediaAssetDto(row)
}

// ---------------------------------------------------------------- ownership --

/**
 * One of this owner's live assets, or `null`.
 *
 * Scoped to the two kinds this API serves from `PUBLIC_BUCKET`, so a key naming
 * something else cannot be reached through `DELETE /media/:id` even if a future
 * migration starts writing evidence rows for this same user.
 */
export async function findOwnedMediaAsset(
  db: D1Database,
  ownerId: string,
  id: string,
): Promise<MediaAssetRow | null> {
  const row = await db
    .prepare(
      `SELECT * FROM media_assets
        WHERE id = ? AND owner_user_id = ? AND status = 'active'
          AND kind IN (${MEDIA_KINDS.map(() => '?').join(', ')})`,
    )
    .bind(id, ownerId, ...MEDIA_KINDS)
    .first<MediaAssetRow>()
  return row ?? null
}

/**
 * Retires one of the caller's own uploads.
 *
 * A foreign id and a missing id are the same `404`, so nothing here tells a caller
 * whether somebody else's asset exists.
 *
 * The D1 tombstone is committed before touching R2, so a failed delete remains
 * hidden and recoverable. The user update keeps `users.avatar_key` from pointing at an object
 * that no longer exists: retirement nulls the avatar of the owner whose profile
 * names this exact key. It is guarded by `avatar_key = ?` rather than run
 * unconditionally, so it touches nothing — not even `updated_at` — when the key
 * being deleted is not the one in use. Cleaning up an upload therefore cannot break
 * a live avatar, and removing an avatar needs no second call.
 */
export async function deleteMediaAsset(
  db: D1Database,
  bucket: R2Bucket,
  actor: ActorInfo,
  id: string,
  auditor: Auditor,
): Promise<void> {
  const asset = await findOwnedMediaAsset(db, actor.id, id)
  if (asset === null) throw notFound('Media asset')

  const entry = auditor.claim({
    action: 'media.delete',
    targetType: 'media',
    targetId: asset.id,
    targetLabel: asset.original_filename,
    actorUserId: actor.id,
    actorRole: actor.role,
    actorLabel: actor.label,
    metadata: { kind: asset.kind, key: asset.r2_key, bytes: asset.size_bytes },
    before: {
      key: asset.r2_key,
      kind: asset.kind,
      mime: asset.mime,
      width: asset.width,
      height: asset.height,
    },
  })

  const retiredAt = now()
  const results = await db.batch([
    db.prepare("UPDATE media_assets SET status='deleted', deleted_at=? WHERE id=? AND status='active'")
      .bind(retiredAt, asset.id),
    auditInsertStmt(db, entry, true),
    db
      .prepare('UPDATE users SET avatar_key = NULL, updated_at = ? WHERE id = ? AND avatar_key = ?')
      .bind(retiredAt, actor.id, asset.r2_key),
  ])
  if (results[0]?.meta.changes !== 1) throw notFound('Media asset')

  // The D1 tombstone and audit are durable before R2 deletion. If either storage
  // operation fails, public reads are blocked and maintenance can retry later.
  await bucket.delete(asset.r2_key)
  await db
    .prepare("DELETE FROM media_assets WHERE id = ? AND status = 'deleted'")
    .bind(asset.id)
    .run()
}

/**
 * Proves an avatar key names one of this caller's own uploads, or refuses.
 *
 * The last line of defence, in the same spirit as `assertKnownPlatform`: the route's
 * schema is the edge, and this is what holds for a caller that reached the service
 * another way. Two checks, deliberately independent:
 *
 *   * the SHAPE is re-checked here (`AVATAR_KEY_PATTERN` — the avatars prefix only,
 *     so another kind's key is refused even if the request never met the schema),
 *   * ownership is answered by `media_assets`, because a pattern can only prove what
 *     a string looks like, and a caller who can copy a key off a public page can
 *     write a perfectly shaped key they do not own.
 *
 * A `422`, not a `403`: this is not authorisation over a row the caller can see, it
 * is a body naming an object the caller cannot use.
 */
export async function assertOwnsAvatarKey(
  db: D1Database,
  ownerId: string,
  key: string,
): Promise<void> {
  if (!AVATAR_KEY_PATTERN.test(key)) {
    throw validationError('That is not an avatar key.')
  }

  const row = await db
    .prepare(
      `SELECT COUNT(*) AS total FROM media_assets
        WHERE r2_key = ? AND owner_user_id = ? AND kind = 'avatar' AND status = 'active'`,
    )
    .bind(key, ownerId)
    .first<{ total: number }>()

  if (asCount(row) === 0) {
    throw validationError('That avatar key does not name one of your uploads.')
  }
}


