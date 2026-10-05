import { badRequest } from './errors'
import { MAX_SEARCH_LENGTH } from './query'
import type { AppContext } from './http'

// ============================================================================
// Query-string readers.
//
// Query strings are validated by hand rather than through a schema library:
// every value arrives as `string | undefined`, so a schema only adds a layer of
// coercion guesswork. These helpers reject loudly on garbage and return
// `undefined` for "not supplied", which is what the callers actually need.
// ============================================================================

export function readString(c: AppContext, name: string, maxLength = 200): string | undefined {
  const raw = c.req.query(name)
  if (raw === undefined) return undefined
  const value = raw.trim()
  if (value.length === 0) return undefined
  return value.slice(0, maxLength)
}

export function readSearch(c: AppContext, name = 'q'): string | undefined {
  return readString(c, name, MAX_SEARCH_LENGTH)
}

export function readInt(c: AppContext, name: string): number | undefined {
  const raw = c.req.query(name)
  if (raw === undefined || raw.trim().length === 0) return undefined
  const parsed = Number.parseInt(raw, 10)
  if (!Number.isFinite(parsed)) throw badRequest(`"${name}" must be an integer.`)
  return parsed
}

export function readEnum<T extends string>(
  c: AppContext,
  name: string,
  allowed: readonly T[],
): T | undefined {
  const raw = c.req.query(name)
  if (raw === undefined || raw.trim().length === 0) return undefined
  const value = raw.trim() as T
  if (!allowed.includes(value)) {
    throw badRequest(`"${name}" must be one of: ${allowed.join(', ')}.`)
  }
  return value
}

export function readBoolean(c: AppContext, name: string): boolean | undefined {
  const raw = c.req.query(name)
  if (raw === undefined) return undefined
  const value = raw.trim().toLowerCase()
  if (value === '') return undefined
  if (value === 'true' || value === '1' || value === 'yes') return true
  if (value === 'false' || value === '0' || value === 'no') return false
  throw badRequest(`"${name}" must be a boolean.`)
}

/** Accepts epoch-ms as a number, or an ISO-8601 date string. */
export function readTimestamp(c: AppContext, name: string): number | undefined {
  const raw = c.req.query(name)
  if (raw === undefined || raw.trim().length === 0) return undefined
  const value = raw.trim()

  if (/^\d+$/.test(value)) return Number.parseInt(value, 10)

  const parsed = Date.parse(value)
  if (!Number.isFinite(parsed)) {
    throw badRequest(`"${name}" must be epoch milliseconds or an ISO-8601 date.`)
  }
  return parsed
}
