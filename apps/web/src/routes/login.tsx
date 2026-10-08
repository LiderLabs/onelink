import { useEffect, useRef, useState } from 'react'
import type { FormEvent } from 'react'
import { Link, useLocation, useNavigate } from 'react-router-dom'
import { errorMessageFor, fieldErrorsFrom } from '../lib/api'
import { useSession } from '../lib/session'
import { AuthIcon, AuthPage } from '../components/AuthPage'
import { AuthField } from '../components/AuthField'
import { safeNext } from '../components/Guards'

export function LoginRoute() {
  const session = useSession()
  const navigate = useNavigate()
  const location = useLocation()
  const [identifier, setIdentifier] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({})
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
  const next = safeNext(new URLSearchParams(location.search).get('next'))
  const registrationSetting = session.settings?.settings['platform.registration_open']
  const registrationOpen = registrationSetting === true || registrationSetting === 'true'

  const onSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    if (pending) return
    setError(null)
    const found: Record<string, string> = {}
    if (identifier.trim().length < 3) found.identifier = 'Enter your username or email address.'
    else if (identifier.trim().length > 320) found.identifier = 'Use at most 320 characters.'
    if (!password) found.password = 'Enter your password.'
    else if (password.length > 200) found.password = 'Use at most 200 characters.'
    setFieldErrors(found)
    if (Object.keys(found).length) {
      event.currentTarget.querySelector<HTMLInputElement>(`[name="${Object.keys(found)[0]}"]`)?.focus()
      return
    }
    setPending(true)
    try {
      await session.login(identifier.trim(), password)
      navigate('/app', { replace: true })
    } catch (caught) {
      setError(errorMessageFor(caught))
      setFieldErrors(fieldErrorsFrom(caught))
      setPassword('')
    } finally {
      setPending(false)
    }
  }

  return (
    <AuthPage title="Welcome back" description="Sign in to manage your links and creator profile.">
      <form ref={formRef} onSubmit={(event) => void onSubmit(event)} noValidate className="auth-form" aria-busy={pending}>
        {error ? <div ref={errorRef} tabIndex={-1} role="alert" className="auth-notice"><strong>Could not sign in</strong>{error}</div> : null}
        <fieldset disabled={pending} className="auth-form-fields">
          <legend className="sr-only">Sign in to your account</legend>
          <AuthField label="Email or username" name="identifier" autoComplete="username" required icon="email" maxLength={320}
            placeholder="alex@onelink.me or alexvance" error={fieldErrors.identifier} value={identifier}
            onChange={(event) => setIdentifier(event.target.value)} />
          <AuthField label="Password" name="password" type="password" autoComplete="current-password" required icon="key" maxLength={200}
            labelAction={<Link to="/forgot-password" className="auth-link">Forgot password?</Link>}
            placeholder="Enter your password" error={fieldErrors.password} value={password}
            onChange={(event) => setPassword(event.target.value)} />
          <p className="auth-session-detail"><AuthIcon name="shield" />Secure sign-in<span>8-hour session</span></p>
          <button type="submit" className="auth-submit" disabled={pending}>
            {pending ? 'Signing in…' : `Sign In to ${session.platformName}`}{!pending ? <AuthIcon name="arrow" /> : null}
          </button>
        </fieldset>
      </form>
      {registrationOpen ? <p className="auth-form-footer">Don't have an account?<Link className="auth-link" to={`/register${next ? `?next=${encodeURIComponent(next)}` : ''}`}>Create account</Link></p> : null}
      <p className="auth-session-note"><AuthIcon name="shield" />Your account uses a secure, private session.</p>
    </AuthPage>
  )
}
