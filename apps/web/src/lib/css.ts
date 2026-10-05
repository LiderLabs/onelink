import type { CSSProperties } from 'react'

// ============================================================================
// Tiny styling helpers shared by the components.
// ============================================================================

/** Join conditional class names. Falsy entries are dropped. */
export function cx(...parts: Array<string | false | null | undefined>): string {
  return parts.filter(Boolean).join(' ')
}

/**
 * Delay an element's entrance animation.
 *
 * The reveal animation reads `--i` from `styles.css`, which keeps the stagger in
 * CSS where it belongs and off the render path. The single cast lives here so no
 * component has to repeat it.
 */
export function stagger(index: number): CSSProperties {
  return { '--i': index } as CSSProperties
}

/** Human dates in the reader's locale, e.g. "5 Oct 2026, 14:03". */
export function formatDateTime(epochMs: number | null | undefined): string {
  if (epochMs === null || epochMs === undefined) return '—'
  return new Date(epochMs).toLocaleString(undefined, {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  })
}

/** Relative phrasing for timestamps, coarse on purpose ("3 h ago"). */
export function formatRelative(epochMs: number | null | undefined, now = Date.now()): string {
  if (epochMs === null || epochMs === undefined) return '—'
  const deltaSeconds = Math.round((epochMs - now) / 1000)
  const absolute = Math.abs(deltaSeconds)

  if (absolute < 60) return deltaSeconds >= 0 ? 'in a moment' : 'just now'

  const units: Array<[Intl.RelativeTimeFormatUnit, number]> = [
    ['year', 31_536_000],
    ['month', 2_592_000],
    ['day', 86_400],
    ['hour', 3_600],
    ['minute', 60],
  ]
  const formatter = new Intl.RelativeTimeFormat(undefined, { numeric: 'auto' })
  for (const [unit, secondsPerUnit] of units) {
    if (absolute >= secondsPerUnit) {
      return formatter.format(Math.round(deltaSeconds / secondsPerUnit), unit)
    }
  }
  return formatter.format(deltaSeconds, 'second')
}
