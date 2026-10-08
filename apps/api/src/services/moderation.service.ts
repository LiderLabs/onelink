import { DAY } from '../lib/constants'
import { badRequest, conflict, notFound } from '../lib/errors'
import { normalizeSlug } from '../lib/http'
import { now } from '../lib/clock'
import { assertCanModerateUser } from '../lib/rbac'
import { sha256HexOfBytes } from '../lib/crypto'
import { ulid } from '../lib/ids'
import { auditInsertStmt } from './audit.service'
import { getNumberSetting, SETTING_KEYS } from './settings.service'
import type { ActorInfo, Auditor, Pagination } from '../types'

export interface CreatePageReportInput {
  slug: string
  targetType: 'page' | 'link' | 'user'
  linkId: string | null
  category: string
  description: string | null
  reporterUserId: string | null
  reporterLabel: string | null
  reporterEmail: string | null
  reporterIp: string | null
}

export async function createPageReport(
  db: D1Database,
  input: CreatePageReportInput,
  auditor: Auditor,
): Promise<{ id: string; duplicate: boolean }> {
  const slug = normalizeSlug(input.slug)
    const page = await db.prepare(`SELECT p.id,p.slug,p.title,p.bio,p.theme,p.layout,p.accent_color,p.show_branding,
      p.user_id,u.id AS owner_id,u.username,u.display_name
    FROM pages p JOIN users u ON u.id=p.user_id
    WHERE p.slug=? AND p.deleted_at IS NULL AND p.status='published'
      AND p.moderation_status='visible' AND u.status='active' AND u.deleted_at IS NULL LIMIT 1`)
    .bind(slug).first<Record<string, unknown> & { id: string; slug: string; user_id: string; owner_id: string }>()
  if (!page) throw notFound('Page')

  const timestamp = now()
  const targetId = input.targetType === 'user' ? page.owner_id : input.targetType === 'link' ? input.linkId : page.id
  let targetSnapshot: Record<string, unknown> = { type: 'page', id: page.id }
  if (input.targetType === 'link') {
    const targetLink = await db.prepare(`SELECT id,title,url,domain,description FROM page_links
      WHERE id=? AND page_id=? AND deleted_at IS NULL AND is_visible=1
        AND (starts_at IS NULL OR starts_at<=?) AND (ends_at IS NULL OR ends_at>=?) LIMIT 1`)
      .bind(input.linkId, page.id, timestamp, timestamp).first<Record<string, unknown>>()
    if (!targetLink) throw notFound('Link')
    targetSnapshot = { type: 'link', ...targetLink }
  } else if (input.targetType === 'user') {
    targetSnapshot = { type: 'user', id: page.owner_id, username: page.username, displayName: page.display_name }
  }
  const reporterKey = input.reporterUserId ?? input.reporterEmail?.toLowerCase() ?? input.reporterIp ?? 'anonymous'
  const dedupeKey = await sha256HexOfBytes(new TextEncoder().encode(
    `${input.targetType}\n${targetId}\n${input.category}\n${reporterKey}`,
  ))
  const duplicate = await db.prepare(`SELECT id FROM reports
    WHERE dedupe_key=? AND created_at>=? LIMIT 1`).bind(dedupeKey, timestamp - DAY).first<{ id: string }>()
  if (duplicate) return { id: duplicate.id, duplicate: true }

  const { results: links } = await db.prepare(`SELECT id,title,url,domain,description
      FROM page_links WHERE page_id=? AND deleted_at IS NULL AND is_visible=1
        AND (starts_at IS NULL OR starts_at<=?) AND (ends_at IS NULL OR ends_at>=?)
      ORDER BY position,id`).bind(page.id, timestamp, timestamp).all<Record<string, unknown>>()
  const snapshot = JSON.stringify({
    target: targetSnapshot,
    page: {
      slug: page.slug,
      title: page.title,
      bio: page.bio,
      theme: page.theme,
      layout: page.layout,
      accentColor: page.accent_color,
      showBranding: page.show_branding,
      owner: { username: page.username, displayName: page.display_name },
    },
    links,
  })
  const id = ulid()
  const flagId = ulid()
  const entry = auditor.claim({
    action: 'report.create',
    targetType: 'report',
    targetId: id,
    metadata: { targetType: input.targetType, targetId, category: input.category },
  })
  await db.batch([
    db.prepare(`INSERT INTO reports (
      id,target_type,target_id,page_id,target_snapshot,reporter_user_id,reporter_label,
      reporter_email,reporter_ip,category,description,status,priority,dedupe_key,created_at,updated_at
    ) VALUES (?,?,?,?,?,?,?,?,?,?,?,'open',0,?,?,?)`)
      .bind(id, input.targetType, targetId, page.id, snapshot, input.reporterUserId, input.reporterLabel,
        input.reporterEmail, input.reporterIp, input.category, input.description, dedupeKey, timestamp, timestamp),
    db.prepare(`INSERT INTO content_flags(id,target_type,target_id,page_id,source,rule,matched_text,severity,status,report_id,created_at)
      VALUES(?,?,?,?, 'user',?,?,?,'open',?,?)`)
      .bind(flagId, input.targetType, targetId, page.id, input.category, input.description,
        input.category === 'malware' ? 3 : input.category === 'harassment' ? 2 : 1, id, timestamp),
    auditInsertStmt(db, entry),
  ])
  return { id, duplicate: false }
}

