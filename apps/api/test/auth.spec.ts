import { beforeEach, describe, expect, it } from 'vitest'
import { env } from 'cloudflare:workers'
import { MAX_FAILED_LOGINS } from '../src/lib/constants'
import {
  TEST_PASSWORD,
  api,
  cookieHeaderFrom,
  countRows,
  createTestUser,
  loginAs,
  loginAsByEmail,
  readSessionCookieName,
  resetIsolateCaches,
  type Envelope,
  type ErrorEnvelope,
} from './helpers'
import type { AuthUser } from '../src/types'

// ============================================================================
// Authentication flows, end to end through the real Hono app and real D1.
// ============================================================================

beforeEach(() => {
  resetIsolateCaches()
})

function sessionTokenFrom(setCookie: string | null): string {
  const pair = cookieHeaderFrom(setCookie)
  return pair ? (pair.split('=')[1] ?? '') : ''
}

describe('POST /api/v1/auth/login', () => {
  it('requires a JSON body', async () => {
    const response = await api('POST', '/api/v1/auth/login', { body: {} })
    expect(response.status).toBe(422)
    expect((response.body as ErrorEnvelope).error.code).toBe('VALIDATION_ERROR')
  })

  it('rejects an unknown key in the body', async () => {
    const user = await createTestUser()
    const response = await api('POST', '/api/v1/auth/login', {
      body: { identifier: user.username, password: TEST_PASSWORD, isAdmin: true },
    })
    expect(response.status).toBe(422)
  })

  it('issues an httpOnly, secure, __Host- cookie and never echoes the token', async () => {
    const user = await createTestUser()
    const response = await api('POST', '/api/v1/auth/login', {
      body: { identifier: user.username, password: TEST_PASSWORD },
    })

    expect(response.status).toBe(200)
    const setCookie = response.setCookie ?? ''
    expect(setCookie).toContain(`${readSessionCookieName()}=`)
    expect(setCookie.toLowerCase()).toContain('httponly')
    expect(setCookie.toLowerCase()).toContain('secure')
    expect(setCookie.toLowerCase()).toContain('path=/')

    const token = sessionTokenFrom(response.setCookie)
    expect(token.length).toBeGreaterThan(20)
    // The cookie value must not appear anywhere in the response body.
    expect(JSON.stringify(response.body)).not.toContain(token)
  })

  it('normalises username case and surrounding whitespace', async () => {
    const user = await createTestUser()
    const response = await api('POST', '/api/v1/auth/login', {
      body: { identifier: `  ${user.username.toUpperCase()} `, password: TEST_PASSWORD },
    })
    expect(response.status).toBe(200)
  })

  it('accepts an email address in the same field', async () => {
    const user = await createTestUser()

    // Normalised exactly like any other identifier (case + whitespace)...
    const cased = await loginAsByEmail({ ...user, email: `  ${user.email.toUpperCase()} ` })
    // ...and the username reaches the same row.
    const named = await loginAs(user)

    const viaEmail = await api<Envelope<{ user: AuthUser }>>('GET', '/api/v1/auth/me', {
      cookie: cased,
    })
    const viaUsername = await api<Envelope<{ user: AuthUser }>>('GET', '/api/v1/auth/me', {
      cookie: named,
    })

    expect(viaEmail.body.data.user.id).toBe(user.id)
    expect(viaUsername.body.data.user.id).toBe(user.id)
  })

  it('rejects a wrong password with 401 and records a denied audit entry', async () => {
    const user = await createTestUser()
    const response = await api('POST', '/api/v1/auth/login', {
      body: { identifier: user.username, password: 'definitely-not-the-password' },
    })

    expect(response.status).toBe(401)
    expect((response.body as ErrorEnvelope).error.code).toBe('UNAUTHENTICATED')
    expect(
      await countRows("SELECT count(*) AS total FROM audit_logs WHERE action = 'auth.login.failed'"),
    ).toBe(1)
  })

  it('returns the same message for an unknown identifier, so it is not an oracle', async () => {
    const user = await createTestUser()
    const known = await api('POST', '/api/v1/auth/login', {
      body: { identifier: user.username, password: 'definitely-not-the-password' },
    })
    const unknown = await api('POST', '/api/v1/auth/login', {
      body: { identifier: 'nobody@example.com', password: 'definitely-not-the-password' },
    })

    expect(unknown.status).toBe(known.status)
    expect((unknown.body as ErrorEnvelope).error.message).toBe(
      (known.body as ErrorEnvelope).error.message,
    )
  })

  it('locks the account after too many failures and returns 423 + Retry-After', async () => {
    const user = await createTestUser()

    for (let attempt = 0; attempt < MAX_FAILED_LOGINS; attempt++) {
      const response = await api('POST', '/api/v1/auth/login', {
        body: { identifier: user.username, password: 'definitely-not-the-password' },
      })
      expect(response.status).toBe(401)
    }

    // Even the CORRECT password is refused while the lockout is active.
    const locked = await api('POST', '/api/v1/auth/login', {
      body: { identifier: user.username, password: TEST_PASSWORD },
    })
    expect(locked.status).toBe(423)
    expect((locked.body as ErrorEnvelope).error.code).toBe('ACCOUNT_LOCKED')
    expect(locked.headers.get('retry-after')).toBeTruthy()
  })

  it('counts concurrent failed attempts when enforcing the lockout threshold', async () => {
    const user = await createTestUser()
    await env.DB.prepare('UPDATE users SET failed_login_count = ? WHERE id = ?')
      .bind(MAX_FAILED_LOGINS - 2, user.id)
      .run()

    const attempts = await Promise.all(
      Array.from({ length: 2 }, () =>
        api('POST', '/api/v1/auth/login', {
          body: { identifier: user.username, password: 'definitely-not-the-password' },
        }),
      ),
    )

    expect(attempts.map((response) => response.status)).toEqual([401, 401])
    const locked = await api('POST', '/api/v1/auth/login', {
      body: { identifier: user.email, password: TEST_PASSWORD },
    })
    expect(locked.status).toBe(423)
    expect((locked.body as ErrorEnvelope).error.code).toBe('ACCOUNT_LOCKED')
  })

  it('verifies the password BEFORE revealing that a banned account is banned', async () => {
    const user = await createTestUser({ status: 'banned' })

    // Wrong password: indistinguishable from "no such account".
    const wrong = await api('POST', '/api/v1/auth/login', {
      body: { identifier: user.username, password: 'definitely-not-the-password' },
    })
    expect(wrong.status).toBe(401)

    resetIsolateCaches()

    // Correct password: now it is safe (and useful) to explain why.
    const right = await api('POST', '/api/v1/auth/login', {
      body: { identifier: user.username, password: TEST_PASSWORD },
    })
    expect(right.status).toBe(403)
    expect((right.body as ErrorEnvelope).error.code).toBe('ACCOUNT_DISABLED')
  })

  it('counts logins and stamps last_login_at', async () => {
    const user = await createTestUser()
    await loginAs(user)

    const row = await env.DB.prepare(
      'SELECT login_count, last_login_at, failed_login_count FROM users WHERE id = ?',
    )
      .bind(user.id)
      .first<{ login_count: number; last_login_at: number | null; failed_login_count: number }>()

    expect(row?.login_count).toBe(1)
    expect(row?.last_login_at).toBeGreaterThan(0)
    expect(row?.failed_login_count).toBe(0)
  })
})

