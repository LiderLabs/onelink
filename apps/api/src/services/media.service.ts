import { now } from '../lib/clock'
import { ulid } from '../lib/ids'
import { notFound } from '../lib/errors'
import { AVATAR_KEY_PATTERN, mediaUrl, validateAvatarWebp } from '../lib/media'
import { auditInsertStmt } from './audit.service'
import type { ActorInfo, Auditor, MediaAssetRow, MediaDto } from '../types'

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
