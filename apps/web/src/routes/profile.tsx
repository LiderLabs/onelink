import { useState } from 'react'
import type { FormEvent } from 'react'
import { errorMessageFor } from '../lib/api'
import { formatDateTime, formatRelative, stagger } from '../lib/css'
import { useSession } from '../lib/session'
import { Button } from '../components/Button'
import { Field } from '../components/Field'
import { Notice } from '../components/Notice'
import { Splash } from '../components/StatusScreens'



const MIN_PASSWORD_LENGTH = 8
const MAX_PASSWORD_LENGTH = 200

interface FormErrors {
  current?: string
  next?: string
  confirm?: string
}

export function ChangePasswordForm({ forced }: { forced: boolean }) {
  const session = useSession()

  const [currentPassword, setCurrentPassword] = useState('')
  const [newPassword, setNewPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [fieldErrors, setFieldErrors] = useState<FormErrors>({})
  const [error, setError] = useState<string | null>(null)
  const [revokedSessions, setRevokedSessions] = useState<number | null>(null)
  const [pending, setPending] = useState(false)

  const onSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    setError(null)
    setRevokedSessions(null)

    const found: FormErrors = {}
    if (currentPassword.length === 0) found.current = 'Your current password is required.'
    if (newPassword.length < MIN_PASSWORD_LENGTH)
      found.next = `Passwords must be at least ${MIN_PASSWORD_LENGTH} characters.`
    else if (newPassword.length > MAX_PASSWORD_LENGTH)
      found.next = `Passwords must be at most ${MAX_PASSWORD_LENGTH} characters.`
    else if (newPassword === currentPassword)
      found.next = 'The new password must differ from the current one.'
    if (confirmPassword !== newPassword) found.confirm = 'Both passwords must match.'

    setFieldErrors(found)
    if (Object.keys(found).length > 0) return

    setPending(true)
    try {
      const revoked = await session.changePassword(currentPassword, newPassword)
      setRevokedSessions(revoked)
      setCurrentPassword('')
      setNewPassword('')
      setConfirmPassword('')
    } catch (caught) {
      setError(errorMessageFor(caught))
    } finally {
      setPending(false)
    }
  }

  return (
    <form onSubmit={(event) => void onSubmit(event)} noValidate className="space-y-6">
      {error ? (
        <Notice tone="error" label="Could not change the password">
          {error}
        </Notice>
      ) : null}

      {revokedSessions !== null ? (
        <Notice tone="success" label="Password changed" delay={1}>
          Your other sessions were signed out
          {revokedSessions > 0 ? ` (${revokedSessions})` : ''}. This browser stays signed in.
        </Notice>
      ) : null}

      <Field
        label="Current password"
        name="currentPassword"
        type="password"
        autoComplete="current-password"
        required
        delay={1}
        error={fieldErrors.current ?? null}
        value={currentPassword}
        onChange={(event) => setCurrentPassword(event.target.value)}
      />

      <Field
        label="New password"
        name="newPassword"
        type="password"
        autoComplete="new-password"
        required
        delay={2}
        hint={`At least ${MIN_PASSWORD_LENGTH} characters, and different from the old one.`}
        error={fieldErrors.next ?? null}
        value={newPassword}
        onChange={(event) => setNewPassword(event.target.value)}
      />

      <Field
        label="Confirm new password"
        name="confirmPassword"
        type="password"
        autoComplete="new-password"
        required
        delay={3}
        error={fieldErrors.confirm ?? null}
        value={confirmPassword}
        onChange={(event) => setConfirmPassword(event.target.value)}
      />

      <Button type="submit" pending={pending} pendingLabel="Changing" className="w-full">
        {forced ? 'Set new password' : 'Change password'}
      </Button>
    </form>
  )
}

// ============================================================================
// /profile — the account record, and the one place the forced-password-change
// interlock can be cleared.
//
// `RequireAuth` has already established that there is a user, so the null check
// below is only for the single render between a session ending and the redirect
// taking over.
// ============================================================================

export function ProfileRoute() {
  const session = useSession()
  const user = session.user

  if (!user) return <Splash label="Loading your account" />

  const forced = session.mustChangePassword

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
    { label: 'Capabilities', value: `${session.capabilities.length} granted` },
  ]

  return (
    <div className="space-y-10">
      <header>
        <p className="eyebrow reveal" style={stagger(0)}>
          Account
        </p>
        <h1
          className="reveal mt-3 font-display text-4xl font-medium leading-tight tracking-[-0.02em] sm:text-5xl"
          style={stagger(1)}
        >
          {user.displayName ?? user.username}
        </h1>
        <p className="reveal mt-4 max-w-xl leading-relaxed text-ink-soft" style={stagger(2)}>
          {forced
            ? 'This account is flagged for a password change, so the rest of the console stays closed until one is set.'
            : `Everything ${session.platformName} holds about this account, and the one credential you can change from here.`}
        </p>
      </header>

      {forced ? (
        <Notice tone="warning" label="Password change required" delay={2}>
          An owner (or a reset) marked this password as temporary. Every other page answers{' '}
          <span className="font-mono text-xs">403 MUST_CHANGE_PASSWORD</span> until it is replaced —
          including the admin screens you may be able to reach otherwise.
        </Notice>
      ) : null}

      <div className="grid gap-10 lg:grid-cols-[minmax(0,1fr)_minmax(0,24rem)] lg:gap-14">
        <section aria-labelledby="account-record">
          <h2 id="account-record" className="eyebrow">
            Account record
          </h2>
          <dl className="mt-4 border-t border-rule">
            {facts.map((fact) => (
              <div
                key={fact.label}
                className="flex items-baseline justify-between gap-6 border-b border-rule py-3"
              >
                <dt className="eyebrow">{fact.label}</dt>
                <dd className="text-right font-mono text-sm text-ink">{fact.value}</dd>
              </div>
            ))}
          </dl>

          {user.impersonatedBy ? (
            <Notice tone="warning" label="Impersonated session" className="mt-6">
              An administrator is acting as this account. Anything you do here is recorded against
              them as well.
            </Notice>
          ) : null}
        </section>

        <section className="plate p-6" aria-labelledby="change-password">
          <h2 id="change-password" className="eyebrow">
            Change password
          </h2>
          <p className="mb-6 mt-3 text-sm leading-relaxed text-ink-soft">
            Your other sessions are signed out; this browser stays signed in so you are not thrown
            out mid-flow.
          </p>
          <ChangePasswordForm forced={forced} />
        </section>
      </div>

      <footer className="flex flex-wrap items-center justify-between gap-4 border-t border-rule pt-6">
        <p className="eyebrow">Signed in as {user.username}</p>
        <button
          type="button"
          onClick={() => void session.logout()}
          className="border-b border-transparent font-mono text-[0.6875rem] uppercase tracking-[0.16em] text-ink-soft transition-colors hover:border-ink hover:text-ink"
        >
          Sign out
        </button>
      </footer>
    </div>
  )
}
