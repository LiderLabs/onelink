import { now } from '../lib/clock'
import { ulid } from '../lib/ids'
import { notFound } from '../lib/errors'
import { AVATAR_KEY_PATTERN, mediaUrl, validateAvatarWebp } from '../lib/media'
import { auditInsertStmt } from './audit.service'
import type { ActorInfo, Auditor, AuditEntry, MediaAssetRow, MediaDto } from '../types'

export function toMediaDto(row: MediaAssetRow): MediaDto {
  return { id: row.id, key: row.r2_key, url: mediaUrl(row.r2_key), width: row.width!, height: row.height!, bytes: row.size_bytes }
}

export async function uploadAvatar(
  env: Cloudflare.Env, actor: ActorInfo, bytes: Uint8Array, declaredMime: string, auditor: Auditor,
): Promise<MediaDto> {
  const image = validateAvatarWebp(bytes, declaredMime)
  const id = ulid()
  const key = `avatars/${actor.id}/${id}.webp`
  const entry = auditor.claim({ action: 'media.upload', targetType: 'media', targetId: id, metadata: { kind: 'avatar', bytes: image.bytes } })
  await env.PUBLIC_BUCKET.put(key, bytes, { httpMetadata: { contentType: image.mime } })
  try {
    await env.DB.batch([
      env.DB.prepare(`INSERT INTO media_assets
        (id,owner_user_id,r2_key,bucket,kind,mime,size_bytes,width,height,uploaded_by,status,created_at)
        VALUES (?,?,?,'public','avatar',?,?,?,?,?,'active',?)`)
        .bind(id, actor.id, key, image.mime, image.bytes, image.width, image.height, actor.id, now()),
      auditInsertStmt(env.DB, entry),
    ])
  } catch (error) {
    try { await env.PUBLIC_BUCKET.delete(key) } catch {
      console.error(JSON.stringify({ level: 'error', msg: 'media_upload_compensation_failed', key, requestId: entry.requestId }))
    }
    throw error
  }
  return { id, key, url: mediaUrl(key), width: image.width, height: image.height, bytes: image.bytes }
}

export async function getCurrentAvatar(db: D1Database, userId: string): Promise<MediaDto | null> {
  const row = await db.prepare(`SELECT m.* FROM media_assets m JOIN users u ON u.avatar_key=m.r2_key
    WHERE u.id=? AND m.owner_user_id=u.id AND m.kind='avatar' AND m.bucket='public' AND m.status='active'`)
    .bind(userId).first<MediaAssetRow>()
  return row ? toMediaDto(row) : null
}

export async function readPublicAvatar(env: Cloudflare.Env, key: string): Promise<R2ObjectBody> {
  if (!AVATAR_KEY_PATTERN.test(key)) throw notFound('Photo')
  const row = await env.DB.prepare("SELECT id FROM media_assets WHERE r2_key=? AND bucket='public' AND kind='avatar' AND status='active'")
    .bind(key).first<{ id: string }>()
  if (!row) throw notFound('Photo')
  const object = await env.PUBLIC_BUCKET.get(key)
  if (!object) throw notFound('Photo')
  return object
}

/** Mark before deleting storage; a tombstone remains until storage cleanup succeeds. */
export async function retireAvatar(env: Cloudflare.Env, row: MediaAssetRow, entry: AuditEntry, onlyIfUnattached = false): Promise<boolean> {
  const timestamp = now()
  const results = await env.DB.batch([
    env.DB.prepare(`UPDATE media_assets SET status='deleted', deleted_at=coalesce(deleted_at,?) WHERE id=?
      ${onlyIfUnattached ? 'AND NOT EXISTS (SELECT 1 FROM users WHERE avatar_key=media_assets.r2_key)' : ''}`)
      .bind(timestamp, row.id),
    auditInsertStmt(env.DB, entry, true),
    env.DB.prepare(`UPDATE users SET avatar_key=NULL,updated_at=? WHERE avatar_key=?
      AND EXISTS (SELECT 1 FROM media_assets WHERE id=? AND status='deleted')`)
      .bind(timestamp, row.r2_key, row.id),
  ])
  if (results[0]?.meta.changes !== 1) return false
  await env.PUBLIC_BUCKET.delete(row.r2_key)
  await env.DB.prepare("DELETE FROM media_assets WHERE id=? AND status='deleted'").bind(row.id).run()
  return true
}

export async function deleteOwnedAvatar(env: Cloudflare.Env, actor: ActorInfo, id: string, auditor: Auditor): Promise<void> {
  const row = await env.DB.prepare('SELECT * FROM media_assets WHERE id=?').bind(id).first<MediaAssetRow>()
  if (!row) return
  if (row.owner_user_id !== actor.id || row.kind !== 'avatar' || row.bucket !== 'public') throw notFound('Photo')
  const entry = auditor.claim({ action: 'media.delete', targetType: 'media', targetId: id, before: { key: row.r2_key }, after: { status: 'deleted' } })
  await retireAvatar(env, row, entry)
}
