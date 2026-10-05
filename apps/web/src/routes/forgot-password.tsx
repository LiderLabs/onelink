import { useState } from 'react'
import type { FormEvent } from 'react'
import { Link } from 'react-router-dom'
import { api, errorMessageFor } from '../lib/api'
import type { ForgotPasswordResponse } from '../lib/types'
import { useSession } from '../lib/session'
import { AuthFrame } from '../components/AuthFrame'
import { Button } from '../components/Button'
import { Field } from '../components/Field'
import { Notice } from '../components/Notice'



export function ForgotPasswordRoute() {
  const session = useSession()

  const [email, setEmail] = useState('')
  const [pending, setPending] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [result, setResult] = useState<ForgotPasswordResponse | null>(null)

  const onSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    setError(null)
    setPending(true)
    try {
      setResult(await api.forgotPassword(email.trim()))
    } catch (caught) {
      setError(errorMessageFor(caught))
    } finally {
      setPending(false)
    }
  }

  const devLink = result?.devToken
    ? `/reset-password?token=${encodeURIComponent(result.devToken)}`
    : null

  return (
    <AuthFrame
      eyebrow={session.platformName}
      title={
        <>
          Reset your <em className="font-light italic">password</em>
        </>
      }
      lede={
        <>
          Enter the address on the account and a reset link will be issued for it. The link is valid
          for one hour and can only be used once.
        </>
      }
      folio="03 — Password reset"
      footer={
        <Link
          to="/login"
          className="border-b border-transparent font-mono text-[0.6875rem] uppercase tracking-[0.16em] text-ink-soft transition-colors hover:border-ink hover:text-ink"
        >
          Back to sign in
        </Link>
      }
    >
      {result ? (
        <div className="space-y-6">
          <Notice tone="success" label="Request accepted" delay={1}>
            If an account exists for <span className="font-medium text-ink">{email.trim()}</span>, a
            reset link has been issued. Nothing is disclosed about whether the address is
            registered.
          </Notice>

          {devLink ? (
            <Notice tone="info" label="Development stand-in" delay={2}>
              <p>
                No mail provider is configured on this deployment, so the message that would have
                carried the link was only queued. Follow the link directly:
              </p>
              <p className="mt-3">
                <Link
                  to={devLink}
                  className="break-all font-mono text-xs text-ink underline decoration-dotted underline-offset-4"
                >
                  {devLink}
                </Link>
              </p>
            </Notice>
          ) : null}

          <Button variant="outline" onClick={() => setResult(null)} className="w-full">
            Use a different address
          </Button>
        </div>
      ) : (
        <form onSubmit={(event) => void onSubmit(event)} noValidate className="space-y-7">
          {error ? (
            <Notice tone="error" label="Could not request a reset">
              {error}
            </Notice>
          ) : null}

          <Field
            label="Email address"
            name="email"
            type="email"
            autoComplete="email"
            autoFocus
            required
            delay={1}
            value={email}
            onChange={(event) => setEmail(event.target.value)}
          />

          <Button type="submit" pending={pending} pendingLabel="Requesting" className="w-full">
            Request reset link
          </Button>
        </form>
      )}
    </AuthFrame>
  )
}
