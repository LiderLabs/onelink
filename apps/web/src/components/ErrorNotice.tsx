import { useState } from 'react'
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
  const [retrying, setRetrying] = useState(false)

  const retry = () => {
    setRetrying(true)
    // `onRetry` bumps a counter rather than returning a promise, so the pending
    // state clears on a timer instead of on a resolution that may never come.
    onRetry()
    window.setTimeout(() => setRetrying(false), 500)
  }

  return (
    <Notice
      tone="error"
      label={error instanceof ApiError ? error.code : 'Request failed'}
      delay={delay}
      className="mt-5"
    >
      <p>{errorMessageFor(error)}</p>
      <div className="mt-3">
        <Button variant="outline" onClick={retry} pending={retrying} pendingLabel="Retrying">
          {action}
        </Button>
      </div>
    </Notice>
  )
}