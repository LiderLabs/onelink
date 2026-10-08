import { env } from 'cloudflare:workers'
import { app } from '../src/app'
import { appConfig } from '../src/lib/config'
import { hashPassword } from '../src/lib/crypto'
import { ulid } from '../src/lib/ids'
import { now } from '../src/lib/clock'
import { SESSION_COOKIE_NAME, type Role, type UserStatus } from '../src/lib/constants'
import { invalidateRateLimitCache, resetRateLimitBuckets } from '../src/middleware/rate-limit'
import { invalidateSettingsCache } from '../src/services/settings.service'

// ============================================================================
// Test helpers.
//
// Tests drive the real Hono app through `app.request(..., env)`, against the
// real D1 binding. Nothing is mocked: the schema, the CHECK constraints, the
// FK enforcement and the SQL are all the production ones.
// ============================================================================

export const TEST_PASSWORD = 'correct-horse-battery-staple'

/**
 * Clears the per-isolate caches. Required between tests because the settings
 * and rate-limit caches are module-level (they are meant to be), so a test that
 * flips maintenance mode would otherwise leak into the next one.
 */
export function resetIsolateCaches(): void {
  invalidateSettingsCache()
  invalidateRateLimitCache()
  resetRateLimitBuckets()
}

export interface SeededUser {
  id: string
  email: string
  username: string
  role: Role
  password: string
}

/**
 * Inserts a user directly with a real PBKDF2 hash, so the login path is
 * exercised end to end rather than short-circuited.
 */
export async function createTestUser(
  options: {
    role?: Role
    email?: string
    username?: string
    password?: string
    status?: UserStatus
    requirePasswordChange?: boolean
  } = {},
): Promise<SeededUser> {
  const stamp = ulid()
  const id = ulid()
  const email = (options.email ?? `user-${stamp.toLowerCase()}@example.com`).toLowerCase()
  const username = options.username ?? `u${stamp.toLowerCase()}`
  const password = options.password ?? TEST_PASSWORD
  const role = options.role ?? 'user'
  const status = options.status ?? 'active'
  const timestamp = now()

  const passwordHash = await hashPassword(password, appConfig(env).pbkdf2Iterations)

  // Derive the denormalised suspension/deletion columns so the seeded row
  // satisfies the CHECK constraints for whatever status was requested.
  const suspendedUntil = status === 'suspended' ? timestamp + 60 * 60 * 1000 : null
  const deletedAt = status === 'deleted' ? timestamp : null

  await env.DB.prepare(
    `INSERT INTO users (
       id, email, username, display_name, email_verified, email_verified_at,
       password_hash, password_changed_at, require_password_change,
       role, status, status_reason, suspended_until, suspended_permanently,
       deleted_at, status_changed_at, created_at, updated_at
     ) VALUES (?,?,?,?,1,?,?,?,?,?,?,?,?,0,?,?,?,?)`,
  )
    .bind(
      id,
      email,
      username,
      username,
      timestamp,
      passwordHash,
      timestamp,
      options.requirePasswordChange ? 1 : 0,
      role,
      status,
      status === 'active' ? null : `seeded as ${status}`,
      suspendedUntil,
      deletedAt,
      timestamp,
      timestamp,
      timestamp,
    )
    .run()

  return { id, email, username, role, password }
}

export interface ApiResult<T = unknown> {
  status: number
  body: T
  headers: Headers
  setCookie: string | null
}

/** Minimal `name=value` cookie header extracted from a Set-Cookie response. */
export function cookieHeaderFrom(setCookie: string | null): string | null {
  if (!setCookie) return null
  const pair = setCookie.split(';')[0]
  return pair && pair.includes('=') ? pair : null
}

export function readSessionCookieName(): string {
  return SESSION_COOKIE_NAME
}

/**
 * Drives the app. An ExecutionContext is deliberately not passed: nothing in
 * the request path uses `waitUntil` (everything that must happen is awaited),
 * so tests stay deterministic and Hono's default context is enough.
 */