export interface ReportQuery {
  status?: string | undefined
  category?: string | undefined
}

export async function listReports(db: D1Database, query: ReportQuery, pagination: Pagination) {
  const conditions: string[] = []
  const binds: unknown[] = []
  if (query.status) { conditions.push('r.status=?'); binds.push(query.status) }
  if (query.category) { conditions.push('r.category=?'); binds.push(query.category) }
  const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : ''
  const [rows, count] = await Promise.all([
    db.prepare(`SELECT r.id,r.target_type,r.target_id,r.page_id,r.reporter_label,r.category,
        r.status,r.priority,r.assigned_admin_id,r.created_at,r.updated_at
      FROM reports r ${where} ORDER BY r.priority DESC,r.created_at ASC,r.id ASC LIMIT ? OFFSET ?`)
      .bind(...binds, pagination.limit, (pagination.page - 1) * pagination.limit)
      .all<Record<string, unknown>>(),
    db.prepare(`SELECT count(*) AS total FROM reports r ${where}`).bind(...binds).first<{ total: number }>(),
  ])
  return { rows: rows.results, total: count?.total ?? 0 }
}

export async function getReport(db: D1Database, id: string) {
  const report = await db.prepare('SELECT * FROM reports WHERE id=?').bind(id).first<Record<string, unknown>>()
  if (!report) throw notFound('Report')
  const { results: actions } = await db.prepare(`SELECT * FROM report_actions WHERE report_id=?
    ORDER BY created_at ASC,id ASC`).bind(id).all<Record<string, unknown>>()
  return { ...report, actions }
}

export async function assignReport(
  db: D1Database,
  reportId: string,
  actor: { id: string; label: string },
  auditor: Auditor,
): Promise<void> {
  const existing = await db.prepare('SELECT id,status,assigned_admin_id FROM reports WHERE id=?')
    .bind(reportId).first<{ id: string; status: string; assigned_admin_id: string | null }>()
  if (!existing) throw notFound('Report')
  if (existing.status !== 'open' && existing.status !== 'reviewing') throw notFound('Report')
  const timestamp = now()
  const entry = auditor.claim({ action: 'report.assign', targetType: 'report', targetId: reportId,
    before: { assignedAdminId: existing.assigned_admin_id }, after: { assignedAdminId: actor.id } })
  const results = await db.batch([
    db.prepare(`UPDATE reports SET assigned_admin_id=?,status='reviewing',updated_at=?
      WHERE id=? AND status IN ('open','reviewing')`).bind(actor.id, timestamp, reportId),
    db.prepare(`INSERT INTO report_actions(id,report_id,admin_id,admin_label,action,notes,created_at)
      VALUES(?,?,?,?,'assign',?,?)`).bind(ulid(), reportId, actor.id, actor.label, 'Assigned to self.', timestamp),
    auditInsertStmt(db, entry),
  ])
  if (results[0]?.meta.changes !== 1) throw notFound('Report')
}

