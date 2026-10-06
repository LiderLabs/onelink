import { useState } from 'react'
import type { FormEvent } from 'react'
import { errorMessageFor } from '../../lib/api'
import { useSession } from '../../lib/session'
import { Button } from '../../components/Button'
import { Field } from '../../components/Field'
import { Notice } from '../../components/Notice'

// ============================================================================
// The password form, in the profile's Security section.
//
// Unchanged in behaviour from the account screen it came from, and deliberately
// NOT gated by the profile's read-only states: this is the one write the API
// still admits to a session whose password must be rotated (the interlock's
// whole point is that the user can clear it themselves). A suspended account
// cannot reach it at all — that guard is the API's.
// ============================================================================

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