export async function api<T = unknown>(
  method: string,
  path: string,
  options: {
    body?: unknown
    cookie?: string | null
    /** Extra request headers — e.g. `cf-connecting-ip` to exercise IP rules. */
    headers?: Record<string, string>
  } = {},
): Promise<ApiResult<T>> {
  const headers = new Headers({ 'content-type': 'application/json' })
  if (options.cookie) headers.set('cookie', options.cookie)
  for (const [name, value] of Object.entries(options.headers ?? {})) headers.set(name, value)

  const init: RequestInit = { method, headers }
  if (options.body !== undefined) init.body = JSON.stringify(options.body)

  const response = await app.request(`http://localhost${path}`, init, env)
  const text = await response.text()

  let body: unknown = null
  if (text.length > 0) {
    try {
      body = JSON.parse(text)
    } catch {
      body = text
    }
  }

  return {
    status: response.status,
    body: body as T,
    headers: response.headers,
    setCookie: response.headers.get('set-cookie'),
  }
}

/**
 * The same as `api`, for the one endpoint whose body is not JSON (R1.3).
 *
 * The bytes go out verbatim and `content-type` is only set when the caller names
 * one — a request that declares no type at all is a real case the media route has
 * to answer, so the helper must be able to send one.
 */
export async function apiBytes<T = unknown>(
  method: string,
  path: string,
  options: {
    bytes: Uint8Array
    contentType?: string | null
    cookie?: string | null
    headers?: Record<string, string>
  },
): Promise<ApiResult<T>> {
  const headers = new Headers()
  if (options.contentType) headers.set('content-type', options.contentType)
  if (options.cookie) headers.set('cookie', options.cookie)
  for (const [name, value] of Object.entries(options.headers ?? {})) headers.set(name, value)

  const response = await app.request(
    `http://localhost${path}`,
    { method, headers, body: options.bytes },
    env,
  )
  const text = await response.text()

  let body: unknown = null
  if (text.length > 0) {
    try {
      body = JSON.parse(text)
    } catch {
      body = text
    }
  }

  return {
    status: response.status,
    body: body as T,
    headers: response.headers,
    setCookie: response.headers.get('set-cookie'),
  }
}

/** Logs in and returns the `name=value` cookie to replay on later requests. */
export async function loginAs(
  user: Pick<SeededUser, 'username' | 'password'>,
): Promise<string> {
  return loginWith({ identifier: user.username, password: user.password })
}

/** The same, but proving an email address is accepted as the identifier. */
export async function loginAsByEmail(
  user: Pick<SeededUser, 'email' | 'password'>,
): Promise<string> {
  return loginWith({ identifier: user.email, password: user.password })
}

/**
 * A session cookie for `targetUsername`, stamped as minted by a staff session
 * acting on that account (`sessions.impersonated_by`).
 *
 * There is deliberately no public "impersonate" endpoint in the API yet, so the
 * row is built here the way that route will build it. Both HTTP suites have to
 * prove that an impersonated session cannot write, so the fixture lives beside
 * the other shared ones instead of being copied per file.
 */
export async function impersonatedCookieFor(
  targetUsername: string,
  targetPassword: string,
): Promise<string> {
  const target = await createTestUser({ username: targetUsername, password: targetPassword })
  const admin = await createTestUser({ role: 'admin', username: `staff-${targetUsername}` })
  const cookie = await loginAs(target)

  await env.DB.prepare(
    `UPDATE sessions SET impersonated_by = ? WHERE user_id = ? AND revoked_at IS NULL`,
  )
    .bind(admin.id, target.id)
    .run()

  return cookie
}


async function loginWith(credentials: { identifier: string; password: string }): Promise<string> {
  const response = await api('POST', '/api/v1/auth/login', {
    body: credentials,
  })

  if (response.status !== 200) {
    throw new Error(
      `login failed with ${response.status}: ${JSON.stringify(response.body)}`,
    )
  }

  const cookie = cookieHeaderFrom(response.setCookie)
  if (!cookie) throw new Error('login succeeded but no session cookie was set')
  return cookie
}

