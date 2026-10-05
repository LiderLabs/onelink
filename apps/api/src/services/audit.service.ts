import { now } from '../lib/clock'
import { ulid } from '../lib/ids'
import { andWhere, asCount, jsonText, likeContains, parseJson } from '../lib/query'
import { getClientIp, getUserAgent, type AppContext } from '../lib/http'
import type { AuditDraft, AuditEntry, AuditLogRow, Auditor, Pagination } from '../types'

// ============================================================================
// Audit log.
//
// Write path: a mutating service calls `auditor.claim({...})` and then puts
// `auditInsertStmt(db, entry)` into the SAME `db.batch()` as its writes. The
// log row therefore commits in the same transaction as the change it
// describes, and `handled` becomes true so the fallback logger stays quiet.
//
// The table is append-only: there is no UPDATE or DELETE path anywhere.
// ============================================================================

const AUDIT_COLUMNS = [
  'id',
  'actor_user_id',
  'actor_label',
  'actor_role',
  'impersonated_by',
  'action',
  'target_type',
  'target_id',
  'target_label',
  'status',
  'before',
  'after',
  'metadata',
  'ip',
  'user_agent',
  'request_id',
  'created_at',
].join(', ')

const AUDIT_BIND_COUNT = 17

export function auditInsertStmt(db: D1Database, entry: AuditEntry): D1PreparedStatement {
  return db
    .prepare(
      `INSERT INTO audit_logs (${AUDIT_COLUMNS}) VALUES (${new Array(AUDIT_BIND_COUNT)
        .fill('?')
        .join(',')})`,
    )
    .bind(
      entry.id,
      entry.actorUserId,
      entry.actorLabel,
      entry.actorRole,
      entry.impersonatedBy,
      entry.action,
      entry.targetType,
      entry.targetId,
      entry.targetLabel,
      entry.status,
      entry.before,
      entry.after,
      entry.metadata,
      entry.ip,
      entry.userAgent,
      entry.requestId,
      entry.createdAt,
    )
}

/**
 * Derives the human label stored alongside an actor FK.
 *
 * Tolerant of both row shapes because it is called with a `UserRow` (from the
 * database) and an `AuthUser` (from the session) — `display_name` vs
 * `displayName` — and callers should not have to care which they hold.
 */
export function actorLabelOf(user: {
  username: string
  display_name?: string | null
  displayName?: string | null
}): string {
  const display = (user.displayName ?? user.display_name ?? '').trim()
  return display.length > 0 ? display : user.username
}

export function createAuditor(c: AppContext, requestId: string): Auditor {
  const entries: AuditEntry[] = []
  const ip = getClientIp(c)
  const userAgent = getUserAgent(c)
  let handled = false

  return {
    get handled(): boolean {
      return handled
    },
    get entries(): readonly AuditEntry[] {
      return entries
    },
    claim(draft: AuditDraft): AuditEntry {
      handled = true
      // Read the actor LAZILY: this collector is installed before the auth
      // middleware runs, so `c.get('user')` is only populated by claim time.
      const user = c.get('user')
      const entry: AuditEntry = {
        id: ulid(),
        createdAt: now(),
        action: draft.action,
        status: draft.status ?? 'success',
        actorUserId: draft.actorUserId === undefined ? (user?.id ?? null) : draft.actorUserId,
        actorLabel:
          draft.actorLabel === undefined
            ? user
              ? actorLabelOf(user)
              : null
            : draft.actorLabel,
        actorRole: draft.actorRole === undefined ? (user?.role ?? null) : draft.actorRole,
        impersonatedBy:
          draft.impersonatedBy === undefined ? (user?.impersonatedBy ?? null) : draft.impersonatedBy,
        targetType: draft.targetType ?? null,
        targetId: draft.targetId ?? null,
        targetLabel: draft.targetLabel ?? null,
        before: jsonText(draft.before),
        after: jsonText(draft.after),
        metadata: jsonText(draft.metadata),
        ip,
        userAgent,
        requestId,
      }
      entries.push(entry)
      return entry
    },
  }
}

/**
 * Writes an entry on its own, for work that happens outside a request
 * (scheduled cleanups, seeding). Request paths must use the batch form.
 */
export async function recordAudit(db: D1Database, entry: AuditEntry): Promise<void> {
  await auditInsertStmt(db, entry).run()
}

/** Builds an entry without a request context. */
export function standaloneEntry(draft: AuditDraft, requestId = 'system'): AuditEntry {
  return {
    id: ulid(),
    createdAt: now(),
    action: draft.action,
    status: draft.status ?? 'success',
    actorUserId: draft.actorUserId ?? null,
    actorLabel: draft.actorLabel ?? null,
    actorRole: draft.actorRole ?? null,
    impersonatedBy: draft.impersonatedBy ?? null,
    targetType: draft.targetType ?? null,
    targetId: draft.targetId ?? null,
    targetLabel: draft.targetLabel ?? null,
    before: jsonText(draft.before),
    after: jsonText(draft.after),
    metadata: jsonText(draft.metadata),
    ip: null,
    userAgent: null,
    requestId,
  }
}

