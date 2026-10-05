import { beforeEach, describe, expect, it } from 'vitest'
import { env } from 'cloudflare:workers'
import {
  TEST_PASSWORD,
  api,
  countRows,
  createTestUser,
  loginAs,
  resetIsolateCaches,
  type Envelope,
  type ErrorEnvelope,
} from './helpers'
import type { ApiUser } from '../src/types'
import type { Role, UserStatus } from '../src/lib/constants'

// ============================================================================
// /api/v1/admin/users — the "view all users + user actions" requirement.
//
// These tests lean on two things the schema guarantees for free: the CHECK
// constraints (a half-updated status row is impossible) and FK enforcement.
// ============================================================================

beforeEach(() => {
  resetIsolateCaches()
})

interface UserStateRow {
  status: UserStatus
  status_reason: string | null
  suspended_until: number | null
  suspended_permanently: number
  deleted_at: number | null
  role: Role
  require_password_change: number
}

async function statusOf(userId: string): Promise<UserStateRow | null> {
  return env.DB.prepare(
    `SELECT status, status_reason, suspended_until, suspended_permanently, deleted_at, role, require_password_change
       FROM users WHERE id = ?`,
  )
    .bind(userId)
    .first<UserStateRow>()
}

describe('access control on /api/v1/admin/users', () => {
  it('requires authentication', async () => {
    const response = await api('GET', '/api/v1/admin/users')
    expect(response.status).toBe(401)
    expect((response.body as ErrorEnvelope).error.code).toBe('UNAUTHENTICATED')
  })

  it('refuses a plain user, whose role holds no capabilities', async () => {
    const user = await createTestUser({ role: 'user' })
    const cookie = await loginAs(user)

    const response = await api('GET', '/api/v1/admin/users', { cookie })
    expect(response.status).toBe(403)
    expect((response.body as ErrorEnvelope).error.message).toMatch(/capability/i)
  })

  it('lets a moderator read the list but not create accounts', async () => {
    const moderator = await createTestUser({ role: 'moderator' })
    const cookie = await loginAs(moderator)

    expect((await api('GET', '/api/v1/admin/users', { cookie })).status).toBe(200)

    const created = await api('POST', '/api/v1/admin/users', {
      cookie,
      body: {
        email: 'newbie@example.com',
        role: 'support',
        password: 'a-good-password-1234',
      },
    })
    expect(created.status).toBe(403)
  })

  it('blocks a suspended account that still holds a valid session', async () => {
    const moderator = await createTestUser({ role: 'moderator' })
    const cookie = await loginAs(moderator)

    // Suspend out of band, leaving the session row intact.
    await env.DB.prepare(
      `UPDATE users SET status = 'suspended', suspended_until = ?, status_reason = 'paused'
        WHERE id = ?`,
    )
      .bind(Date.now() + 3_600_000, moderator.id)
      .run()

    const response = await api('GET', '/api/v1/admin/users', { cookie })
    expect(response.status).toBe(403)
    expect((response.body as ErrorEnvelope).error.code).toBe('ACCOUNT_DISABLED')
  })

  it('forces a password change before any admin action is allowed', async () => {
    const owner = await createTestUser({ role: 'owner' })
    await env.DB.prepare('UPDATE users SET require_password_change = 1 WHERE id = ?')
      .bind(owner.id)
      .run()
    const cookie = await loginAs(owner)

    const blocked = await api('GET', '/api/v1/admin/users', { cookie })
    expect(blocked.status).toBe(403)
    expect((blocked.body as ErrorEnvelope).error.code).toBe('MUST_CHANGE_PASSWORD')

    // …but the change-password route must still be reachable, or the user
    // would be permanently locked out.
    const allowed = await api('POST', '/api/v1/auth/change-password', {
      cookie,
      body: { currentPassword: TEST_PASSWORD, newPassword: 'a-brand-new-password-1' },
    })
    expect(allowed.status).toBe(200)
  })
})

