import { Hono } from 'hono'
import { list, ok } from '../lib/http'
import { notFound } from '../lib/errors'
import { parsePagination } from '../lib/query'
import { readEnum, readInt, readSearch, readString, readTimestamp } from '../lib/params'
import { requireCapability } from '../middleware/auth'
import {
  getAuditLog,
  listAuditActions,
  listAuditLogs,
  toAuditLogDto,
  type AuditLogQuery,
} from '../services/audit.service'
import type { AppEnv } from '../types'

// ============================================================================
// /api/v1/admin/audit-logs — read-only, `audit.read` (owner + admin).
//
// There is no POST/PATCH/DELETE here, and there never will be: the table is
// append-only, so an admin cannot edit their way out of a record.
// ============================================================================

const AUDIT_STATUSES = ['success', 'failure', 'denied'] as const
const AUDIT_TARGET_TYPES = ['user', 'settings', 'page', 'report', 'sanction', 'media'] as const

export const auditRoutes = new Hono<AppEnv>()

auditRoutes.get('/', requireCapability('audit.read'), async (c) => {
  const pagination = parsePagination({ page: readInt(c, 'page'), limit: readInt(c, 'limit') })

  const query: AuditLogQuery = {
    actorId: readString(c, 'actorId', 64),
    action: readString(c, 'action', 100),
    targetType: readEnum(c, 'targetType', AUDIT_TARGET_TYPES),
    targetId: readString(c, 'targetId', 64),
    status: readEnum(c, 'status', AUDIT_STATUSES),
    from: readTimestamp(c, 'from'),
    to: readTimestamp(c, 'to'),
    q: readSearch(c),
  }

  const { rows, total } = await listAuditLogs(c.env.DB, query, pagination)
  return list(c, rows.map(toAuditLogDto), total, pagination, {
    // Surfaced so the SPA can offer the available filters without extra calls.
    filters: query,
  })
})

/** Registered BEFORE `/:id` so `actions` is not swallowed by the id route. */
auditRoutes.get('/actions', requireCapability('audit.read'), async (c) => {
  const actions = await listAuditActions(c.env.DB)
  return ok(c, { actions })
})

auditRoutes.get('/:id', requireCapability('audit.read'), async (c) => {
  const id = c.req.param('id')
  const row = await getAuditLog(c.env.DB, id)
  if (!row) throw notFound('Audit entry')
  return ok(c, toAuditLogDto(row))
})
