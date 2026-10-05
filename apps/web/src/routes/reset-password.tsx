import { useState } from 'react'
import type { FormEvent } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { api, errorMessageFor } from '../lib/api'
import { useSession } from '../lib/session'
import type { ResetPasswordResponse } from '../lib/types'
import { AuthFrame } from '../components/AuthFrame'
import { Button } from '../components/Button'
import { Field } from '../components/Field'
import { Notice } from '../components/Notice'

// ============================================================================
// /reset-password?token=…
//
// The token arrives in the query string — that is the shape the API's reset
// links use (`buildPasswordResetUrl` hard-codes this path). It is read once and
// posted as a body field; nothing else in the app reads `location.search` for a
// secret.
//
// A successful reset revokes every session, so the caller is signed out; this
// screen re-reads the session afterwards so the shell stops showing an identity
// that no longer has a cookie behind it.
// ============================================================================

const MIN_PASSWORD_LENGTH = 8
const MAX_PASSWORD_LENGTH = 200

export function ResetPasswordRoute() {
  const session = useSession()
  const [params] = useSearchParams()
  const token = params.get('token') ?? ''

  const [password, setPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [fieldErrors, setFieldErrors] = useState<{ password?: string; confirmPassword?: string }>(
    {},
  )
  const [error, setError] = useState<string | null>(null)
  const [pending, setPending] = useState(false)
  const [done, setDone] = useState<ResetPasswordResponse | null>(null)

  const onSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    setError(null)

    const found: { password?: string; confirmPassword?: string } = {}
    if (password.length < MIN_PASSWORD_LENGTH)
      found.password = `Passwords must be at least ${MIN_PASSWORD_LENGTH} characters.`
    else if (password.length > MAX_PASSWORD_LENGTH)
      found.password = `Passwords must be at most ${MAX_PASSWORD_LENGTH} characters.`
    if (confirmPassword !== password) found.confirmPassword = 'Both passwords must match.'

    setFieldErrors(found)
    if (Object.keys(found).length > 0) return

    setPending(true)
    try {
      const result = await api.resetPassword(token, password)
      setDone(result)
      // The API cleared the session cookie as part of the reset.
      await session.refresh()
    } catch (caught) {
      setError(errorMessageFor(caught))
    } finally {
      setPending(false)
    }
  }

  if (!token) {
    return (
      <AuthFrame
        eyebrow={session.platformName}
        title={
          <>
            This link is <em className="font-light italic">incomplete</em>
          </>
        }
        lede={<>A reset link has to carry its token. This one arrived without it.</>}
        folio="04 — Password reset"
        footer={
          <Link
            to="/forgot-password"
            className="border-b border-transparent font-mono text-[0.6875rem] uppercase tracking-[0.16em] text-ink-soft transition-colors hover:border-ink hover:text-ink"
          >
            Request a new link
          </Link>
        }
      >
        <Notice tone="error" label="Missing token" delay={1}>
          The address you followed did not include a reset token. Request a fresh link and use it
          from the start — links expire after one hour and work only once.
        </Notice>
      </AuthFrame>
    )
  }

  if (done) {
    return (
      <AuthFrame
        eyebrow={session.platformName}
        title={
          <>
            Password <em className="font-light italic">replaced</em>
          </>
        }
        lede={<>The account is secured with the new password, and every session was ended.</>}
        folio="04 — Password reset"
        facts={[
          { label: 'Account', value: done.username },
          { label: 'Sessions ended', value: String(done.revokedSessions) },
        ]}
        footer={
          <Link
            to="/login"
            className="border-b border-transparent font-mono text-[0.6875rem] uppercase tracking-[0.16em] text-ink-soft transition-colors hover:border-ink hover:text-ink"
          >
            Sign in with the new password
          </Link>
        }
      >
        <Notice tone="success" label="Done" delay={1}>
          That session-revoking step is deliberate: a reset is the moment a stolen session is most
          likely to exist, so none survive it. Sign in again with the new password.
        </Notice>
      </AuthFrame>
    )
  }

  return (
    <AuthFrame
      eyebrow={session.platformName}
      title={
        <>
          Choose a new <em className="font-light italic">password</em>
        </>
      }
      lede={<>This link is single-use. Once the password is replaced it cannot be replayed.</>}
      folio="04 — Password reset"
      footer={
        <Link
          to="/forgot-password"
          className="border-b border-transparent font-mono text-[0.6875rem] uppercase tracking-[0.16em] text-ink-soft transition-colors hover:border-ink hover:text-ink"
        >
          The link has expired
        </Link>
      }
    >
      <form onSubmit={(event) => void onSubmit(event)} noValidate className="space-y-7">
        {error ? (
          <Notice tone="error" label="Could not reset the password">
            {error}
          </Notice>
        ) : null}

        <Field
          label="New password"
          name="password"
          type="password"
          autoComplete="new-password"
          autoFocus
          required
          delay={1}
          hint={`At least ${MIN_PASSWORD_LENGTH} characters.`}
          error={fieldErrors.password ?? null}
          value={password}
          onChange={(event) => setPassword(event.target.value)}
        />

        <Field
          label="Confirm new password"
          name="confirmPassword"
          type="password"
          autoComplete="new-password"
          required
          delay={2}
          error={fieldErrors.confirmPassword ?? null}
          value={confirmPassword}
          onChange={(event) => setConfirmPassword(event.target.value)}
        />

        <Button type="submit" pending={pending} pendingLabel="Replacing" className="w-full">
          Replace password
        </Button>
      </form>
    </AuthFrame>
  )
}