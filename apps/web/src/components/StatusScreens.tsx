import { useState } from 'react'
import { errorMessageFor } from '../lib/api'
import { useSession } from '../lib/session'
import { Button } from './Button'
import { Notice } from './Notice'

// ============================================================================
// Screens for the two states that are not screens: "still asking" and "could not
// ask". Both are full-width because they replace the route content entirely.
// ============================================================================

/** The pre-auth bootstrap is in flight. */
export function Splash({ label = 'Checking your session' }: { label?: string }) {
  return (
    <div className="flex flex-col items-center gap-5 py-24 text-center">
      <span className="sweep h-[3px] w-24 bg-ink" aria-hidden="true" />
      <p className="eyebrow" role="status">
        {label}
      </p>
    </div>
  )
}

/**
 * The API could not be reached, so the app genuinely does not know whether there
 * is a session. This must not look like a failure of the user's credentials, and
 * it must not silently become a login form.
 */
export function UnavailableScreen() {
  const { bootstrapError, refresh, platformName } = useSession()
  const [retrying, setRetrying] = useState(false)

  const retry = async () => {
    setRetrying(true)
    try {
      await refresh()
    } finally {
      setRetrying(false)
    }
  }

  return (
    <div className="mx-auto max-w-xl">
      <p className="eyebrow text-danger">Connection problem</p>
      <h1 className="mt-3 font-display text-4xl font-medium leading-tight">
        {platformName} did not answer
      </h1>
      <p className="mt-5 leading-relaxed text-ink-soft">
        The session could not be checked, so this is not a signed-out state and not a wrong
        password — the API is simply unreachable right now.
      </p>

      {bootstrapError ? (
        <Notice tone="error" label={bootstrapError.code} delay={2} className="mt-6">
          {errorMessageFor(bootstrapError)}
        </Notice>
      ) : null}

      <div className="mt-7 flex items-center gap-4">
        <Button onClick={() => void retry()} pending={retrying} pendingLabel="Retrying">
          Try again
        </Button>
        <a
          href="/"
          className="border-b border-transparent font-mono text-[0.6875rem] uppercase tracking-[0.16em] text-ink-soft transition-colors hover:border-ink hover:text-ink"
        >
          Reload the page
        </a>
      </div>
    </div>
  )
}
