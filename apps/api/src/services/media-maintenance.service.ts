import { now } from '../lib/clock'
import { standaloneEntry } from './audit.service'
import { retireAvatar } from './media.service'
import type { MediaAssetRow } from '../types'

export async function cleanupAvatarMedia(env: Cloudflare.Env, referenceTime = now()): Promise<{ removed: number; failed: number }> {
  const cutoff = referenceTime - 24 * 60 * 60 * 1000
  const { results } = await env.DB.prepare(`SELECT m.* FROM media_assets m WHERE m.kind='avatar' AND m.bucket='public'
    AND (m.status='deleted' OR (m.created_at < ? AND NOT EXISTS (SELECT 1 FROM users WHERE avatar_key=m.r2_key)))
    ORDER BY m.created_at, m.id LIMIT 100`).bind(cutoff).all<MediaAssetRow>()
  let removed = 0, failed = 0
  for (const row of results) {
    const entry = standaloneEntry({ action: 'system.media.cleanup', targetType: 'media', targetId: row.id,
      actorRole: 'system', actorLabel: 'scheduled-task', metadata: { key: row.r2_key } })
    try { if (await retireAvatar(env, row, entry, row.status === 'active')) removed++ }
    catch {
      failed++
      console.error(JSON.stringify({ level: 'error', msg: 'media_cleanup_failed', key: row.r2_key, requestId: entry.requestId }))
    }
  }
  return { removed, failed }
}
