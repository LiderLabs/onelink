import { app } from './app'
import { now } from './lib/clock'
import { auditInsertStmt, pruneAuditLogs, standaloneEntry } from './services/audit.service'
import { SETTING_KEYS, getNumberSetting } from './services/settings.service'

// ============================================================================
// Worker entrypoint.
//
// `fetch` is the Hono app. `scheduled` is the daily housekeeping pass — the
// only place where time-based state transitions happen:
//
//   * temporary suspensions that have run out return the account to `active`
//   * the matching sanction rows move from `active` to `expired`
//   * audit logs older than `audit.retention_days` are pruned (0 = keep forever)
// ============================================================================

export interface MaintenanceReport {
  suspensionsExpired: number
  sanctionsExpired: number
  auditRowsPruned: number
}

/**
 * Exported so it can be unit-tested directly instead of through a scheduled
 * event, and so a manual "run housekeeping now" route can reuse it later.
 */
export async function runMaintenance(env: Cloudflare.Env): Promise<MaintenanceReport> {
  const db = env.DB
  const timestamp = now()

  const expiredSanctions = db
    .prepare(
      `UPDATE sanctions
          SET status = 'expired'
        WHERE status = 'active' AND expires_at IS NOT NULL AND expires_at <= ?`,
    )
    .bind(timestamp)

  const expiredUsers = db
    .prepare(
      `UPDATE users
          SET status = 'active', status_reason = NULL, status_changed_at = ?,
              suspended_until = NULL, suspended_permanently = 0, updated_at = ?
        WHERE status = 'suspended'
          AND suspended_permanently = 0
          AND suspended_until IS NOT NULL
          AND suspended_until <= ?
          AND deleted_at IS NULL`,
    )
    .bind(timestamp, timestamp, timestamp)

  const entry = standaloneEntry({
    action: 'system.sanctions.expire',
    actorRole: 'system',
    actorLabel: 'scheduled-task',
    metadata: { ranAt: timestamp },
  })

  const results = await db.batch([
    expiredSanctions,
    expiredUsers,
    auditInsertStmt(db, entry),
  ])

  const retentionDays = await getNumberSetting(db, SETTING_KEYS.auditRetentionDays, 0)
  const auditRowsPruned = await pruneAuditLogs(db, retentionDays)

  return {
    sanctionsExpired: results[0]?.meta.changes ?? 0,
    suspensionsExpired: results[1]?.meta.changes ?? 0,
    auditRowsPruned,
  }
}

export default {
  fetch: app.fetch,
  async scheduled(_event, env, ctx) {
    ctx.waitUntil(
      runMaintenance(env).then(
        (report) => console.log(JSON.stringify({ level: 'info', msg: 'maintenance_complete', ...report })),
        (error: unknown) =>
          console.error(
            JSON.stringify({
              level: 'error',
              msg: 'maintenance_failed',
              message: error instanceof Error ? error.message : String(error),
            }),
          ),
      ),
    )
  },
} satisfies ExportedHandler<Cloudflare.Env>
