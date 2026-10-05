import { formatDateTime, formatRelative } from '../lib/css'
import type { SessionUser } from '../lib/types'

// ============================================================================
// Shown whenever the signed-in account is not in good standing.
//
// The API deliberately answers 200 for a suspended user (see /auth/me) so the UI
// has something honest to say instead of a bare 403. This is that something:
// what happened, why, and until when.
// ============================================================================

export function SuspendedNotice({ user }: { user: SessionUser }) {
  if (user.status !== 'suspended' && user.status !== 'banned') return null

  const indefinite = user.suspendedPermanently || user.suspendedUntil === null
  const until = indefinite
    ? 'with no end date set'
    : `until ${formatDateTime(user.suspendedUntil)} (${formatRelative(user.suspendedUntil)})`

  return (
    <div role="alert" className="mt-6 border-l-2 border-l-vermilion bg-vermilion/8 py-4 pl-4 pr-3">
      <p className="eyebrow text-vermilion">
        {user.status === 'banned' ? 'Account banned' : 'Account suspended'}
      </p>
      <p className="mt-1.5 text-sm leading-relaxed text-ink-soft">
        Your account is {user.status} {until}. Signing in still works so you can see this message,
        but every other action is refused.
        {user.statusReason ? (
          <>
            {' '}
            <span className="text-ink">Reason given:</span> {user.statusReason}
          </>
        ) : null}
      </p>
    </div>
  )
}
