import { useCallback, useEffect, useState } from 'react'
import { useBlocker } from 'react-router-dom'

// ============================================================================
// Unsaved input.
//
// Two rules, and the spec is explicit about both (§10):
//
//   1. Dirty input is never lost. Leaving the screen — in-app or by closing the
//      tab — is confirmed first, and a background refresh never overwrites what
//      was typed.
//   2. A successful save resets the baseline to the SERVER's values, not to what
//      was typed, because normalization (trimming, control characters, unset
//      becoming null) happens on the way in.
//
// `useDirtyForm` owns (1) and (2)'s baseline; `useUnsavedChanges` owns the
// navigation half. They are separate because a screen can have a dirty form
// without wanting a route blocker, and vice versa.
// ============================================================================

export interface Draft<T> {
  /** What the server last confirmed. */
  original: T
  /** What is on screen now. */
  values: T
}

export interface DirtyForm<T extends Record<string, string>> {
  /** `null` until a baseline exists (the resource is still loading). */
  draft: Draft<T> | null
  dirty: boolean
  /** The keys that differ from the baseline, for a "changed fields only" body. */
  changedKeys: Array<keyof T & string>
  setValue: (key: keyof T & string, value: string) => void
  /** Adopt the server's normalized values as the new baseline. */
  reset: (next: T) => void
}

function isPristine<T extends Record<string, string>>(draft: Draft<T>): boolean {
  return Object.keys(draft.values).every((key) => draft.values[key] === draft.original[key])
}

/**
 * @param baseline The server's current values, or `null` while they load.
 *
 * A new `baseline` is adopted only while the draft is still pristine. Once
 * anything has been typed the draft is left completely alone — values AND
 * baseline — so a background refresh cannot move the ground under a half-finished
 * edit, and cannot turn "I changed one field" into "I changed three".
 */
export function useDirtyForm<T extends Record<string, string>>(baseline: T | null): DirtyForm<T> {
  // Seeded from the baseline on the first render rather than by an effect, so a
  // screen whose baseline is already in hand never paints an empty form for a
  // frame and then fills it in.
  const [draft, setDraft] = useState<Draft<T> | null>(() =>
    baseline === null ? null : { original: baseline, values: baseline },
  )

  useEffect(() => {
    if (baseline === null) return
    setDraft((current) =>
      current === null || isPristine(current) ? { original: baseline, values: baseline } : current,
    )
  }, [baseline])

  const setValue = useCallback((key: keyof T & string, value: string) => {
    setDraft((current) => {
      if (current === null) return current
      return { ...current, values: { ...current.values, [key]: value } as T }
    })
  }, [])

  const reset = useCallback((next: T) => {
    setDraft({ original: next, values: next })
  }, [])

  const changedKeys =
    draft === null
      ? []
      : (Object.keys(draft.values) as Array<keyof T & string>).filter(
          (key) => draft.values[key] !== draft.original[key],
        )

  return { draft, dirty: changedKeys.length > 0, changedKeys, setValue, reset }
}

export interface UnsavedChangesGuard {
  /** True while a navigation is being held back. Render the confirm dialog on it. */
  blocked: boolean
  /** Leave anyway. */
  proceed: () => void
  /** Stay on the screen. */
  stay: () => void
}

/**
 * Holds back in-app navigation while there is dirty input, and warns on tab
 * close.
 *
 * `useBlocker` needs React Router's data router; with `<BrowserRouter>` +
 * `<Routes>` there is no blocker API at all, which is why the router moved to
 * `createBrowserRouter` in the same change (UI-ROADMAP U0/UD2).
 *
 * The before-unload handler is the coarse part — the browser shows its own
 * wording and offers only "leave" or "stay". It is registered while dirty and
 * removed the moment the form is clean, because a page with nothing to lose
 * should close without a prompt.
 */
export function useUnsavedChanges(dirty: boolean): UnsavedChangesGuard {
  const blocker = useBlocker(dirty)

  useEffect(() => {
    if (!dirty) return
    const warn = (event: BeforeUnloadEvent) => {
      event.preventDefault()
      // Older browsers ignore `preventDefault` and need a truthy `returnValue`.
      event.returnValue = ''
    }
    window.addEventListener('beforeunload', warn)
    return () => window.removeEventListener('beforeunload', warn)
  }, [dirty])

  return {
    blocked: blocker.state === 'blocked',
    proceed: () => {
      if (blocker.state === 'blocked') blocker.proceed()
    },
    stay: () => {
      if (blocker.state === 'blocked') blocker.reset()
    },
  }
}