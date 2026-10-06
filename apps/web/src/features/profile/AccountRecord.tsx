import { formatDateTime, formatRelative } from '../../lib/css'
import type { SessionUser } from '../../lib/types'

// ============================================================================
// The account record: what the platform holds, in one ruled list.
//
// Read-only on purpose. Everything here is either a staff action (role, status,
// verified email) or already editable above (identity), and a "record" that
// invites edits duplicates the forms it sits beside.
//
// It is also the one place that shows the SESSION rather than the account — when
// this session ends, and how many capabilities it carries — because those are
// facts about the browser you are sitting in, not about the person.
// ============================================================================

export function AccountRecord({
  user,
  capabilities,
}: {
  user: SessionUser
  capabilities: string[]
}) {
  const facts: Array<{ label: string; value: string }> = [
    { label: 'Username', value: user.username },
    { label: 'Email', value: user.emailVerified ? user.email : `${user.email} (unverified)` },
    { label: 'Role', value: user.role },
    { label: 'Status', value: user.status },
    { label: 'Member since', value: formatDateTime(user.createdAt) },
    {
      label: 'Last sign-in',
      value: user.lastLoginAt
        ? `${formatDateTime(user.lastLoginAt)} · ${formatRelative(user.lastLoginAt)}`
        : '—',
    },
    { label: 'Sign-ins', value: String(user.loginCount) },
    {
      label: 'Session ends',
      value: `${formatDateTime(user.sessionExpiresAt)} · ${formatRelative(user.sessionExpiresAt)}`,
    },
    { label: 'Capabilities', value: `${capabilities.length} granted` },
  ]

  return (
    <section aria-labelledby="account-record">
      <h2 id="account-record" className="eyebrow">
        Account record
      </h2>
      <p className="mt-3 max-w-prose text-sm leading-relaxed text-ink-soft">
        Read-only. Changing a role, a status or a verified address is a staff action, not a
        self-service edit.
      </p>

      <dl className="mt-5 border-t border-rule">
        {facts.map((fact) => (
          <div
            key={fact.label}
            className="flex items-baseline justify-between gap-6 border-b border-rule py-3"
          >
            <dt className="eyebrow">{fact.label}</dt>
            <dd className="break-all text-right font-mono text-sm text-ink">{fact.value}</dd>
          </div>
        ))}
      </dl>
    </section>
  )
}