describe('GET /api/v1/admin/users', () => {
  it('paginates and reports totals', async () => {
    const owner = await createTestUser({ role: 'owner' })
    for (let index = 0; index < 5; index++) await createTestUser({ role: 'user' })
    const cookie = await loginAs(owner)

    const response = await api<
      Envelope<ApiUser[]> & { meta: { total: number; totalPages: number; page: number } }
    >('GET', '/api/v1/admin/users?page=1&limit=3', { cookie })

    expect(response.status).toBe(200)
    expect(response.body.data).toHaveLength(3)
    expect(response.body.meta.total).toBe(6)
    expect(response.body.meta.totalPages).toBe(2)
  })

  it('filters by role and by free-text search', async () => {
    const owner = await createTestUser({ role: 'owner' })
    const moderator = await createTestUser({ role: 'moderator', username: 'zzmoderator' })
    await createTestUser({ role: 'user' })
    const cookie = await loginAs(owner)

    const byRole = await api<Envelope<ApiUser[]>>('GET', '/api/v1/admin/users?role=moderator', {
      cookie,
    })
    expect(byRole.body.data.map((row) => row.id)).toEqual([moderator.id])

    const bySearch = await api<Envelope<ApiUser[]>>('GET', '/api/v1/admin/users?q=zzmod', {
      cookie,
    })
    expect(bySearch.body.data.map((row) => row.id)).toEqual([moderator.id])

    const byEmail = await api<Envelope<ApiUser[]>>(
      'GET',
      `/api/v1/admin/users?q=${encodeURIComponent(owner.email)}`,
      { cookie },
    )
    expect(byEmail.body.data.map((row) => row.id)).toEqual([owner.id])
  })

  it('treats LIKE metacharacters as literals rather than wildcards', async () => {
    const owner = await createTestUser({ role: 'owner' })
    await createTestUser({ role: 'user' })
    const cookie = await loginAs(owner)

    // A bare `%` must NOT match everything.
    const response = await api<Envelope<ApiUser[]>>('GET', '/api/v1/admin/users?q=%25', { cookie })
    expect(response.body.data).toHaveLength(0)
  })

  it('rejects an unknown role filter instead of silently ignoring it', async () => {
    const owner = await createTestUser({ role: 'owner' })
    const cookie = await loginAs(owner)

    const response = await api('GET', '/api/v1/admin/users?role=superuser', { cookie })
    expect(response.status).toBe(400)
  })

  it('hides soft-deleted users unless they are explicitly asked for', async () => {
    const owner = await createTestUser({ role: 'owner' })
    const ghost = await createTestUser({ role: 'user' })
    await env.DB.prepare(
      `UPDATE users SET status = 'deleted', deleted_at = ?, deleted_by = ? WHERE id = ?`,
    )
      .bind(Date.now(), owner.id, ghost.id)
      .run()

    const cookie = await loginAs(owner)
    const visible = await api<Envelope<ApiUser[]>>('GET', '/api/v1/admin/users', { cookie })
    expect(visible.body.data.map((row) => row.id)).not.toContain(ghost.id)

    const explicit = await api<Envelope<ApiUser[]>>(
      'GET',
      '/api/v1/admin/users?status=deleted',
      { cookie },
    )
    expect(explicit.body.data.map((row) => row.id)).toContain(ghost.id)
  })

  it('never exposes password material', async () => {
    const owner = await createTestUser({ role: 'owner' })
    const cookie = await loginAs(owner)

    const response = await api('GET', '/api/v1/admin/users', { cookie })
    expect(JSON.stringify(response.body)).not.toContain('pbkdf2')
    expect(JSON.stringify(response.body)).not.toContain('password_hash')
  })
})

describe('GET /api/v1/admin/users/:id', () => {
  it('404s for an unknown id', async () => {
    const owner = await createTestUser({ role: 'owner' })
    const cookie = await loginAs(owner)

    const response = await api('GET', '/api/v1/admin/users/01ARZ3NDEKTSV4RRFFQ69G5FAV', { cookie })
    expect(response.status).toBe(404)
  })

  it('returns the user with the counters the detail view needs', async () => {
    const owner = await createTestUser({ role: 'owner' })
    const target = await createTestUser({ role: 'user' })
    await loginAs(target)
    const cookie = await loginAs(owner)

    const response = await api<
      Envelope<{
        user: ApiUser
        counts: Record<string, number>
        sanctions: unknown[]
      }>
    >('GET', `/api/v1/admin/users/${target.id}`, { cookie })

    expect(response.status).toBe(200)
    expect(response.body.data.user.id).toBe(target.id)
    expect(response.body.data.counts.sessions).toBe(1)
    expect(response.body.data.counts.sanctions).toBe(0)
    expect(response.body.data.sanctions).toEqual([])
  })
})

// ============================================================================
// Moderation actions.
//
// Each of these is a destructive write, so each is guarded twice: the
// capability on the route, then the rank rule inside the service. `statusOf()`
// reads the raw row afterwards rather than trusting the response body, which is
// a mapped view — asserting on the response alone would not catch a column
// written to the wrong place.
// ============================================================================

