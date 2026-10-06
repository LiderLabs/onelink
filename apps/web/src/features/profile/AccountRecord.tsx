import { formatDateTime, formatRelative } from '../../lib/css'
import type { SessionUser } from '../../lib/types'

export function AccountRecord({ user, capabilities, sessionOnly = false }: { user: SessionUser; capabilities: string[]; sessionOnly?: boolean }) {
  const facts = [
    { label: 'Username', value: `@${user.username}` },
    { label: 'Email', value: user.email },
    { label: 'Role', value: user.role },
    { label: 'Member since', value: new Intl.DateTimeFormat(undefined, { month: 'short', day: 'numeric', year: 'numeric' }).format(user.createdAt) },
  ]
  const sessionFacts = [
    { label: 'Account created', value: formatDateTime(user.createdAt) },
    { label: 'Last sign-in', value: user.lastLoginAt ? `${formatDateTime(user.lastLoginAt)} · ${formatRelative(user.lastLoginAt)}` : 'No sign-ins recorded' },
    { label: 'Sign-ins', value: String(user.loginCount) },
    { label: 'Session ends', value: `${formatDateTime(user.sessionExpiresAt)} · ${formatRelative(user.sessionExpiresAt)}` },
    { label: 'Capabilities', value: `${capabilities.length} granted` },
  ]
  return (
    <section className="profile-account" aria-labelledby="account-record">
      <div className="profile-account-title">
        <h2 id="account-record">{sessionOnly ? 'Session details' : 'Your account'}</h2>
        <span className="profile-account-status"><span aria-hidden="true">●</span> {user.status}</span>
      </div>
      <p className="profile-account-description">{sessionOnly ? 'Your sign-in and current session.' : 'The essentials, all in one place.'}</p>
      <dl className="profile-account-facts">
        {(sessionOnly ? sessionFacts : facts).map(fact => <div key={fact.label}>
          <dt>{fact.label}</dt>
          <dd>{fact.value}</dd>
          {fact.label === 'Email' ? <dd className="profile-email-state">{user.emailVerified ? 'Email verified' : 'Email not verified'}</dd> : null}
        </div>)}
      </dl>
      {!sessionOnly ? <><p className="profile-account-help">Email, role, and account status are managed by the platform team.</p>
      <details className="profile-session-details">
        <summary>Session details</summary>
        <dl>
          {sessionFacts.map(fact => <div key={fact.label}><dt>{fact.label}</dt><dd>{fact.value}</dd></div>)}
        </dl>
      </details></> : null}
    </section>
  )
}
