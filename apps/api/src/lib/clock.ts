import { MINUTE, HOUR, DAY } from './constants'

/** Current wall-clock time in epoch milliseconds. */
export function now(): number {
  return Date.now()
}

/** epoch-ms -> ISO-8601 (used for API output; SQL has VIRTUAL companions too). */
export function toIso(ms: number | null | undefined): string | null {
  if (ms === null || ms === undefined) return null
  return new Date(ms).toISOString()
}

export function addMs(ms: number, delta: number): number {
  return ms + delta
}

export function addMinutes(ms: number, minutes: number): number {
  return ms + minutes * MINUTE
}

export function addHours(ms: number, hours: number): number {
  return ms + hours * HOUR
}

export function addDays(ms: number, days: number): number {
  return ms + days * DAY
}

export function isExpired(at: number | null | undefined, reference: number = now()): boolean {
  return at !== null && at !== undefined && at <= reference
}

/** "3 hours ago" style durations, used in audit/UI text. */
export function humanizeDuration(ms: number): string {
  const abs = Math.abs(ms)
  if (abs < MINUTE) return `${Math.round(abs / 1000)}s`
  if (abs < HOUR) return `${Math.round(abs / MINUTE)}m`
  if (abs < DAY) return `${Math.round(abs / HOUR)}h`
  return `${Math.round(abs / DAY)}d`
}
