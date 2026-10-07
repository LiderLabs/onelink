import { useEffect, useState } from 'react'
import { ApiError, errorMessageFor } from '../lib/api'
import { Button } from './Button'
import { Notice } from './Notice'

// ============================================================================
// A failed resource read, with the one action that can fix it.
//
// Distinguishable from an empty state on purpose: "nothing here" and "we could
// not find out" look identical if both are drawn as a blank panel, and the reader
// is then told to create something that already exists.
//
// The retry is manual and never automatic. Nothing here retries on a timer — a
// failing endpoint under a three-second loop is a self-inflicted outage — and no
// mutation is ever retried at all (spec §10).
// ============================================================================

export interface ErrorNoticeProps {
  error: unknown
  /** The retry button's label, e.g. "Load the links again". */
  action: string
  onRetry: () => void
  delay?: number
}

export function ErrorNotice({ error, action, onRetry, delay = 0 }: ErrorNoticeProps) {
  const retryAfter = error instanceof ApiError ? error.retryAfterSeconds : null
  const [secondsRemaining, setSecondsRemaining] = useState(retryAfter ?? 0)

  useEffect(() => {
    if (retryAfter === null || retryAfter <= 0) {
      setSecondsRemaining(0)
      return
    }
    const deadline = Date.now() + retryAfter * 1000
    const update = () => setSecondsRemaining(Math.max(0, Math.ceil((deadline - Date.now()) / 1000)))
    update()
    const timer = window.setInterval(update, 1000)
    return () => window.clearInterval(timer)
  }, [error, retryAfter])

  const retryable = !(error instanceof ApiError) ||
    error.status === 0 || error.status === 408 || error.status === 429 || error.status >= 500

  return (
    <Notice
      tone="error"
      label={error instanceof ApiError ? error.code : 'Request failed'}
      delay={delay}
      className="mt-5"
    >
      <p>{errorMessageFor(error)}</p>
      {retryable ? (
        <div className="mt-3">
          <Button
            variant="outline"
            disabled={secondsRemaining > 0}
            onClick={onRetry}
          >
            {secondsRemaining > 0 ? `${action} in ${secondsRemaining}s` : action}
          </Button>
        </div>
      ) : null}
    </Notice>
  )
}