export interface Envelope<T> {
  data: T
  meta: { requestId: string } & Record<string, unknown>
}

export interface ErrorEnvelope {
  error: { code: string; message: string; details?: unknown }
  meta: { requestId: string }
}

export async function countRows(sql: string, ...binds: unknown[]): Promise<number> {
  const row = await env.DB.prepare(sql)
    .bind(...binds)
    .first<{ total: number }>()
  return row?.total ?? 0
}

/**
 * Overwrites a seeded setting and drops the settings cache, so the next request
 * in this isolate sees the new value.
 *
 * `UPDATE` rather than an upsert: every key a test wants to flip already has a
 * row from `seed/0001_platform-defaults.sql`, and inventing a row for an unseeded
 * key would not be read by code that looks up a fixed key anyway — better to
 * fail loudly.
 */
export async function setSettingValue(key: string, value: string): Promise<void> {
  const result = await env.DB.prepare(
    'UPDATE settings SET value = ?, updated_at = ? WHERE key = ?',
  )
    .bind(value, now(), key)
    .run()

  if ((result.meta.changes ?? 0) === 0) {
    throw new Error(`No settings row for "${key}" — add it to the seed first.`)
  }
  invalidateSettingsCache()
}

export interface SignupCredentials {
  username: string
  email: string
  password: string
}

/** A fresh username/email pair that cannot collide with anything seeded. */
export function signupCredentials(prefix = 'newcomer'): SignupCredentials {
  const stamp = ulid().toLowerCase().slice(0, 16)
  return {
    username: `${prefix}${stamp}`,
    email: `${prefix}${stamp}@example.com`,
    password: TEST_PASSWORD,
  }
}

/**
 * The tables the tests populate. Child rows come first: `pages.user_id` and
 * `sanctions.user_id` are ON DELETE RESTRICT, so clearing a parent before its
 * children aborts the batch instead of cascading.
 *
 * `settings`, `email_templates` and `rate_limits` are deliberately absent —
 * they are seeded platform defaults (`seed/0001_platform-defaults.sql`) and the
 * services read them on nearly every request.
 */
const VOLATILE_TABLES = [
  'report_actions',
  'content_flags',
  'appeals',
  'audit_logs',
  'user_notes',
  'sanctions',
  'reports',
  'page_analytics_daily',
  'media_assets',
  'page_revisions',
  'page_invitations',
  'page_drafts',
  'page_links',
  'link_groups',
  'page_members',
  'slug_reservations',
  'pages',
  'sessions',
  'password_reset_tokens',
  'invitations',
  // `user_social_links.user_id` is ON DELETE RESTRICT like the others, so it has to
  // go before `users` (R1.2).
  'user_social_links',
  'users',
] as const

/**
 * Returns the database to its post-seed state between tests.
 *
 * Without this, rows leak across tests in a file — a pagination assertion that
 * expects six users sees ten because an earlier test left four behind — and the
 * failure looks like a bug in the code under test rather than in the fixture.
 */
export async function resetDatabase(): Promise<void> {
  await resetMediaStorage()
  await env.DB.batch(VOLATILE_TABLES.map((table) => env.DB.prepare(`DELETE FROM ${table}`)))
}

export async function rawApi(method: string, path: string, options: {
  body?: Uint8Array; cookie?: string | null; headers?: Record<string, string>
} = {}): Promise<Response> {
  const headers = new Headers(options.headers)
  if (options.cookie) headers.set('cookie', options.cookie)
  return app.request(`http://localhost${path}`, { method, headers, body: options.body }, env)
}

export async function resetMediaStorage(): Promise<void> {
  for (const bucket of [env.PUBLIC_BUCKET, env.PRIVATE_BUCKET]) {
    let cursor: string | undefined
    do {
      const page = await bucket.list({ cursor })
      if (page.objects.length) await bucket.delete(page.objects.map(object => object.key))
      cursor = page.truncated ? page.cursor : undefined
    } while (cursor)
  }
}
