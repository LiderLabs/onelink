import { beforeEach, describe, expect, it } from 'vitest'
import { env } from 'cloudflare:workers'
import { getBooleanSetting, SETTING_KEYS } from '../src/services/settings.service'
import {
  api,
  cookieHeaderFrom,
  countRows,
  readSessionCookieName,
  resetIsolateCaches,
  setSettingValue,
  signupCredentials,
  type Envelope,
  type ErrorEnvelope,
} from './helpers'
import type { AuthUser } from '../src/types'

// ============================================================================
// POST /api/v1/auth/register — public sign-up, end to end against real D1.
//
// Sign-up is an account-enumeration oracle BY DESIGN: the 409s name the field
// that clashed, because there is no mail provider to hide behind. That makes
// the `register_ip` rate limit and the `registration_open` switch load-bearing
// security controls rather than niceties, so both are asserted here.
// ============================================================================

interface RegisterData {
  user: AuthUser
  capabilities: string[]
  expiresAt: number
}

/** Registers over HTTP; `ip` sets `cf-connecting-ip` to choose a bucket. */
function register(body: unknown, ip?: string) {
  return api<Envelope<RegisterData>>('POST', '/api/v1/auth/register', {
    body,
    ...(ip === undefined ? {} : { headers: { 'cf-connecting-ip': ip } }),
  })
}

/**
 * The error envelope of a failed response.
 *
 * A single cast, rather than seven, because the success type and the error type
 * are mutually exclusive by construction and TypeScript cannot know which one a
 * given call returned.
 */
function errorOf(response: { body: unknown }): ErrorEnvelope {
  return response.body as ErrorEnvelope
}

beforeEach(async () => {
  // Rate-limit buckets are per-isolate and shared by every test in this file,
  // and `app.request()` sends no `cf-connecting-ip`, so they all count against
  // a single `unknown` bucket. Without this reset the sixth registration in the
  // FILE would 429 — a failure that would surface nowhere near its cause.
  resetIsolateCaches()

  // `settings` is seeded rather than volatile (see helpers.resetDatabase), so a
  // switch flipped by one test would otherwise leak into the next one.
  await setSettingValue(SETTING_KEYS.registrationOpen, 'true')
  await setSettingValue(SETTING_KEYS.maintenanceMode, 'false')
})

