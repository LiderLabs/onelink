import { request, requestList } from '../../lib/api'
import type { PublicUser, Role, UserStatus } from '../../lib/types'

export const USER_ROLES: Role[] = ['owner', 'admin', 'moderator', 'support', 'user']
export const USER_STATUSES: UserStatus[] = ['active', 'pending', 'suspended', 'banned', 'deleted']
const rank: Record<Role, number> = { owner: 100, admin: 80, moderator: 60, support: 40, user: 10 }
type Actor = Pick<PublicUser, 'id' | 'role'>
export const grantableRoles = (role: Role) => USER_ROLES.filter(candidate => rank[candidate] < rank[role])
export const canEditUser = (actor: Actor, target: Actor) => rank[actor.role] >= rank[target.role]
export const canModerateUser = (actor: Actor, target: Actor) => actor.id !== target.id && (rank[actor.role] > rank[target.role] || (actor.role === 'owner' && target.role === 'owner'))

export interface UserSanction {
  id: string
  type: string
  reason: string
  issuedByLabel: string | null
  createdAt: number
  expiresAt: number | null
  status: string
}
export interface UserDetail {
  user: PublicUser
  counts: { pages: number; sessions: number; sanctions: number; notes: number; reportsAgainst: number; reportsFiled: number }
  sanctions: UserSanction[]
}
export interface UserNote {
  id: string
  userId: string
  authorId: string | null
  authorLabel: string | null
  body: string
  createdAt: number
}
export interface UserSession {
  id: string
  createdAt: number
  lastUsedAt: number | null
  expiresAt: number
  ip: string | null
  userAgent: string | null
  deviceLabel: string | null
  impersonatedBy: string | null
  revokedAt: number | null
  revokedReason: string | null
}
export interface CreateUserInput {
  email: string
  password: string
  username?: string
  displayName?: string
  role: Role
  requirePasswordChange: true
}
export interface UpdateUserInput { email?: string; username?: string; displayName?: string; bio?: string | null; role?: Role }
export interface UsersQuery { q: string; role: Role | ''; status: UserStatus | ''; sort: string; page: number; limit: number; includeDeleted: boolean }
const path = (id: string) => `/admin/users/${encodeURIComponent(id)}`
export const usersApi = {
  list(query: UsersQuery) {
    const params = new URLSearchParams({ page: String(query.page), limit: String(query.limit), sort: query.sort, includeDeleted: String(query.includeDeleted) })
    if (query.q) params.set('q', query.q)
    if (query.role) params.set('role', query.role)
    if (query.status) params.set('status', query.status)
    return requestList<PublicUser>(`/admin/users?${params}`)
  },
  detail: (id: string) => request<UserDetail>(path(id)),
  create: (input: CreateUserInput) => request<PublicUser>('/admin/users', { method: 'POST', body: JSON.stringify(input) }),
  update: (id: string, input: UpdateUserInput) => request<PublicUser>(path(id), { method: 'PATCH', body: JSON.stringify(input) }),
  moderate: (id: string, action: 'warn' | 'suspend' | 'ban' | 'reactivate', input: { reason: string; durationHours?: number; permanent?: boolean }) => request<{ user?: PublicUser; sanction?: { user: PublicUser; revokedSessions: number }; liftedSanctions?: number }>(`${path(id)}/${action}`, { method: 'POST', body: JSON.stringify(input) }),
  delete: (id: string, reason: string) => request<{ sanction: { user: PublicUser; revokedSessions: number } }>(`${path(id)}?${new URLSearchParams({ reason })}`, { method: 'DELETE' }),
  notes: (id: string, page = 1) => requestList<UserNote>(`${path(id)}/notes?page=${page}&limit=10`),
  addNote: (id: string, body: string) => request<UserNote>(`${path(id)}/notes`, { method: 'POST', body: JSON.stringify({ body }) }),
  sessions: (id: string) => request<{ sessions: UserSession[] }>(`${path(id)}/sessions`),
  revokeSessions: (id: string, reason: string) => request<{ revoked: number }>(`${path(id)}/sessions`, { method: 'DELETE', body: JSON.stringify({ reason }) }),
}

export function adminUserDate(value: number | null) {
  return value === null ? 'Never' : new Intl.DateTimeFormat(undefined, { dateStyle: 'medium', timeStyle: 'short' }).format(value)
}
