import { useEffect, useRef, useState } from 'react'
import type { FormEvent } from 'react'
import { Link } from 'react-router-dom'
import { ArrowLeft, CheckCircle, Clock, EnvelopeSimple } from '@phosphor-icons/react'
import { api, errorMessageFor, fieldErrorsFrom } from '../lib/api'
import type { ForgotPasswordResponse } from '../lib/types'
import { AuthPage, AuthIcon } from '../components/AuthPage'
import { AuthField } from '../components/AuthField'

export function ForgotPasswordRoute() {
  const [email, setEmail] = useState('')
  const [submittedEmail, setSubmittedEmail] = useState('')
  const [pending, setPending] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({})
  const [result, setResult] = useState<ForgotPasswordResponse | null>(null)
  const formRef = useRef<HTMLFormElement>(null)
  const errorRef = useRef<HTMLDivElement>(null)
  const resultRef = useRef<HTMLDivElement>(null)
  const requestPending = useRef(false)

  useEffect(() => {
    if (result) resultRef.current?.focus()
    else formRef.current?.querySelector<HTMLInputElement>('input[name="email"]')?.focus()
  }, [result])

  useEffect(() => {
    if (error && !pending) {
      const invalid = formRef.current?.querySelector<HTMLInputElement>('input[aria-invalid="true"]')
      if (invalid) invalid.focus()
      else errorRef.current?.focus()
    }
  }, [error, pending])

  const onSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    if (requestPending.current) return
    setError(null)
    const address = email.trim()
    const found: Record<string, string> = {}
    if (!address) found.email = 'Enter your email address.'
    else if (address.length > 320 || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(address))
      found.email = 'Enter a valid email address.'
    setFieldErrors(found)
    if (found.email) {
      formRef.current?.querySelector<HTMLInputElement>('input[name="email"]')?.focus()
      return
    }

    requestPending.current = true
    setPending(true)
    try {
      const response = await api.forgotPassword(address)
      setSubmittedEmail(address)
      setResult(response)
    } catch (caught) {
      setError(errorMessageFor(caught))
      setFieldErrors(fieldErrorsFrom(caught))
    } finally {
      requestPending.current = false
      setPending(false)
    }
  }

  const devLink = result?.devToken
    ? `/reset-password?token=${encodeURIComponent(result.devToken)}`
    : null

  return (
    <AuthPage variant="recovery" title={result ? 'Reset link requested' : 'Forgot your password?'}
      description={result ? 'A fresh start for your OneLink account.' : 'Enter your account email to request a password reset link.'}>
      {result ? (
        <div className="auth-recovery-result" ref={resultRef} tabIndex={-1} role="status">
          <span className="auth-recovery-status-icon"><EnvelopeSimple size={28} aria-hidden="true" /></span>
          <p>If an account uses <strong>{submittedEmail}</strong>, your reset request has been accepted.</p>
          <p className="auth-recovery-muted">Use the latest reset link. It expires after one hour and can only be used once.</p>
          {devLink ? (
            <div className="auth-recovery-dev">
              <span className="auth-recovery-badge">Local development</span>
              <p>Email delivery is not connected yet. Use this development link to test your password reset.</p>
              <Link to={devLink} className="auth-submit">Open development reset link <AuthIcon name="arrow" /></Link>
            </div>
          ) : null}
          <button type="button" className="auth-recovery-secondary" onClick={() => {
            setResult(null)
            setEmail('')
            setError(null)
            setFieldErrors({})
          }}>Use a different email</button>
        </div>
      ) : (
        <>
          <form ref={formRef} onSubmit={event => void onSubmit(event)} noValidate className="auth-form" aria-busy={pending}>
            {error ? <div className="auth-notice" role="alert" ref={errorRef} tabIndex={-1}>{error}</div> : null}
            <fieldset className="auth-form-fields" disabled={pending}>
              <AuthField label="Email address" name="email" type="email" icon="email" inputMode="email" autoComplete="email"
                required maxLength={320} placeholder="you@example.com" error={fieldErrors.email} value={email}
                onChange={event => { setEmail(event.target.value); setFieldErrors({}) }} />
              <button type="submit" className="auth-submit" disabled={pending}>
                {pending ? 'Requesting…' : 'Send reset link'} <AuthIcon name="arrow" />
              </button>
            </fieldset>
          </form>
          <p className="auth-session-note"><Clock aria-hidden="true" />Reset links are valid for one hour.</p>
        </>
      )}
      <div className="auth-form-footer auth-recovery-footer">
        <Link to="/login" className="auth-link"><ArrowLeft size={16} aria-hidden="true" />Back to sign in</Link>
      </div>
      <p className="auth-session-note"><CheckCircle aria-hidden="true" />Your account details stay private.</p>
    </AuthPage>
  )
}