describe('GET /api/v1/auth/me', () => {
  it('rejects a request with no session', async () => {
    const response = await api('GET', '/api/v1/auth/me')
    expect(response.status).toBe(401)
  })

  it('rejects a forged cookie', async () => {
    const response = await api('GET', '/api/v1/auth/me', {
      cookie: `${readSessionCookieName()}=not-a-real-token`,
    })
    expect(response.status).toBe(401)
  })

  it('returns the user and their capability set', async () => {
    const user = await createTestUser({ role: 'moderator' })
    const cookie = await loginAs(user)

    const response = await api<Envelope<{ user: AuthUser; capabilities: string[] }>>(
      'GET',
      '/api/v1/auth/me',
      { cookie },
    )

    expect(response.status).toBe(200)
    expect(response.body.data.user.id).toBe(user.id)
    expect(response.body.data.user.role).toBe('moderator')
    expect(response.body.data.capabilities).toContain('users.sanction')
    // Never leak credential material.
    expect(JSON.stringify(response.body)).not.toContain('pbkdf2')
    expect(response.body.data.user).not.toHaveProperty('passwordHash')
  })
})

describe('POST /api/v1/auth/logout', () => {
  it('revokes the session and clears the cookie', async () => {
    const user = await createTestUser()
    const cookie = await loginAs(user)

    const loggedOut = await api('POST', '/api/v1/auth/logout', { cookie })
    expect(loggedOut.status).toBe(204)
    expect((loggedOut.setCookie ?? '').toLowerCase()).toContain('max-age=0')

    // The token is now useless even though it was never expired server-side.
    const after = await api('GET', '/api/v1/auth/me', { cookie })
    expect(after.status).toBe(401)

    const revoked = await env.DB.prepare(
      'SELECT revoked_at, revoked_reason FROM sessions WHERE user_id = ?',
    )
      .bind(user.id)
      .first<{ revoked_at: number | null; revoked_reason: string | null }>()
    expect(revoked?.revoked_at).toBeGreaterThan(0)
    expect(revoked?.revoked_reason).toBe('user_logout')
  })
})