export async function resolveReport(
  db: D1Database,
  reportId: string,
  status: 'resolved' | 'dismissed' | 'duplicate',
  notes: string | null,
  actor: { id: string; label: string },
  auditor: Auditor,
): Promise<void> {
  const existing = await db.prepare('SELECT id,status FROM reports WHERE id=?').bind(reportId)
    .first<{ id: string; status: string }>()
  if (!existing) throw notFound('Report')
  if (existing.status !== 'open' && existing.status !== 'reviewing') throw notFound('Report')
  const timestamp = now()
  const action = status === 'dismissed' ? 'dismiss' : 'note'
  const entry = auditor.claim({ action: 'report.resolve', targetType: 'report', targetId: reportId,
    before: { status: existing.status }, after: { status }, metadata: { notes } })
  const results = await db.batch([
    db.prepare(`UPDATE reports SET status=?,resolution_action=?,resolved_by=?,resolved_by_label=?,
      resolved_at=?,updated_at=? WHERE id=? AND status IN ('open','reviewing')`)
      .bind(status, action, actor.id, actor.label, timestamp, timestamp, reportId),
    db.prepare(`INSERT INTO report_actions(id,report_id,admin_id,admin_label,action,notes,created_at)
      VALUES(?,?,?,?,?,?,?)`).bind(ulid(), reportId, actor.id, actor.label, action, notes, timestamp),
    auditInsertStmt(db, entry),
  ])
  if (results[0]?.meta.changes !== 1) throw notFound('Report')
}

export async function createAppeal(db: D1Database, actor: ActorInfo, sanctionId: string, message: string, auditor: Auditor) {
  const sanction = await db.prepare(`SELECT id,type,reason,status,created_at,expires_at FROM sanctions
      WHERE id=? AND user_id=? LIMIT 1`).bind(sanctionId, actor.id)
    .first<{ id: string; type: string; reason: string; status: string; created_at: number; expires_at: number | null }>()
  if (!sanction) throw notFound('Sanction')
  const timestamp = now()
  const windowDays = await getNumberSetting(db, SETTING_KEYS.appealWindowDays, 30)
  if (timestamp > sanction.created_at + windowDays * DAY) throw badRequest('The appeal period has ended.')
  if (sanction.status !== 'active' || (sanction.expires_at !== null && sanction.expires_at <= timestamp)) {
    throw badRequest('Only an active sanction can be appealed.')
  }
  const maximum = Math.max(1, Math.trunc(await getNumberSetting(db, SETTING_KEYS.maxAppealAttempts, 2)))
  const [attempts, pending] = await Promise.all([
    db.prepare('SELECT count(*) AS total FROM appeals WHERE sanction_id=?').bind(sanctionId).first<{ total: number }>(),
    db.prepare("SELECT id FROM appeals WHERE sanction_id=? AND status='pending' LIMIT 1").bind(sanctionId).first<{ id: string }>(),
  ])
  if (pending) throw conflict('An appeal for this sanction is already pending.')
  const attempt = (attempts?.total ?? 0) + 1
  if (attempt > maximum) throw badRequest('The maximum number of appeals has been reached.')

  const id = ulid()
  const entry = auditor.claim({ action: 'appeal.create', targetType: 'appeal', targetId: id,
    actorUserId: actor.id, actorRole: actor.role, actorLabel: actor.label,
    metadata: { sanctionId, attempt } })
  await db.batch([
    db.prepare(`INSERT INTO appeals(id,user_id,sanction_id,message,attempt,status,created_at)
      VALUES(?,?,?, ?,?,'pending',?)`).bind(id, actor.id, sanctionId, message, attempt, timestamp),
    auditInsertStmt(db, entry),
  ])
  return { id, sanctionId, attempt, status: 'pending' as const, createdAt: timestamp }
}

