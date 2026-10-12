import { useEffect, useRef, useState } from 'react'
import type { FormEvent } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { ArrowLeft, CheckCircle, Clock, ShieldCheck } from '@phosphor-icons/react'
import { api, errorMessageFor, fieldErrorsFrom } from '../lib/api'
import { useSession } from '../lib/session'
import type { ResetPasswordResponse } from '../lib/types'
import { AuthPage, AuthIcon } from '../components/AuthPage'
import { AuthField } from '../components/AuthField'

const MIN_PASSWORD_LENGTH = 8
const MAX_PASSWORD_LENGTH = 200

export function ResetPasswordRoute() {
  const session = useSession()
  const [params] = useSearchParams()
  const token = params.get('token') ?? ''
  const validToken = token.length >= 16 && token.length <= 256
  const [password, setPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({})
  const [error, setError] = useState<string | null>(null)
  const [pending, setPending] = useState(false)
  const [done, setDone] = useState<ResetPasswordResponse | null>(null)
  const formRef = useRef<HTMLFormElement>(null)
  const errorRef = useRef<HTMLDivElement>(null)
  const resultRef = useRef<HTMLDivElement>(null)
  const requestPending = useRef(false)
  const activeToken = useRef(token)
  activeToken.current = token

  useEffect(() => {
    setPassword('')
    setConfirmPassword('')
    setFieldErrors({})
    setError(null)
    setDone(null)
    formRef.current?.querySelector<HTMLInputElement>('input[name="password"]')?.focus()
  }, [token])

  useEffect(() => {
    if (done) resultRef.current?.focus()
  }, [done])

  useEffect(() => {
    if (error && !pending) {
      const invalid = formRef.current?.querySelector<HTMLInputElement>('input[aria-invalid="true"]')
      if (invalid) invalid.focus()
      else errorRef.current?.focus()
    }
  }, [error, pending])

  const onSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    if (requestPending.current || !validToken) return
    setError(null)
    const found: Record<string, string> = {}
    if (password.length < MIN_PASSWORD_LENGTH)
      found.password = `Passwords must be at least ${MIN_PASSWORD_LENGTH} characters.`
    else if (password.length > MAX_PASSWORD_LENGTH)
      found.password = `Passwords must be at most ${MAX_PASSWORD_LENGTH} characters.`
    if (!confirmPassword) found.confirmPassword = 'Confirm your new password.'
    else if (confirmPassword !== password) found.confirmPassword = 'Both passwords must match.'
    setFieldErrors(found)
    if (Object.keys(found).length > 0) {
      formRef.current?.querySelector<HTMLInputElement>(`input[name="${found.password ? 'password' : 'confirmPassword'}"]`)?.focus()
      return
    }

    requestPending.current = true
    setPending(true)
    try {
      const response = await api.resetPassword(token, password)
      if (activeToken.current === token) {
        setDone(response)
        setPassword('')
        setConfirmPassword('')
      }
      // Reset invalidates all sessions and clears the current session cookie.
      await session.refresh()
    } catch (caught) {
      if (activeToken.current === token) {
        setError(errorMessageFor(caught))
        const issues = fieldErrorsFrom(caught)
        setFieldErrors({ ...issues, ...(issues.newPassword ? { password: issues.newPassword } : {}) })
      }
    } finally {
      requestPending.current = false
      setPending(false)
    }
  }

  if (!validToken) {
    return (
      <AuthPage variant="recovery" title="Request a new reset link" description="This password reset link is incomplete or invalid.">
        <div className="auth-recovery-result">
          <span className="auth-recovery-status-icon"><ShieldCheck size={28} aria-hidden="true" /></span>
          <p>Request a fresh link using your account email to choose a new password.</p>
          <Link to="/forgot-password" className="auth-submit">Request a new link <AuthIcon name="arrow" /></Link>
        </div>
        <div className="auth-form-footer auth-recovery-footer">
          <Link to="/login" className="auth-link"><ArrowLeft size={16} aria-hidden="true" />Back to sign in</Link>
        </div>
      </AuthPage>
    )
  }

  if (done) {
    return (
      <AuthPage variant="recovery" title="Password updated" description="Your OneLink account is ready for a fresh start.">
        <div className="auth-recovery-result" ref={resultRef} tabIndex={-1} role="status">
          <span className="auth-recovery-status-icon"><CheckCircle size={28} aria-hidden="true" /></span>
          <p>Your password has been changed. All previous sessions have been signed out.</p>
          <p className="auth-recovery-muted">Sign in again with your new password to continue.</p>
          <Link to="/login" className="auth-submit">Sign in with your new password <AuthIcon name="arrow" /></Link>
        </div>
      </AuthPage>
    )
  }

  return (
    <AuthPage variant="recovery" title="Choose a new password" description="Make it unique to keep your OneLink account secure.">
      <form ref={formRef} onSubmit={event => void onSubmit(event)} noValidate className="auth-form" aria-busy={pending}>
        {error ? <div className="auth-notice" role="alert" ref={errorRef} tabIndex={-1}>{error}</div> : null}
        <fieldset className="auth-form-fields" disabled={pending}>
          <AuthField label="New password" name="password" type="password" icon="key" autoComplete="new-password" required
            hint="8–200 characters. Avoid common passwords or your account details." error={fieldErrors.password} value={password}
            onChange={event => { setPassword(event.target.value); setFieldErrors({}) }} />
          <AuthField label="Confirm new password" name="confirmPassword" type="password" icon="shield" autoComplete="new-password" required
            error={fieldErrors.confirmPassword} value={confirmPassword}
            onChange={event => { setConfirmPassword(event.target.value); setFieldErrors(current => ({ ...current, confirmPassword: '' })) }} />
          <button type="submit" className="auth-submit" disabled={pending}>
            {pending ? 'Updating…' : 'Reset password'} <AuthIcon name="arrow" />
          </button>
        </fieldset>
      </form>
      <p className="auth-session-note"><Clock aria-hidden="true" />Reset links expire after one hour and work once.</p>
      <div className="auth-form-footer auth-recovery-footer">
        <Link to="/forgot-password" className="auth-link">Request a new link</Link>
        <Link to="/login" className="auth-link"><ArrowLeft size={16} aria-hidden="true" />Back to sign in</Link>
      </div>
    </AuthPage>
  )
}
