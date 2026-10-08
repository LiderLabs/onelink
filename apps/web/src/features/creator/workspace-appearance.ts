import { useCallback, useMemo, useSyncExternalStore } from 'react'

export interface WorkspaceAppearance {
  tone: 'charcoal' | 'midnight'
  density: 'comfortable' | 'compact'
  motion: 'system' | 'reduced'
}
export const DEFAULT_APPEARANCE: WorkspaceAppearance = { tone: 'charcoal', density: 'comfortable', motion: 'system' }
const changedEvent = 'onelink:workspace-appearance'
function subscribe(notify: () => void) {
  window.addEventListener('storage', notify)
  window.addEventListener(changedEvent, notify)
  return () => {
    window.removeEventListener('storage', notify)
    window.removeEventListener(changedEvent, notify)
  }
}

// Browser preferences are scoped to an account and never alter public pages.
export function useWorkspaceAppearance(userId: string | undefined) {
  const key = `onelink:workspace-appearance:${userId ?? 'anonymous'}`
  const snapshot = useCallback(() => {
    try { return localStorage.getItem(key) } catch { return null }
  }, [key])
  const raw = useSyncExternalStore(subscribe, snapshot, () => null)
  const appearance = useMemo<WorkspaceAppearance>(() => {
    try {
      const stored: unknown = JSON.parse(raw ?? 'null')
      if (!stored || typeof stored !== 'object') return DEFAULT_APPEARANCE
      const value = stored as Partial<WorkspaceAppearance>
      return {
        tone: value.tone === 'midnight' ? 'midnight' : 'charcoal',
        density: value.density === 'compact' ? 'compact' : 'comfortable',
        motion: value.motion === 'reduced' ? 'reduced' : 'system',
      }
    } catch { return DEFAULT_APPEARANCE }
  }, [raw])
  const save = useCallback((next: WorkspaceAppearance): boolean => {
    try {
      localStorage.setItem(key, JSON.stringify(next))
      window.dispatchEvent(new Event(changedEvent))
      return true
    } catch { return false }
  }, [key])
  return { appearance, save }
}