export async function listUserAppeals(db: D1Database, userId: string) {
  const { results } = await db.prepare(`SELECT id,sanction_id,message,attempt,status,reviewed_at,decision,decision_notes,created_at
    FROM appeals WHERE user_id=? ORDER BY created_at DESC,id DESC`).bind(userId).all<Record<string, unknown>>()
  return results
}

export async function listAppeals(db: D1Database, status: string | undefined, pagination: Pagination) {
  const where = status ? 'WHERE a.status=?' : ''
  const binds: unknown[] = status ? [status] : []
  const [rows, count] = await Promise.all([
    db.prepare(`SELECT a.id,a.user_id,a.sanction_id,a.attempt,a.status,a.created_at,a.reviewed_at,
        u.username,u.email,s.type AS sanction_type,s.reason AS sanction_reason
      FROM appeals a JOIN users u ON u.id=a.user_id JOIN sanctions s ON s.id=a.sanction_id
      ${where} ORDER BY a.created_at ASC,a.id ASC LIMIT ? OFFSET ?`)
      .bind(...binds, pagination.limit, (pagination.page - 1) * pagination.limit).all<Record<string, unknown>>(),
    db.prepare(`SELECT count(*) AS total FROM appeals a ${where}`).bind(...binds).first<{ total: number }>(),
  ])
  return { rows: rows.results, total: count?.total ?? 0 }
}

export async function getAppeal(db: D1Database, appealId: string) {
  const appeal = await db.prepare(`SELECT a.*,u.username,u.email,s.type AS sanction_type,
      s.reason AS sanction_reason,s.status AS sanction_status,s.duration_hours,s.expires_at
    FROM appeals a JOIN users u ON u.id=a.user_id JOIN sanctions s ON s.id=a.sanction_id
    WHERE a.id=? LIMIT 1`).bind(appealId).first<Record<string, unknown>>()
  if (!appeal) throw notFound('Appeal')
  return appeal
}

