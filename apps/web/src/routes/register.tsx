import { useEffect, useRef, useState } from 'react'
import type { FormEvent } from 'react'
import { Link, useLocation, useNavigate } from 'react-router-dom'
import { errorMessageFor, fieldErrorsFrom } from '../lib/api'
import { useSession } from '../lib/session'
import { AuthPage } from '../components/AuthPage'
import { AuthField } from '../components/AuthField'
import { safeNext } from '../components/Guards'

const USERNAME_PATTERN = /^[a-zA-Z0-9._-]+$/
const EMAIL_PATTERN = /^[^@\s]+@[^@\s]+\.[^@\s]+$/

export function RegisterRoute() {
  const session = useSession()
  const navigate = useNavigate()
  const location = useLocation()
  const [username, setUsername] = useState('')
  const [email, setEmail] = useState('')
  const [displayName, setDisplayName] = useState('')
  const [password, setPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({})
  const [error, setError] = useState<string | null>(null)
  const [pending, setPending] = useState(false)
  const formRef = useRef<HTMLFormElement>(null)
  const errorRef = useRef<HTMLDivElement>(null)
  useEffect(() => {
    if (!pending && error) {
      const invalid = formRef.current?.querySelector<HTMLInputElement>('[aria-invalid="true"]')
      if (invalid) invalid.focus()
      else errorRef.current?.focus()
    }
  }, [pending, error, fieldErrors])
  const registrationSetting = session.settings?.settings['platform.registration_open']
  const registrationOpen = registrationSetting === true || registrationSetting === 'true'
  const next = safeNext(new URLSearchParams(location.search).get('next'))
  const loginUrl = `/login${next ? `?next=${encodeURIComponent(next)}` : ''}`

  const onSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    if (pending || !registrationOpen) return
    setError(null)
    const found: Record<string, string> = {}
    const trimmedUsername = username.trim()
    if (trimmedUsername.length < 3 || trimmedUsername.length > 32) found.username = 'Use between 3 and 32 characters.'
    else if (!USERNAME_PATTERN.test(trimmedUsername)) found.username = 'Use letters, numbers, dots, underscores, or dashes.'
    if (!EMAIL_PATTERN.test(email.trim())) found.email = 'Enter a valid email address.'
    else if (email.trim().length > 320) found.email = 'Use at most 320 characters.'
    if (displayName.trim().length > 80) found.displayName = 'Use at most 80 characters.'
    if (password.length < 8) found.password = 'Use at least 8 characters.'
    else if (password.length > 200) found.password = 'Use at most 200 characters.'
    if (!confirmPassword) found.confirmPassword = 'Enter your password again.'
    else if (confirmPassword !== password) found.confirmPassword = 'Your passwords must match.'
    setFieldErrors(found)
    if (Object.keys(found).length) {
      event.currentTarget.querySelector<HTMLInputElement>(`[name="${Object.keys(found)[0]}"]`)?.focus()
      return
    }
    setPending(true)
    try {
      await session.register({
        username: trimmedUsername,
        email: email.trim(),
        password,
        ...(displayName.trim() ? { displayName: displayName.trim() } : {}),
      })
      navigate(next ?? '/app', { replace: true })
    } catch (caught) {
      setError(errorMessageFor(caught))
      setFieldErrors(fieldErrorsFrom(caught))
    } finally {
      setPending(false)
    }
  }

  return (
    <AuthPage title="Make a home for your links" description="Start with an account. Make it yours from there.">
      {!registrationOpen ? <div className="auth-closed" role="status">
        <h2>{session.settings ? 'Sign-ups are closed' : 'Sign-up is temporarily unavailable'}</h2>
        <p>{session.settings ? 'New accounts are paused for now. If you already have an account, you can still sign in.' : 'We could not check whether new accounts are available. Please try again.'}</p>
        {session.settings ? <Link to={loginUrl} className="auth-link">Sign in to your account ↗</Link> : <button type="button" className="auth-link" onClick={() => void session.refresh()}>Try again</button>}
      </div> : <form ref={formRef} onSubmit={(event) => void onSubmit(event)} noValidate className="auth-form" aria-busy={pending}>
        {error ? <div ref={errorRef} tabIndex={-1} role="alert" className="auth-notice"><strong>Could not create your account</strong>{error}</div> : null}
        <fieldset disabled={pending} className="auth-form-fields">
          <legend className="sr-only">Create your account</legend>
          <div className="auth-field-row">
            <AuthField label="Username" name="username" autoComplete="username" required placeholder="yourname"
              hint="3–32 letters, numbers, dots, underscores, or dashes." error={fieldErrors.username}
              value={username} onChange={(event) => setUsername(event.target.value)} />
            <AuthField label="Display name" name="displayName" autoComplete="nickname" optional placeholder="Your name"
              error={fieldErrors.displayName} value={displayName} onChange={(event) => setDisplayName(event.target.value)} />
          </div>
          <AuthField label="Email" name="email" type="email" autoComplete="email" required placeholder="you@example.com"
            error={fieldErrors.email} value={email} onChange={(event) => setEmail(event.target.value)} />
          <AuthField label="Password" name="password" type="password" autoComplete="new-password" required placeholder="Create a password"
            hint="At least 8 characters." error={fieldErrors.password} value={password} onChange={(event) => setPassword(event.target.value)} />
          <AuthField label="Confirm password" name="confirmPassword" type="password" autoComplete="new-password" required placeholder="Repeat your password"
            error={fieldErrors.confirmPassword} value={confirmPassword} onChange={(event) => setConfirmPassword(event.target.value)} />
          <button type="submit" className="auth-submit" disabled={pending}>
            {pending ? 'Creating account…' : 'Create account'}{!pending ? <span aria-hidden="true">↗</span> : null}
          </button>
        </fieldset>
      </form>}
      <p className="auth-form-footer">Already have an account?<Link className="auth-link" to={loginUrl}>Sign in</Link></p>
    </AuthPage>
  )
}
