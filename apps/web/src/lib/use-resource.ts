import { useCallback, useEffect, useRef, useState } from 'react'
import { ApiError } from './api'

// ============================================================================
// Reading one resource on a screen.
//
// Small on purpose. What it buys every caller is the two rules a hand-rolled
// `useEffect` keeps getting wrong:
//
//   * a response that arrives after the screen moved on (a filter changed, the
//     route changed) is DISCARDED rather than painted over newer state, and
//   * nothing is set after unmount, so a slow request cannot warn in the console
//     or resurrect a dead screen.
//
// There is no cache, no dedupe and no automatic retry: a mutation refetches what
// it touched, explicitly, and a failure is a value the screen renders.
// ============================================================================

export interface Resource<T> {
  data: T | null
  /** `null` while there is nothing to report — including between attempts. */
  error: ApiError | null
  loading: boolean
  /** Re-runs the load. Safe to call from a button or after a write. */
  reload: () => void
}

export interface UseResourceOptions {
  /**
   * `false` skips the request entirely.
   *
   * This exists for resources an account is not allowed to ask for at all — the
   * API would answer `403`, so requesting it would only produce an error state
   * that has to be un-explained. A screen that passes `false` owes the reader a
   * sentence about why the section is missing.
   */
  enabled?: boolean
}

/**
 * @param load Reads the resource. Need not be memoized: the hook keeps the
 *   latest one in a ref, so a new inline function per render does not refetch.
 */
export function useResource<T>(load: () => Promise<T>, options: UseResourceOptions = {}): Resource<T> {
  const enabled = options.enabled ?? true
  const [state, setState] = useState<Omit<Resource<T>, 'reload'>>({
    data: null,
    error: null,
    loading: enabled,
  })
  const [attempt, setAttempt] = useState(0)

  const loadRef = useRef(load)
  useEffect(() => {
    loadRef.current = load
  })

  useEffect(() => {
    if (!enabled) {
      setState({ data: null, error: null, loading: false })
      return
    }

    let current = true
    setState((previous) => ({ ...previous, loading: true, error: null }))

    loadRef.current().then(
      (data) => {
        if (current) setState({ data, error: null, loading: false })
      },
      (error: unknown) => {
        if (!current) return
        setState({
          data: null,
          error: error instanceof ApiError ? error : null,
          loading: false,
        })
      },
    )

    // Runs on unmount and before the next attempt: the in-flight promise loses
    // the right to write state the moment either happens.
    return () => {
      current = false
    }
  }, [enabled, attempt])

  const reload = useCallback(() => setAttempt((previous) => previous + 1), [])

  return { ...state, reload }
}