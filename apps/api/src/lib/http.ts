import type { Context } from 'hono'
import type { ContentfulStatusCode } from 'hono/utils/http-status'
import { deleteCookie, getCookie, setCookie } from 'hono/cookie'
import { SESSION_COOKIE_NAME, SESSION_TTL_MS } from './constants'
import { isProductionEnvironment } from './config'
import type { AppEnv, ListMeta, Pagination } from '../types'
import { totalPagesFor } from './query'

// ============================================================================
// HTTP plumbing: one response envelope, one place that reads client metadata,
// and the input sanitizers every write path funnels through.
// ============================================================================

export type AppContext = Context<AppEnv>

// ------------------------------------------------------------ client info --

export function getClientIp(c: AppContext): string | null {
  const headers = c.req.raw.headers
  // Cloudflare sets this and strips any client-supplied copy.
  const direct = headers.get('cf-connecting-ip')
  if (direct) return direct
  const forwarded = headers.get('x-forwarded-for')
  if (forwarded) {
    const first = forwarded.split(',')[0]?.trim()
    if (first) return first
  }
  return headers.get('x-real-ip')
}

export function getUserAgent(c: AppContext): string | null {
  return c.req.raw.headers.get('user-agent')
}

export function getRequestId(c: AppContext): string {
  return c.get('requestId')
}

/**
 * Which origin, if any, may receive an `Access-Control-Allow-Origin` header.
 *
 * `null` means "send no CORS grant". That is the correct answer more often than
 * it looks: when the SPA and this API are served from ONE origin (the intended
 * production shape), browsers do not apply CORS at all.
 *
 * Resolution order:
 *
 *   1. A configured `APP_ORIGIN` is an allow-list of exactly one origin —
 *      matching Hono's own behaviour for a plain string, which we reproduce
 *      here because the callback form is what lets case 3 return "no grant".
 *   2. Outside production, whatever origin asked is reflected, so a local dev
 *      server on any port works without config churn.
 *   3. In production an unconfigured `APP_ORIGIN` grants NOTHING. Reflecting
 *      the caller instead — which is what this did before — combined with
 *      `credentials: true` would hand credentialed access to every site on the
 *      internet.
 */
export function allowedOrigin(
  env: Cloudflare.Env,
  requestOrigin: string | null | undefined,
): string | null {
  const requested =
    typeof requestOrigin === 'string' && requestOrigin.length > 0 ? requestOrigin : null
  const configured = typeof env.APP_ORIGIN === 'string' ? env.APP_ORIGIN.trim() : ''

  if (configured.length > 0) return configured === requested ? configured : null
  if (isProductionEnvironment(env)) return null
  return requested
}

// --------------------------------------------------------------- envelope ---

export interface ApiMeta {
  [key: string]: unknown
}

export function ok<T>(
  c: AppContext,
  data: T,
  options: { status?: ContentfulStatusCode; meta?: ApiMeta } = {},
): Response {
  const meta: ApiMeta = { requestId: getRequestId(c), ...options.meta }
  return c.json({ data, meta }, options.status ?? 200)
}

export function list<T>(
  c: AppContext,
  items: readonly T[],
  total: number,
  pagination: Pagination,
  extraMeta: ApiMeta = {},
): Response {
  const meta: ListMeta = {
    requestId: getRequestId(c),
    page: pagination.page,
    limit: pagination.limit,
    total,
    totalPages: totalPagesFor(total, pagination.limit),
    ...extraMeta,
  }
  return c.json({ data: items, meta })
}

export function noContent(c: AppContext): Response {
  return c.body(null, 204)
}

// ---------------------------------------------------------------- cookies ---

export function readSessionToken(c: AppContext): string | null {
  return getCookie(c, SESSION_COOKIE_NAME) ?? null
}

/**
 * `__Host-` prefixed cookies are only accepted by browsers when Secure +
 * Path=/ + no Domain. Hono derives Domain from the request by default, so it
 * must be cleared explicitly.
 */
export function setSessionCookie(c: AppContext, token: string, maxAgeSeconds: number): void {
  setCookie(c, SESSION_COOKIE_NAME, token, {
    path: '/',
    secure: true,
    httpOnly: true,
    sameSite: 'Lax',
    maxAge: maxAgeSeconds,
    domain: undefined,
  })
}

export function clearSessionCookie(c: AppContext): void {
  deleteCookie(c, SESSION_COOKIE_NAME, {
    path: '/',
    secure: true,
    domain: undefined,
  })
}

export const SESSION_COOKIE_MAX_AGE_SECONDS = Math.floor(SESSION_TTL_MS / 1000)

// ------------------------------------------------------------- sanitizers ---

// Control characters, excluding \t (0x09) and \n (0x0A).
const CONTROL_CHARS = /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g

/** Single-line text: no newlines, no control chars, collapsed whitespace. */
export function sanitizeSingleLine(value: string, maxLength = 200): string {
  return value
    .replace(CONTROL_CHARS, '')
    .replace(/[\r\n]+/g, ' ')
    .replace(/\s{2,}/g, ' ')
    .trim()
    .slice(0, maxLength)
}

/** Multi-line text: newlines survive, everything else is normalised. */
export function sanitizeMultiline(value: string, maxLength = 2000): string {
  return value
    .replace(/\r\n?/g, '\n')
    .replace(CONTROL_CHARS, '')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
    .slice(0, maxLength)
}

/**
 * Emails are stored lowercased and trimmed.
 *
 * SQLite's default BINARY collation means `UNIQUE(email)` would happily accept
 * `A@x.com` and `a@x.com` as two different users, so normalising on write is
 * what actually enforces uniqueness.
 */
export function normalizeEmail(value: string): string {
  return value.trim().toLowerCase()
}

/** Usernames are lowercased for the same reason as emails. */
export function normalizeUsername(value: string): string {
  return value.trim().toLowerCase()
}

export function normalizeSlug(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9-_]/g, '-')
    .replace(/-{2,}/g, '-')
    .replace(/^[-_]+|[-_]+$/g, '')
}

/** Strips credentials from a URL and caps length; returns null if unusable. */
export function normalizeUrl(value: string): string | null {
  const trimmed = value.trim()
  if (trimmed.length === 0) return null
  try {
    const url = new URL(trimmed)
    if (url.protocol !== 'http:' && url.protocol !== 'https:') return null
    url.username = ''
    url.password = ''
    return url.toString()
  } catch {
    return null
  }
}

export function hostnameOf(value: string): string | null {
  try {
    return new URL(value).hostname.toLowerCase()
  } catch {
    return null
  }
}