describe('POST /api/v1/auth/change-password', () => {
  it('refuses an incorrect current password', async () => {
    const user = await createTestUser()
    const cookie = await loginAs(user)

    const response = await api('POST', '/api/v1/auth/change-password', {
      cookie,
      body: { currentPassword: 'not-the-current-one', newPassword: 'a-brand-new-password-1' },
    })

    expect(response.status).toBe(400)
    expect((response.body as ErrorEnvelope).error.message).toMatch(/current password/i)
  })

  it('refuses a password shorter than the minimum', async () => {
    const user = await createTestUser()
    const cookie = await loginAs(user)

    const response = await api('POST', '/api/v1/auth/change-password', {
      cookie,
      body: { currentPassword: TEST_PASSWORD, newPassword: 'short' },
    })
    expect(response.status).toBe(422)
  })

  it('keeps the caller signed in and revokes every OTHER session', async () => {
    const user = await createTestUser()
    const cookieA = await loginAs(user)
    const cookieB = await loginAs(user)

    const response = await api<Envelope<{ revokedSessions: number }>>(
      'POST',
      '/api/v1/auth/change-password',
      {
        cookie: cookieA,
        body: { currentPassword: TEST_PASSWORD, newPassword: 'a-brand-new-password-1' },
      },
    )

    expect(response.status).toBe(200)
    expect(response.body.data.revokedSessions).toBe(1)

    // The caller survives; the other device is signed out.
    expect((await api('GET', '/api/v1/auth/me', { cookie: cookieA })).status).toBe(200)
    expect((await api('GET', '/api/v1/auth/me', { cookie: cookieB })).status).toBe(401)

    // The new password works.
    resetIsolateCaches()
    const withNew = await api('POST', '/api/v1/auth/login', {
      body: { identifier: user.username, password: 'a-brand-new-password-1' },
    })
    expect(withNew.status).toBe(200)
  })
})

describe('password reset', () => {
  it('mints a usable single-use token and revokes sessions on redemption', async () => {
    const user = await createTestUser()
    const cookie = await loginAs(user)

    const forgot = await api<Envelope<{ accepted: boolean; devToken: string | null }>>(
      'POST',
      '/api/v1/auth/forgot-password',
      { body: { email: user.email } },
    )
    expect(forgot.status).toBe(200)
    expect(forgot.body.data.accepted).toBe(true)

    // Non-production only: the token is surfaced because no provider is wired.
    const token = forgot.body.data.devToken
    expect(typeof token).toBe('string')

    const newPassword = 'reset-password-abc-123'
    const reset = await api<Envelope<{ userId: string; username: string }>>(
      'POST',
      '/api/v1/auth/reset-password',
      { body: { token, newPassword } },
    )
    expect(reset.status).toBe(200)
    // The response names the account, so somebody who only ever signed in with
    // their email address learns which username to use next time.
    expect(reset.body.data.username).toBe(user.username)

    // The session that existed before the reset is gone.
    expect((await api('GET', '/api/v1/auth/me', { cookie })).status).toBe(401)

    // The token cannot be replayed.
    const replay = await api('POST', '/api/v1/auth/reset-password', {
      body: { token, newPassword: 'another-password-here-1' },
    })
    expect(replay.status).toBe(400)

    resetIsolateCaches()
    const login = await api('POST', '/api/v1/auth/login', {
      body: { identifier: user.username, password: newPassword },
    })
    expect(login.status).toBe(200)
  })

  it('responds identically for an unknown address, without a token', async () => {
    const response = await api<Envelope<{ accepted: boolean; devToken: string | null }>>(
      'POST',
      '/api/v1/auth/forgot-password',
      { body: { email: 'nobody@example.com' } },
    )

    expect(response.status).toBe(200)
    expect(response.body.data.accepted).toBe(true)
    expect(response.body.data.devToken).toBeNull()
  })

  it('rejects an unknown reset token', async () => {
    const response = await api('POST', '/api/v1/auth/reset-password', {
      body: { token: 'x'.repeat(32), newPassword: 'some-valid-password-123' },
    })
    expect(response.status).toBe(400)
  })
})
