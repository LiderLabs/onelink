import { request, requestList } from '../../lib/api'
import type { PublicUser, Role } from '../../lib/types'

export const REPORT_STATUSES = ['open', 'reviewing', 'resolved', 'dismissed', 'duplicate'] as const
export const REPORT_CATEGORIES = ['spam', 'abuse', 'nsfw', 'impersonation', 'copyright', 'malware', 'harassment', 'other'] as const
export const APPEAL_STATUSES = ['pending', 'approved', 'rejected', 'withdrawn'] as const
export type ReportStatus = typeof REPORT_STATUSES[number]
export type ReportCategory = typeof REPORT_CATEGORIES[number]
export type AppealStatus = typeof APPEAL_STATUSES[number]
export type AppealDecision = 'uphold' | 'overturn' | 'reduce'

// Moderation endpoints return database projections, including snake_case.
export interface ReportRow {
  id: string
  target_type: 'page' | 'link' | 'user'
  target_id: string
  page_id: string | null
  reporter_label: string | null
  category: ReportCategory
  status: ReportStatus
  priority: number
  assigned_admin_id: string | null
  created_at: number
  updated_at: number
}
export interface ReportAction {
  id: string
  admin_label: string | null
  action: string
  notes: string | null
  target_user_id: string | null
  created_at: number
}
export interface ReportDetail extends ReportRow {
  target_snapshot: string | null
  reporter_user_id: string | null
  reporter_email: string | null
  reporter_ip: string | null
  description: string | null
  resolution_action: string | null
  resolved_by_label: string | null
  resolved_at: number | null
  actions: ReportAction[]
}
export interface AppealRow {
  id: string
  user_id: string
  sanction_id: string
  attempt: number
  status: AppealStatus
  created_at: number
  reviewed_at: number | null
  username: string
  email: string
  sanction_type: string
  sanction_reason: string
}
export interface AppealDetail extends AppealRow {
  message: string
  decision: AppealDecision | null
  decision_notes: string | null
  reviewed_by_label: string | null
  sanction_status: string
  duration_hours: number | null
  expires_at: number | null
}

function post<T>(path: string, body?: unknown) {
  return request<T>(path, { method: 'POST', ...(body === undefined ? {} : { body: JSON.stringify(body) }) })
}
export const moderationApi = {
  reports: (page: number, status: string, category: string) => {
    const query = new URLSearchParams({ page: String(page), limit: '20' })
    if (status) query.set('status', status)
    if (category) query.set('category', category)
    return requestList<ReportRow>(`/admin/reports?${query}`)
  },
  report: (id: string) => request<ReportDetail>(`/admin/reports/${encodeURIComponent(id)}`),
  assign: (id: string) => post<ReportDetail>(`/admin/reports/${encodeURIComponent(id)}/assign`),
  resolve: (id: string, status: 'resolved' | 'dismissed' | 'duplicate', notes: string) =>
    post<ReportDetail>(`/admin/reports/${encodeURIComponent(id)}/resolve`, { status, notes }),
  removePage: (pageId: string, reason: string, reportId: string) =>
    post<{ pageId: string; moderationStatus: string }>(`/admin/content/pages/${encodeURIComponent(pageId)}/remove`, { reason, reportId }),
  sanction: (userId: string, action: 'warn' | 'ban', reason: string, category: ReportCategory, reportId: string) =>
    post<{ sanction: unknown }>(`/admin/users/${encodeURIComponent(userId)}/${action}`, { reason, category, reportId }),
  user: (id: string) => request<{ user: PublicUser }>(`/admin/users/${encodeURIComponent(id)}`),
  reportOwner: async (id: string | null, username: string | null): Promise<{ user: PublicUser | null }> => {
    if (id) return request<{ user: PublicUser }>(`/admin/users/${encodeURIComponent(id)}`)
    if (!username) return { user: null }
    const query = new URLSearchParams({ q: username, page: '1', limit: '100' })
    const result = await requestList<PublicUser>(`/admin/users?${query}`)
    const exact = result.items.filter(item => item.username.toLowerCase() === username.toLowerCase())
    return { user: exact.length === 1 ? exact[0]! : null }
  },
  appeals: (page: number, status: string) => {
    const query = new URLSearchParams({ page: String(page), limit: '20' })
    if (status) query.set('status', status)
    return requestList<AppealRow>(`/admin/appeals?${query}`)
  },
  appeal: (id: string) => request<AppealDetail>(`/admin/appeals/${encodeURIComponent(id)}`),
  decide: (id: string, decision: AppealDecision, notes: string, reducedDurationHours?: number) =>
    post<AppealDetail>(`/admin/appeals/${encodeURIComponent(id)}/decision`, {
      decision, notes, ...(decision === 'reduce' ? { reducedDurationHours } : {}),
    }),
}

type JsonObject = Record<string, unknown>
function object(value: unknown): JsonObject | null {
  return typeof value === 'object' && value !== null && !Array.isArray(value) ? value as JsonObject : null
}
export function reportEvidence(report: ReportDetail) {
  let snapshot: JsonObject | null = null
  try { snapshot = object(JSON.parse(report.target_snapshot ?? 'null')) } catch { /* Keep corrupt stored evidence visible as text. */ }
  const page = object(snapshot?.page)
  const target = object(snapshot?.target)
  const owner = object(snapshot?.owner) ?? object(page?.owner)
  const ownerId = typeof owner?.id === 'string' ? owner.id
    : report.target_type === 'user' ? report.target_id
    : target?.type === 'user' && typeof target.id === 'string' ? target.id : null
  const ownerUsername = typeof owner?.username === 'string' ? owner.username : null
  const slug = typeof page?.slug === 'string' ? page.slug : typeof snapshot?.slug === 'string' ? snapshot.slug : null
  // Only build an internal public-page address from an actual stored slug.
  const publicPath = slug && /^[a-z0-9][a-z0-9_-]{0,63}$/i.test(slug) ? `/p/${encodeURIComponent(slug)}` : null
  const label = typeof page?.title === 'string' && page.title ? page.title
    : typeof target?.title === 'string' ? target.title : report.target_type === 'user' ? 'Reported user' : 'Reported content'
  return { snapshot, ownerId, ownerUsername, publicPath, label }
}

const ranks: Record<Role, number> = { owner: 50, admin: 40, moderator: 30, support: 20, user: 10 }
export function canModerateTarget(actor: { id: string; role: Role } | null, target: PublicUser | null): boolean {
  if (!actor || !target || actor.id === target.id || actor.role === 'user') return false
  return actor.role === 'owner' && target.role === 'owner' || ranks[actor.role] > ranks[target.role]
}
export function moderationDate(value: number | null | undefined): string {
  return typeof value === 'number' && Number.isFinite(value) ? new Date(value).toLocaleString() : '—'
}