export async function decideAppeal(
  db: D1Database,
  appealId: string,
  actor: ActorInfo,
  decision: 'uphold' | 'overturn' | 'reduce',
  notes: string,
  reducedDurationHours: number | undefined,
  auditor: Auditor,
): Promise<void> {
  const appeal = await db.prepare(`SELECT a.id,a.user_id,a.sanction_id,a.status,s.type,s.reason,s.status AS sanction_status,
      s.duration_hours,s.expires_at,u.role,u.status AS user_status,u.status_reason
    FROM appeals a JOIN sanctions s ON s.id=a.sanction_id JOIN users u ON u.id=a.user_id
    WHERE a.id=? LIMIT 1`).bind(appealId).first<{
      id: string; user_id: string; sanction_id: string; status: string; type: string; reason: string
      sanction_status: string; duration_hours: number | null; expires_at: number | null
      role: ActorInfo['role']; user_status: string; status_reason: string | null
    }>()
  if (!appeal || appeal.status !== 'pending') throw notFound('Appeal')
  assertCanModerateUser(actor, { id: appeal.user_id, role: appeal.role })
  if (decision === 'reduce') {
    if (appeal.type !== 'suspend' || appeal.sanction_status !== 'active' || reducedDurationHours === undefined) {
      throw badRequest('Only an active timed suspension can be reduced.')
    }
    if (appeal.duration_hours !== null && reducedDurationHours >= appeal.duration_hours) {
      throw badRequest('The reduced duration must be shorter than the original sanction.')
    }
  }
  if (decision === 'overturn' && appeal.sanction_status !== 'active') {
    throw badRequest('Only an active sanction can be overturned.')
  }

  const timestamp = now()
  const appealStatus = decision === 'uphold' ? 'rejected' : 'approved'
  const entry = auditor.claim({ action: 'appeal.decide', targetType: 'appeal', targetId: appealId,
    actorUserId: actor.id, actorRole: actor.role, actorLabel: actor.label,
    before: { status: 'pending' }, after: { status: appealStatus, decision }, metadata: { notes } })
  const statements: D1PreparedStatement[] = []

  if (decision === 'overturn') {
    statements.push(db.prepare(`UPDATE sanctions SET status='overturned',lifted_by=?,lifted_at=?,lift_reason=?
      WHERE id=? AND status='active' AND EXISTS (SELECT 1 FROM appeals WHERE id=? AND status='pending')`)
      .bind(actor.id, timestamp, notes, appeal.sanction_id, appealId))
    if ((appeal.type === 'suspend' || appeal.type === 'ban') && appeal.user_status !== 'active' &&
        appeal.status_reason === appeal.reason) {
      statements.push(db.prepare(`UPDATE users SET status='active',status_reason=NULL,status_changed_at=?,
          suspended_until=NULL,suspended_permanently=0,updated_at=?
        WHERE id=? AND status_reason=? AND NOT EXISTS (
          SELECT 1 FROM sanctions WHERE user_id=? AND id<>? AND status='active' AND type IN ('suspend','ban')
        ) AND EXISTS (SELECT 1 FROM appeals WHERE id=? AND status='pending')`)
        .bind(timestamp, timestamp, appeal.user_id, appeal.reason, appeal.user_id, appeal.sanction_id, appealId))
    }
  } else if (decision === 'reduce') {
    statements.push(db.prepare(`UPDATE sanctions SET duration_hours=?,expires_at=?
      WHERE id=? AND status='active' AND EXISTS (SELECT 1 FROM appeals WHERE id=? AND status='pending')`)
      .bind(reducedDurationHours, timestamp + reducedDurationHours! * 60 * 60 * 1000, appeal.sanction_id, appealId))
  }

  statements.push(
    db.prepare(`UPDATE appeals SET status=?,decision=?,decision_notes=?,reviewed_by=?,reviewed_by_label=?,reviewed_at=?
      WHERE id=? AND status='pending'`).bind(appealStatus, decision, notes, actor.id, actor.label, timestamp, appealId),
    auditInsertStmt(db, entry, true),
  )
  const results = await db.batch(statements)
  const appealResult = results[results.length - 2]
  if (appealResult?.meta.changes !== 1) throw conflict('The appeal was decided by another moderator.')
}

export async function listContentFlags(db: D1Database, status: string | undefined, pagination: Pagination) {
  const where = status ? 'WHERE f.status=?' : ''
  const binds: unknown[] = status ? [status] : []
  const [rows, count] = await Promise.all([
    db.prepare(`SELECT f.id,f.target_type,f.target_id,f.page_id,f.source,f.rule,f.matched_text,
        f.severity,f.status,f.report_id,f.created_at,p.slug AS page_slug
      FROM content_flags f LEFT JOIN pages p ON p.id=f.page_id ${where}
      ORDER BY f.severity DESC,f.created_at ASC,f.id ASC LIMIT ? OFFSET ?`)
      .bind(...binds, pagination.limit, (pagination.page - 1) * pagination.limit).all<Record<string, unknown>>(),
    db.prepare(`SELECT count(*) AS total FROM content_flags f ${where}`).bind(...binds).first<{ total: number }>(),
  ])
  return { rows: rows.results, total: count?.total ?? 0 }
}