describe('POST /api/v1/auth/register', () => {
  it('creates an active user, signs them in and answers 201', async () => {
    const creds = signupCredentials()
    const response = await register(creds)

    expect(response.status).toBe(201)
    expect(response.body.data.user).toMatchObject({
      username: creds.username,
      email: creds.email,
      displayName: creds.username,
      role: 'user',
      status: 'active',
      emailVerified: false,
      requirePasswordChange: false,
      loginCount: 1,
    })
    // A brand-new account holds nothing: this endpoint cannot mint staff.
    expect(response.body.data.capabilities).toEqual([])
    expect(response.body.data.expiresAt).toBeGreaterThan(Date.now())

    // Never leak credential material.
    expect(response.body.data.user).not.toHaveProperty('passwordHash')
    expect(JSON.stringify(response.body)).not.toContain('pbkdf2')
  })

  it('sets the same __Host- cookie login would, and never echoes the token', async () => {
    const response = await register(signupCredentials())
    const setCookie = response.setCookie ?? ''

    expect(setCookie).toContain(`${readSessionCookieName()}=`)
    expect(setCookie.toLowerCase()).toContain('httponly')
    expect(setCookie.toLowerCase()).toContain('secure')
    expect(setCookie.toLowerCase()).toContain('path=/')

    const token = (cookieHeaderFrom(response.setCookie) ?? '').split('=')[1] ?? ''
    expect(token.length).toBeGreaterThan(20)
    expect(JSON.stringify(response.body)).not.toContain(token)
  })

  it('persists exactly what the endpoint promises', async () => {
    const creds = signupCredentials()
    const response = await register(creds)

    const row = await env.DB.prepare(
      `SELECT display_name, role, status, email_verified, require_password_change,
              password_hash, login_count, last_login_at
         FROM users WHERE username = ?`,
    )
      .bind(creds.username)
      .first<{
        display_name: string | null
        role: string
        status: string
        email_verified: number
        require_password_change: number
        password_hash: string
        login_count: number
        last_login_at: number | null
      }>()

    expect(row?.role).toBe('user')
    expect(row?.status).toBe('active')
    // Nothing can prove this address, so the flag records the truth rather than
    // the convenience of assuming it.
    expect(row?.email_verified).toBe(0)
    // The caller just chose this password; there is nothing to force.
    expect(row?.require_password_change).toBe(0)
    expect(row?.password_hash).toMatch(/^pbkdf2\$sha256\$\d+\$/)
    // The minted session bumped the counters exactly as a login would have.
    expect(row?.login_count).toBe(1)
    expect(row?.last_login_at).toBeGreaterThan(0)
    expect(row?.display_name).toBeNull()

    expect(
      await countRows(
        'SELECT count(*) AS total FROM sessions WHERE user_id = ?',
        response.body.data.user.id,
      ),
    ).toBe(1)
  })

  it('hands back a session that works immediately', async () => {
    const response = await register(signupCredentials())
    const cookie = cookieHeaderFrom(response.setCookie) ?? ''

    const me = await api<Envelope<{ user: AuthUser }>>('GET', '/api/v1/auth/me', { cookie })
    expect(me.status).toBe(200)
    expect(me.body.data.user.id).toBe(response.body.data.user.id)
  })

  it('creates credentials that then work for login by username and by email', async () => {
    const creds = signupCredentials()
    await register(creds)

    const byUsername = await api('POST', '/api/v1/auth/login', {
      body: { identifier: creds.username, password: creds.password },
    })
    const byEmail = await api('POST', '/api/v1/auth/login', {
      body: { identifier: creds.email, password: creds.password },
    })

    expect(byUsername.status).toBe(200)
    expect(byEmail.status).toBe(200)
  })

  it('normalises the username and email it stores', async () => {
    const creds = signupCredentials()
    const response = await register({
      username: `  ${creds.username.toUpperCase()}  `,
      email: `  ${creds.email.toUpperCase()} `,
      password: creds.password,
    })

    expect(response.status).toBe(201)
    expect(response.body.data.user.username).toBe(creds.username)
    expect(response.body.data.user.email).toBe(creds.email)
  })

  it('refuses a username or email that is already taken', async () => {
    const first = signupCredentials()
    await register(first)

    const duplicateEmail = await register({ ...signupCredentials(), email: first.email })
    expect(duplicateEmail.status).toBe(409)
    expect(errorOf(duplicateEmail).error.message).toMatch(/already registered/i)

    const duplicateUsername = await register({ ...signupCredentials(), username: first.username })
    expect(duplicateUsername.status).toBe(409)
    expect(errorOf(duplicateUsername).error.message).toMatch(/already taken/i)

    // Comparison happens after normalisation, so case cannot be used to shadow
    // somebody else's address.
    const cased = await register({ ...signupCredentials(), email: first.email.toUpperCase() })
    expect(cased.status).toBe(409)
  })

  it('refuses reserved usernames, whatever the case', async () => {
    for (const username of ['owner', 'Admin', 'support']) {
      const response = await register({ ...signupCredentials(), username })
      expect(response.status).toBe(400)
      expect(errorOf(response).error.message).toMatch(/reserved/i)
    }

    // Refused, not silently rewritten into something nobody asked for.
    expect(
      await countRows(
        "SELECT count(*) AS total FROM users WHERE lower(username) IN ('owner','admin','support')",
      ),
    ).toBe(0)
  })

  it('rejects a body that tries to choose a role, or carries unknown keys', async () => {
    const creds = signupCredentials()

    const withRole = await register({ ...creds, role: 'owner' })
    expect(withRole.status).toBe(422)
    expect(errorOf(withRole).error.code).toBe('VALIDATION_ERROR')

    const unknownKey = await register({ ...creds, isAdmin: true })
    expect(unknownKey.status).toBe(422)

    // Neither attempt created anything.
    expect(await countRows('SELECT count(*) AS total FROM users WHERE email = ?', creds.email)).toBe(
      0,
    )
  })

  it('rejects identities and passwords the schema or the policy will not accept', async () => {
    // Schema level: the shape of the username, the length of the password.
    expect((await register({ ...signupCredentials(), username: 'no spaces' })).status).toBe(422)
    expect((await register({ ...signupCredentials(), username: 'ab' })).status).toBe(422)
    expect((await register({ ...signupCredentials(), password: 'short' })).status).toBe(422)

    // Policy level: a password built out of the account's own identity.
    const creds = signupCredentials()
    const leaky = await register({ ...creds, password: `${creds.username}-and-then-some-more` })
    expect(leaky.status).toBe(400)
    expect(errorOf(leaky).error.message).toMatch(/must not contain/i)
    expect(await countRows('SELECT count(*) AS total FROM users WHERE email = ?', creds.email)).toBe(
      0,
    )
  })

  it('closes the door when registration_open is off', async () => {
    await setSettingValue(SETTING_KEYS.registrationOpen, 'false')

    const creds = signupCredentials()
    const closed = await register(creds)

    expect(closed.status).toBe(403)
    expect(errorOf(closed).error.code).toBe('FORBIDDEN')
    // Closed means closed: no account, no cookie.
    expect(closed.setCookie).toBeNull()
    expect(await countRows('SELECT count(*) AS total FROM users WHERE email = ?', creds.email)).toBe(
      0,
    )

    // ...and the same request goes through the moment the switch is back on.
    await setSettingValue(SETTING_KEYS.registrationOpen, 'true')
    expect((await register(creds)).status).toBe(201)
  })

  it('still works during maintenance mode, which blocks other writes', async () => {
    await setSettingValue(SETTING_KEYS.maintenanceMode, 'true')
    // The guard really is active (read back through the service)...
    expect(await getBooleanSetting(env.DB, SETTING_KEYS.maintenanceMode, false)).toBe(true)

    // ...it blocks an ordinary write...
    const blocked = await api('POST', '/api/v1/admin/users', { body: {} })
    expect(blocked.status).toBe(503)
    expect((blocked.body as ErrorEnvelope).error.code).toBe('MAINTENANCE')

    // ...but /api/v1/auth is exempt (middleware/maintenance.ts), so sign-up is
    // still available. `registration_open` is the switch that closes it.
    expect((await register(signupCredentials())).status).toBe(201)
  })

  it('audits the account and the session it created', async () => {
    const creds = signupCredentials()
    const response = await register(creds)

    expect(
      await countRows("SELECT count(*) AS total FROM audit_logs WHERE action = 'user.register'"),
    ).toBe(1)
    expect(
      await countRows("SELECT count(*) AS total FROM audit_logs WHERE action = 'auth.register'"),
    ).toBe(1)

    // The anonymous caller is attributed to the account it just created, so a
    // sign-up is traceable to something rather than to nobody.
    const row = await env.DB.prepare(
      `SELECT actor_user_id, actor_label, actor_role, target_type, target_label
         FROM audit_logs WHERE action = 'user.register'`,
    ).first<{
      actor_user_id: string | null
      actor_label: string | null
      actor_role: string | null
      target_type: string | null
      target_label: string | null
    }>()

    expect(row?.actor_user_id).toBe(response.body.data.user.id)
    expect(row?.actor_label).toBe(creds.username)
    expect(row?.actor_role).toBe('user')
    expect(row?.target_type).toBe('user')
    expect(row?.target_label).toBe(creds.email)
  })

  it('is throttled per IP, so it cannot be used as a bulk name lookup', async () => {
    // The seeded rule is 5/hour for `register_ip`.
    for (let attempt = 0; attempt < 5; attempt++) {
      const response = await register(signupCredentials(), '203.0.113.7')
      expect(response.status).toBe(201)
    }

    const throttled = await register(signupCredentials(), '203.0.113.7')
    expect(throttled.status).toBe(429)
    expect(errorOf(throttled).error.code).toBe('RATE_LIMITED')
    expect(throttled.headers.get('retry-after')).toBeTruthy()

    // A different caller is unaffected: the rule is per IP, not global.
    expect((await register(signupCredentials(), '203.0.113.8')).status).toBe(201)
  })
})

