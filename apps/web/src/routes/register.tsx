import { useState } from 'react'
import type { FormEvent } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { errorMessageFor } from '../lib/api'
import { useSession } from '../lib/session'
import { AuthFrame } from '../components/AuthFrame'
import { Button } from '../components/Button'
import { Field } from '../components/Field'
import { Notice } from '../components/Notice'

// ============================================================================
// /register
//
// The checks below mirror the server's rules (`src/validation/common.ts`) so a
// mistyped username is caught before a round trip. They are a convenience, not a
// boundary: the server validates the same way and stays the authority, and the
// form is `noValidate` only so the browser's own bubbles do not pre-empt the
// errors rendered next to each field.
// ============================================================================

const USERNAME_PATTERN = /^[a-zA-Z0-9._-]+$/
const EMAIL_PATTERN = /^[^@\s]+@[^@\s]+\.[^@\s]+$/
const MIN_PASSWORD_LENGTH = 8
const MAX_PASSWORD_LENGTH = 200

interface FieldErrors {
  username?: string
  email?: string
  password?: string
  confirmPassword?: string
}

export function RegisterRoute() {
  const session = useSession()
  const navigate = useNavigate()

  const [username, setUsername] = useState('')
  const [email, setEmail] = useState('')
  const [displayName, setDisplayName] = useState('')
  const [password, setPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')

  const [fieldErrors, setFieldErrors] = useState<FieldErrors>({})
  const [error, setError] = useState<string | null>(null)
  const [pending, setPending] = useState(false)

  const registrationOpen = session.settings?.settings['platform.registration_open'] !== 'false'

  /** Returns the errors it found, so the caller decides whether to submit. */
  const validate = (): FieldErrors => {
    const found: FieldErrors = {}
    const trimmedUsername = username.trim()

    if (trimmedUsername.length < 3) found.username = 'Usernames must be at least 3 characters.'
    else if (trimmedUsername.length > 32)
      found.username = 'Usernames must be at most 32 characters.'
    else if (!USERNAME_PATTERN.test(trimmedUsername))
      found.username = 'Only letters, numbers, dots, underscores and dashes.'

    if (!EMAIL_PATTERN.test(email.trim())) found.email = 'A valid email address is required.'

    if (password.length < MIN_PASSWORD_LENGTH)
      found.password = `Passwords must be at least ${MIN_PASSWORD_LENGTH} characters.`
    else if (password.length > MAX_PASSWORD_LENGTH)
      found.password = `Passwords must be at most ${MAX_PASSWORD_LENGTH} characters.`

    if (confirmPassword !== password) found.confirmPassword = 'Both passwords must match.'

    return found
  }

  const onSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    setError(null)

    const found = validate()
    setFieldErrors(found)
    if (Object.keys(found).length > 0) return

    setPending(true)
    try {
      await session.register({
        username: username.trim(),
        email: email.trim(),
        password,
        ...(displayName.trim().length > 0 ? { displayName: displayName.trim() } : {}),
      })
      navigate('/profile', { replace: true })
    } catch (caught) {
      setError(errorMessageFor(caught))
    } finally {
      setPending(false)
    }
  }

  return (
    <AuthFrame
      eyebrow={session.platformName}
      title={
        <>
          Claim your <em className="font-light italic">address</em>
        </>
      }
      lede={
        <>
          A username is your address on {session.platformName} — it decides the URL your page will
          live at, so pick one you would be happy to say out loud.
        </>
      }
      folio="02 — Create account"
      facts={[
        { label: 'Username', value: '3–32 characters' },
        { label: 'Password', value: `${MIN_PASSWORD_LENGTH}+ characters` },
      ]}
      footer={
        <Link
          to="/login"
          className="border-b border-transparent font-mono text-[0.6875rem] uppercase tracking-[0.16em] text-ink-soft transition-colors hover:border-ink hover:text-ink"
        >
          I already have an account
        </Link>
      }
    >
      {!registrationOpen ? (
        <Notice tone="warning" label="Sign-ups are closed" delay={1} className="mb-7">
          An owner has closed public registration, so this form will be refused. Existing accounts
          can still sign in.
        </Notice>
      ) : null}

      <form onSubmit={(event) => void onSubmit(event)} noValidate className="space-y-6">
        {error ? (
          <Notice tone="error" label="Could not create the account">
            {error}
          </Notice>
        ) : null}

        <Field
          label="Username"
          name="username"
          autoComplete="username"
          autoFocus
          required
          delay={1}
          hint="Letters, numbers, dots, underscores and dashes."
          error={fieldErrors.username ?? null}
          value={username}
          onChange={(event) => setUsername(event.target.value)}
        />

        <Field
          label="Email"
          name="email"
          type="email"
          autoComplete="email"
          required
          delay={2}
          error={fieldErrors.email ?? null}
          value={email}
          onChange={(event) => setEmail(event.target.value)}
        />

        <Field
          label="Display name"
          name="displayName"
          autoComplete="nickname"
          delay={3}
          hint="Optional. Shown on your page instead of the username."
          value={displayName}
          onChange={(event) => setDisplayName(event.target.value)}
        />

        <Field
          label="Password"
          name="password"
          type="password"
          autoComplete="new-password"
          required
          delay={4}
          error={fieldErrors.password ?? null}
          value={password}
          onChange={(event) => setPassword(event.target.value)}
        />

        <Field
          label="Confirm password"
          name="confirmPassword"
          type="password"
          autoComplete="new-password"
          required
          delay={5}
          error={fieldErrors.confirmPassword ?? null}
          value={confirmPassword}
          onChange={(event) => setConfirmPassword(event.target.value)}
        />

        <Button
          type="submit"
          pending={pending}
          pendingLabel="Creating account"
          disabled={!registrationOpen}
          className="w-full"
        >
          Create account
        </Button>
      </form>
    </AuthFrame>
  )
}