export async function reviewContentFlag(
  db: D1Database,
  flagId: string,
  status: 'cleared' | 'actioned' | 'escalated',
  notes: string,
  actor: { id: string; label: string },
  auditor: Auditor,
): Promise<void> {
  const flag = await db.prepare('SELECT id,status FROM content_flags WHERE id=?').bind(flagId)
    .first<{ id: string; status: string }>()
  if (!flag || flag.status !== 'open') throw notFound('Content flag')
  const timestamp = now()
  const entry = auditor.claim({ action: 'content_flag.review', targetType: 'content_flag', targetId: flagId,
    before: { status: flag.status }, after: { status }, metadata: { notes } })
  const results = await db.batch([
    db.prepare(`UPDATE content_flags SET status=?,reviewed_by=?,reviewed_at=?,review_notes=?
      WHERE id=? AND status='open'`).bind(status, actor.id, timestamp, notes, flagId),
    auditInsertStmt(db, entry, true),
  ])
  if (results[0]?.meta.changes !== 1) throw notFound('Content flag')
}

export async function moderatePageContent(
  db: D1Database,
  pageId: string,
  action: 'remove_content' | 'restore',
  reason: string,
  reportId: string | null,
  actor: ActorInfo,
  auditor: Auditor,
): Promise<void> {
  const page = await db.prepare(`SELECT p.id,p.slug,p.user_id,p.moderation_status,p.removed_reason,u.role
    FROM pages p JOIN users u ON u.id=p.user_id WHERE p.id=? AND p.deleted_at IS NULL LIMIT 1`)
    .bind(pageId).first<{ id: string; slug: string; user_id: string; moderation_status: string; removed_reason: string | null; role: ActorInfo['role'] }>()
  if (!page) throw notFound('Page')
  assertCanModerateUser(actor, { id: page.user_id, role: page.role })
  if (action === 'remove_content' && page.moderation_status === 'removed') throw conflict('That page is already removed.')
  if (action === 'restore' && page.moderation_status !== 'removed') throw conflict('That page is not removed.')
  if (reportId) {
    const report = await db.prepare('SELECT id FROM reports WHERE id=? AND page_id=? LIMIT 1')
      .bind(reportId, pageId).first()
    if (!report) throw notFound('Report')
  }

  const timestamp = now()
  const entry = auditor.claim({ action: action === 'remove_content' ? 'content.page_remove' : 'content.page_restore',
    targetType: 'page', targetId: page.id, targetLabel: page.slug,
    before: { moderationStatus: page.moderation_status, removedReason: page.removed_reason },
    after: { moderationStatus: action === 'remove_content' ? 'removed' : 'visible', reason, reportId } })
  const update = action === 'remove_content'
    ? db.prepare(`UPDATE pages SET moderation_status='removed',removed_at=?,removed_by=?,removed_reason=?,
        removed_report_id=?,updated_at=? WHERE id=? AND moderation_status!='removed' AND deleted_at IS NULL`)
      .bind(timestamp, actor.id, reason, reportId, timestamp, pageId)
    : db.prepare(`UPDATE pages SET moderation_status='visible',removed_at=NULL,removed_by=NULL,removed_reason=NULL,
        removed_report_id=NULL,restored_at=?,restored_by=?,updated_at=?
        WHERE id=? AND moderation_status='removed' AND deleted_at IS NULL`)
      .bind(timestamp, actor.id, timestamp, pageId)
  const statements = [update]
  if (reportId) {
    const reportAction = action === 'remove_content' ? 'remove_content' : 'restore'
    statements.push(db.prepare(`INSERT INTO report_actions(id,report_id,admin_id,admin_label,action,target_user_id,notes,created_at)
      SELECT ?,?,?,?,?,?,?,? WHERE changes()=1`)
      .bind(ulid(), reportId, actor.id, actor.label, reportAction, page.user_id, reason, timestamp))
  }
  statements.push(auditInsertStmt(db, entry, true))
  const results = await db.batch(statements)
  if (results[0]?.meta.changes !== 1) throw conflict('The page moderation state changed. Refresh and try again.')
}