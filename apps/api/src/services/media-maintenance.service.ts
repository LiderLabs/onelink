import { now } from '../lib/clock'
import { standaloneEntry } from './audit.service'
import { retirePublicMedia } from './avatar.service'
import type { MediaAssetRow } from '../types'

export async function cleanupPublicMedia(env: Cloudflare.Env, referenceTime = now()): Promise<{ removed: number; failed: number }> {
  const cutoff = referenceTime - 24 * 60 * 60 * 1000
  const { results } = await env.DB.prepare(`SELECT m.* FROM media_assets m WHERE m.bucket='public'
    AND ((m.status='deleted' AND coalesce(m.deleted_at,m.created_at) < ?)
      OR (m.kind='avatar' AND m.status='active' AND m.checksum IS NULL AND m.created_at < ?
        AND NOT EXISTS (SELECT 1 FROM users WHERE avatar_key=m.r2_key)))
    ORDER BY m.created_at, m.id LIMIT 100`).bind(cutoff, cutoff).all<MediaAssetRow>()
  let removed = 0, failed = 0
  for (const row of results) {
    const entry = standaloneEntry({ action: 'system.media.cleanup', targetType: 'media', targetId: row.id,
      actorRole: 'system', actorLabel: 'scheduled-task', metadata: { key: row.r2_key } })
    try { if (await retirePublicMedia(env, row, entry, row.status === 'active')) removed++ }
    catch {
      failed++
      console.error(JSON.stringify({ level: 'error', msg: 'media_cleanup_failed', key: row.r2_key, requestId: entry.requestId }))
    }
  }
  return { removed, failed }
}

export async function cleanupPrivateMedia(env: Cloudflare.Env, referenceTime = now()): Promise<{ removed: number; failed: number }> {
  const cutoff = referenceTime - 24 * 60 * 60 * 1000
  const { results } = await env.DB.prepare(`SELECT * FROM media_assets WHERE bucket='private' AND status='deleted'
    AND coalesce(deleted_at,created_at)<? ORDER BY created_at,id LIMIT 100`).bind(cutoff).all<MediaAssetRow>()
  let removed = 0
  let failed = 0
  for (const row of results) {
    try {
      await env.PRIVATE_BUCKET.delete(row.r2_key)
      await env.DB.prepare("DELETE FROM media_assets WHERE id=? AND bucket='private' AND status='deleted'")
        .bind(row.id).run()
      removed++
    } catch (error) {
      failed++
      console.error(JSON.stringify({ level: 'error', msg: 'private_media_cleanup_failed', key: row.r2_key,
        message: error instanceof Error ? error.message : String(error) }))
    }
  }
  return { removed, failed }
}
