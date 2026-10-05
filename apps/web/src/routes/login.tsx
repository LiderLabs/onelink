import { useState } from 'react'
import type { FormEvent } from 'react'
import { Link, useLocation, useNavigate } from 'react-router-dom'
import { errorMessageFor } from '../lib/api'
import { useSession } from '../lib/session'
import { AuthFrame } from '../components/AuthFrame'
import { Button } from '../components/Button'
import { Field } from '../components/Field'
import { Notice } from '../components/Notice'
import { safeNext } from '../components/Guards'



export function LoginRoute() {
  const session = useSession()
  const navigate = useNavigate()
  const location = useLocation()

  const [identifier, setIdentifier] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [pending, setPending] = useState(false)

  const next = safeNext(new URLSearchParams(location.search).get('next'))

  const onSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    setError(null)
    setPending(true)
    try {
      await session.login(identifier.trim(), password)
      // Land on whatever guarded route sent us here, else the profile. A forced
      // password change is handled there — it is the only screen the API's
      // interlock admits.
      navigate(next ?? '/profile', { replace: true })
    } catch (caught) {
      setError(errorMessageFor(caught))
      setPassword('')
    } finally {
      setPending(false)
    }
  }

  return (
    <AuthFrame
      eyebrow={session.platformName}
      title={
        <>
          Sign in to your <em className="font-light italic">account</em>
        </>
      }
      lede={
        <>
          One place for every link you publish. Sessions last eight hours, then you sign in
          again — there is no “remember me” to get wrong.
        </>
      }
      folio="01 — Sign in"
      facts={[
        { label: 'Session', value: '8 hours, hard limit' },
        { label: 'Cookie', value: '__Host-, httpOnly' },
      ]}
      footer={
        <div className="flex flex-wrap items-center justify-between gap-3">
          <Link
            to="/forgot-password"
            className="border-b border-transparent font-mono text-[0.6875rem] uppercase tracking-[0.16em] text-ink-soft transition-colors hover:border-ink hover:text-ink"
          >
            Forgot password
          </Link>
          <Link
            to="/register"
            className="border-b border-transparent font-mono text-[0.6875rem] uppercase tracking-[0.16em] text-ink-soft transition-colors hover:border-ink hover:text-ink"
          >
            Create an account
          </Link>
        </div>
      }
    >
      <form onSubmit={(event) => void onSubmit(event)} noValidate className="space-y-7">
        {error ? (
          <Notice tone="error" label="Could not sign in">
            {error}
          </Notice>
        ) : null}

        <Field
          label="Username or email"
          name="identifier"
          autoComplete="username"
          autoFocus
          required
          delay={1}
          value={identifier}
          onChange={(event) => setIdentifier(event.target.value)}
        />

        <Field
          label="Password"
          name="password"
          type="password"
          autoComplete="current-password"
          required
          delay={2}
          value={password}
          onChange={(event) => setPassword(event.target.value)}
        />

        <Button type="submit" pending={pending} pendingLabel="Signing in" className="w-full">
          Sign in
        </Button>
      </form>
    </AuthFrame>
  )
}