describe('moderation actions on /api/v1/admin/users/:id', () => {
  it('suspends a user, revokes their sessions and files a sanction', async () => {
    const owner = await createTestUser({ role: 'owner' })
    const target = await createTestUser({ role: 'user' })
    await loginAs(target)
    const cookie = await loginAs(owner)

    const response = await api('POST', `/api/v1/admin/users/${target.id}/suspend`, {
      cookie,
      body: { reason: 'spamming links', durationHours: 48 },
    })
    expect(response.status).toBe(200)

    const row = await statusOf(target.id)
    expect(row?.status).toBe('suspended')
    expect(row?.status_reason).toBe('spamming links')
    expect(row?.suspended_permanently).toBe(0)
    expect(row?.suspended_until ?? 0).toBeGreaterThan(Date.now())

    // Suspending must also kill the sessions the target already held, or the
    // sanction is cosmetic until the cookie happens to expire on its own.
    expect(
      await countRows(
        'SELECT count(*) AS total FROM sessions WHERE user_id = ? AND revoked_at IS NULL',
        target.id,
      ),
    ).toBe(0)

    expect(
      await countRows(
        "SELECT count(*) AS total FROM sanctions WHERE user_id = ? AND type = 'suspend'",
        target.id,
      ),
    ).toBe(1)
    expect(
      await countRows("SELECT count(*) AS total FROM audit_logs WHERE action = 'user.suspend'"),
    ).toBe(1)
  })

  it('marks the suspension permanent when `permanent` is set', async () => {
    const owner = await createTestUser({ role: 'owner' })
    const target = await createTestUser({ role: 'user' })
    const cookie = await loginAs(owner)

    const response = await api('POST', `/api/v1/admin/users/${target.id}/suspend`, {
      cookie,
      body: { reason: 'repeat offender', permanent: true },
    })
    expect(response.status).toBe(200)

    const row = await statusOf(target.id)
    expect(row?.status).toBe('suspended')
    // A permanent suspension has no end date, only the flag.
    expect(row?.suspended_permanently).toBe(1)
    expect(row?.suspended_until).toBeNull()
  })

  it('refuses to let a moderator sanction a more senior account', async () => {
    const moderator = await createTestUser({ role: 'moderator' })
    const admin = await createTestUser({ role: 'admin' })
    const cookie = await loginAs(moderator)

    // The moderator DOES hold `users.sanction`; it is the rank rule that stops
    // this, which is exactly the layer a capability-only check would miss.
    const response = await api('POST', `/api/v1/admin/users/${admin.id}/ban`, {
      cookie,
      body: { reason: 'outranked on purpose' },
    })

    expect(response.status).toBe(403)
    expect((response.body as ErrorEnvelope).error.code).toBe('FORBIDDEN')
    expect((await statusOf(admin.id))?.status).toBe('active')
  })

  it('refuses to let anyone moderate their own account', async () => {
    const owner = await createTestUser({ role: 'owner' })
    const cookie = await loginAs(owner)

    const response = await api('POST', `/api/v1/admin/users/${owner.id}/suspend`, {
      cookie,
      body: { reason: 'testing self moderation' },
    })

    expect(response.status).toBe(403)
    expect((await statusOf(owner.id))?.status).toBe('active')
  })

  it('soft-deletes the account so history referencing it survives', async () => {
    const owner = await createTestUser({ role: 'owner' })
    const target = await createTestUser({ role: 'user' })
    const cookie = await loginAs(owner)

    // DELETE has no body convention, so the reason travels as a query param.
    const missingReason = await api('DELETE', `/api/v1/admin/users/${target.id}`, { cookie })
    expect(missingReason.status).toBe(400)

    const response = await api(
      'DELETE',
      `/api/v1/admin/users/${target.id}?reason=${encodeURIComponent('account deletion request')}`,
      { cookie },
    )
    expect(response.status).toBe(200)

    const row = await statusOf(target.id)
    expect(row?.status).toBe('deleted')
    expect(row?.deleted_at ?? 0).toBeGreaterThan(0)
    // Soft, not hard: the row stays so the audit trail still has a target.
    expect(await countRows('SELECT count(*) AS total FROM users WHERE id = ?', target.id)).toBe(1)
  })

  it('restores a suspended account on reactivate', async () => {
    const owner = await createTestUser({ role: 'owner' })
    const target = await createTestUser({ role: 'user' })
    const cookie = await loginAs(owner)

    await api('POST', `/api/v1/admin/users/${target.id}/suspend`, {
      cookie,
      body: { reason: 'cooling off period', durationHours: 1 },
    })
    expect((await statusOf(target.id))?.status).toBe('suspended')

    const response = await api('POST', `/api/v1/admin/users/${target.id}/reactivate`, {
      cookie,
      body: { reason: 'appeal upheld' },
    })
    expect(response.status).toBe(200)

    const row = await statusOf(target.id)
    expect(row?.status).toBe('active')
    expect(row?.status_reason).toBeNull()
    expect(row?.suspended_until).toBeNull()
  })
})

