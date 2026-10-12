import type { SessionUser } from '../../lib/types'

export function isStaff(user: SessionUser | null): boolean {
  return Boolean(user && ['owner', 'admin', 'moderator', 'support'].includes(user.role))
}

export function signedInDestination(user: SessionUser): string {
  if (user.requirePasswordChange) return '/app/settings/security'
  if (user.status !== 'active' || user.impersonatedBy !== null) return '/app/dashboard'
  return isStaff(user) ? '/admin' : '/app'
}
