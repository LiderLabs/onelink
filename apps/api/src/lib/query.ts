import { DEFAULT_PAGE_SIZE, MAX_PAGE_SIZE } from './constants'
import type { Pagination } from '../types'

// ============================================================================
// Small SQL/query helpers. Everything here exists to keep user input out of the
// SQL string: only whitelisted identifiers are ever interpolated.
// ============================================================================

/** Hard cap on LIKE terms — D1 rejects LIKE patterns beyond ~50 bytes. */
export const MAX_SEARCH_LENGTH = 40

export function clampInt(value: unknown, min: number, max: number, fallback: number): number {
  const parsed =
    typeof value === 'number' ? value : Number.parseInt(String(value ?? ''), 10)
  if (!Number.isFinite(parsed)) return fallback
  return Math.min(Math.max(Math.trunc(parsed), min), max)
}

export function parsePagination(
  query: { page?: unknown; limit?: unknown },
  defaultLimit = DEFAULT_PAGE_SIZE,
): Pagination {
  const page = clampInt(query.page, 1, 1_000_000, 1)
  const limit = clampInt(query.limit, 1, MAX_PAGE_SIZE, defaultLimit)
  return { page, limit, offset: (page - 1) * limit }
}

export function totalPagesFor(total: number, limit: number): number {
  return limit <= 0 ? 0 : Math.ceil(total / limit)
}

/**
 * Escapes the LIKE metacharacters. Paired with `ESCAPE '\'` in the SQL, this is
 * what stops a user typing `%` and turning a search into a table scan.
 */
export function likeContains(term: string): string {
  const trimmed = term.trim().slice(0, MAX_SEARCH_LENGTH)
  const escaped = trimmed.replace(/[\\%_]/g, (match) => `\\${match}`)
  return `%${escaped}%`
}

export function chunk<T>(items: readonly T[], size: number): T[][] {
  if (size <= 0) throw new Error('chunk size must be positive')
  const out: T[][] = []
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size))
  return out
}

/** "?,?,?" — for building dynamic IN (...) clauses with bound params. */
export function placeholders(count: number): string {
  if (count <= 0) throw new Error('placeholders count must be positive')
  return new Array(count).fill('?').join(',')
}

export function jsonText(value: unknown): string | null {
  if (value === undefined || value === null) return null
  try {
    const text = JSON.stringify(value)
    // A bare `undefined` / function serialises to undefined.
    return text === undefined ? null : text
  } catch {
    return null
  }
}

export function parseJson<T>(text: string | null | undefined): T | null {
  if (!text) return null
  try {
    return JSON.parse(text) as T
  } catch {
    return null
  }
}

/**
 * Maps a client-supplied `sort` value onto a known ORDER BY fragment.
 *
 * EXACT-MATCH WHITELIST: the returned string is always a value taken from
 * `allowed`, never from `raw`, so no part of the input can reach the SQL.
 * Each allowed value is a complete fragment including its direction (e.g.
 * `'-created_at'` is a legitimate KEY if you want a descending variant), which
 * keeps this a pure lookup with no direction parsing to get wrong.
 *
 * Unknown or missing input falls back to `fallbackKey`.
 */
export function resolveSort(
  raw: string | undefined,
  allowed: Record<string, string>,
  fallbackKey: string,
): string {
  if (raw !== undefined) {
    const fragment = allowed[raw.trim()]
    if (fragment) return fragment
  }

  const fallback = allowed[fallbackKey]
  if (!fallback) throw new Error(`unknown sort fallback: ${fallbackKey}`)
  return fallback
}

// ------------------------------------------------------- SQL fragment bits --

export function andWhere(clauses: readonly string[]): string {
  const present = clauses.filter((clause) => clause.length > 0)
  return present.length === 0 ? '' : `WHERE ${present.join(' AND ')}`
}

/** D1 returns the first result cell as `number | string | null`. */
export function asCount(row: { total?: unknown } | null | undefined): number {
  const value = row?.total
  if (typeof value === 'number') return value
  if (typeof value === 'string') return Number.parseInt(value, 10) || 0
  return 0
}

export function boolToInt(value: boolean): number {
  return value ? 1 : 0
}

export function intToBool(value: number | null | undefined): boolean {
  return value === 1
}