// ---------------------------------------------------------------- reading ---

export interface AuditLogQuery {
  actorId?: string | undefined
  action?: string | undefined
  targetType?: string | undefined
  targetId?: string | undefined
  status?: string | undefined
  from?: number | undefined
  to?: number | undefined
  q?: string | undefined
}

function auditFilters(query: AuditLogQuery): { where: string; binds: unknown[] } {
  const clauses: string[] = []
  const binds: unknown[] = []

  if (query.actorId) {
    clauses.push('actor_user_id = ?')
    binds.push(query.actorId)
  }
  if (query.action) {
    clauses.push('action = ?')
    binds.push(query.action)
  }
  if (query.targetType) {
    clauses.push('target_type = ?')
    binds.push(query.targetType)
  }
  if (query.targetId) {
    clauses.push('target_id = ?')
    binds.push(query.targetId)
  }
  if (query.status) {
    clauses.push('status = ?')
    binds.push(query.status)
  }
  if (query.from !== undefined) {
    clauses.push('created_at >= ?')
    binds.push(query.from)
  }
  if (query.to !== undefined) {
    clauses.push('created_at <= ?')
    binds.push(query.to)
  }
  if (query.q) {
    // coalesce() because `x LIKE y` is NULL (not false) when x is NULL, which
    // would silently drop rows that have no label from an OR chain.
    const pattern = likeContains(query.q)
    clauses.push(
      "(lower(action) LIKE lower(?) ESCAPE '\\'" +
        " OR lower(coalesce(actor_label, '')) LIKE lower(?) ESCAPE '\\'" +
        " OR lower(coalesce(target_label, '')) LIKE lower(?) ESCAPE '\\')",
    )
    binds.push(pattern, pattern, pattern)
  }

  return { where: andWhere(clauses), binds }
}

export interface AuditPage {
  rows: AuditLogRow[]
  total: number
}

export async function listAuditLogs(
  db: D1Database,
  query: AuditLogQuery,
  pagination: Pagination,
): Promise<AuditPage> {
  const { where, binds } = auditFilters(query)

  const [rowsResult, countResult] = await db.batch([
    db
      .prepare(
        `SELECT * FROM audit_logs ${where} ORDER BY created_at DESC, id DESC LIMIT ? OFFSET ?`,
      )
      .bind(...binds, pagination.limit, pagination.offset),
    db.prepare(`SELECT count(*) AS total FROM audit_logs ${where}`).bind(...binds),
  ])

  const rows = (rowsResult?.results ?? []) as unknown as AuditLogRow[]
  const countRow = (countResult?.results?.[0] ?? null) as { total?: unknown } | null

  return { rows, total: asCount(countRow) }
}

export async function getAuditLog(db: D1Database, id: string): Promise<AuditLogRow | null> {
  const row = await db
    .prepare('SELECT * FROM audit_logs WHERE id = ? LIMIT 1')
    .bind(id)
    .first<AuditLogRow>()
  return row ?? null
}

/** Distinct action names, for populating admin filter dropdowns. */
export async function listAuditActions(db: D1Database): Promise<string[]> {
  const { results } = await db
    .prepare('SELECT DISTINCT action FROM audit_logs ORDER BY action ASC')
    .all<{ action: string }>()
  return results.map((row) => row.action)
}

export interface AuditLogDto extends Omit<AuditLogRow, 'before' | 'after' | 'metadata'> {
  before: unknown
  after: unknown
  metadata: unknown
}

export function toAuditLogDto(row: AuditLogRow): AuditLogDto {
  return {
    ...row,
    before: parseJson<unknown>(row.before),
    after: parseJson<unknown>(row.after),
    metadata: parseJson<unknown>(row.metadata),
  }
}

/**
 * Retention cleanup for the scheduled handler.
 *
 * `retentionDays <= 0` means "keep forever", which is the current default: an
 * audit trail that silently drops rows is worse than a large table.
 */
export async function pruneAuditLogs(
  db: D1Database,
  retentionDays: number,
  maxRows = 5_000,
): Promise<number> {
  if (retentionDays <= 0) return 0
  const cutoff = now() - retentionDays * 24 * 60 * 60 * 1000
  const result = await db
    .prepare(
      `DELETE FROM audit_logs WHERE id IN (
         SELECT id FROM audit_logs WHERE created_at < ? ORDER BY created_at ASC LIMIT ?
       )`,
    )
    .bind(cutoff, maxRows)
    .run()
  return result.meta.changes ?? 0
}

