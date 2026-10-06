import { beforeEach, describe, expect, it } from 'vitest'
import { env } from 'cloudflare:workers'
import { MAX_BIO_LENGTH, MAX_DISPLAY_NAME_LENGTH, MAX_LOCATION_LENGTH, MAX_PRONOUNS_LENGTH } from '../src/lib/constants'
import { ulid } from '../src/lib/ids'
import { mediaUrlFor } from '../src/lib/media'
import { standaloneEntry } from '../src/services/audit.service'
import { updateOwnProfile } from '../src/services/user.service'
import type { ApiUser, Auditor, AuthUser } from '../src/types'
import {
  TEST_PASSWORD,
  api,
  createTestUser,
  impersonatedCookieFor,
  loginAs,
  resetIsolateCaches,
  type Envelope,
  type ErrorEnvelope,
} from './helpers'

// ============================================================================
// PATCH /api/v1/auth/me — the caller's own profile (R1.1).
//
// The one write surface every signed-in account holds, whatever its role, which
// is why most of this file is about refusals rather than about the happy path.
// A role, an email address, an unknown key, a reserved username, a username
// somebody else already holds, an impersonated session, a suspended account:
// each has a test because each is a way this endpoint could quietly become an
// escalation route.
// ============================================================================

beforeEach(() => {
  resetIsolateCaches()
})

interface AuditRow {
  target_type: string | null
  target_id: string | null
  actor_user_id: string | null
  impersonated_by: string | null
  status: string
  before: string | null
  after: string | null
}

function errorOf(response: { body: unknown }): ErrorEnvelope {
  return response.body as ErrorEnvelope
}

function testAuditor(): Auditor {
  const entries: Auditor['entries'][number][] = []
  return {
    get handled() { return entries.length > 0 },
    get entries() { return entries },
    claim(draft) {
      const entry = standaloneEntry(draft, 'profile-test-request')
      entries.push(entry)
      return entry
    },
  }
}

/** Every `user.profile_update` row, oldest first. */
async function profileAudits(): Promise<AuditRow[]> {
  const { results } = await env.DB.prepare(
    `SELECT target_type, target_id, actor_user_id, impersonated_by, status, before, after
       FROM audit_logs WHERE action = 'user.profile_update' ORDER BY created_at ASC, id ASC`,
  ).all<AuditRow>()
  return results
}

/** 7 + 12 characters: comfortably inside `usernameSchema`'s 3–32 window. */
function freshUsername(prefix = 'renamed'): string {
  return `${prefix}${ulid().toLowerCase().slice(0, 12)}`
}

function updateProfile(cookie: string, body: unknown) {
  return api<Envelope<{ user: ApiUser }>>('PATCH', '/api/v1/auth/me', { cookie, body })
}

describe('PATCH /api/v1/auth/me', () => {
  it('requires a session', async () => {
    const response = await api('PATCH', '/api/v1/auth/me', { body: { displayName: 'Nobody' } })
    expect(response.status).toBe(401)
    expect(errorOf(response).error.code).toBe('UNAUTHENTICATED')
  })

  it('updates display name, bio and username, and logs exactly one audit row', async () => {
    const user = await createTestUser()
    const cookie = await loginAs(user)
    const nextUsername = freshUsername()

    const response = await updateProfile(cookie, {
      // Deliberately messy input: the collapsed inner space, the padding and the
      // upper-cased username are all the client's problem, not the database's.
      displayName: '  Ada   Lovelace ',
      bio: '  Links, but tidier.  ',
      username: nextUsername.toUpperCase(),
    })

    expect(response.status).toBe(200)
    expect(response.body.data.user.displayName).toBe('Ada Lovelace')
    expect(response.body.data.user.bio).toBe('Links, but tidier.')
    expect(response.body.data.user.username).toBe(nextUsername)

    const row = await env.DB.prepare('SELECT username, display_name, bio FROM users WHERE id = ?')
      .bind(user.id)
      .first<{ username: string; display_name: string | null; bio: string | null }>()
    expect(row?.username).toBe(nextUsername)
    expect(row?.display_name).toBe('Ada Lovelace')
    expect(row?.bio).toBe('Links, but tidier.')

    // The write response is the same DTO `GET /me` returns, minus the three
    // fields that describe the session rather than the account — that is what
    // lets the SPA replace its session user wholesale instead of merging.
    const read = await api<Envelope<{ user: AuthUser }>>('GET', '/api/v1/auth/me', { cookie })
    const sessionFields = ['impersonatedBy', 'sessionExpiresAt', 'sessionId']
    expect(
      Object.keys(read.body.data.user)
        .filter((key) => !sessionFields.includes(key))
        .sort(),
    ).toEqual(Object.keys(response.body.data.user).sort())

    const audits = await profileAudits()
    expect(audits).toHaveLength(1)
    const [entry] = audits
    expect(entry?.target_type).toBe('user')
    expect(entry?.target_id).toBe(user.id)
    expect(entry?.actor_user_id).toBe(user.id)
    expect(entry?.impersonated_by).toBeNull()
    expect(entry?.status).toBe('success')

    // `before`/`after` name ONLY the fields this request touched: a profile row
    // is a log entry a human reads, not a dump of the account.
    expect(JSON.parse(entry?.after ?? '{}')).toEqual({
      displayName: 'Ada Lovelace',
      bio: 'Links, but tidier.',
      username: nextUsername,
    })
    expect(JSON.parse(entry?.before ?? '{}')).toEqual({
      displayName: user.username,
      bio: null,
      username: user.username,
    })
  })

  it('refuses to overwrite a profile field changed in another session', async () => {
    const user = await createTestUser()
    const cookie = await loginAs(user)

    const first = await updateProfile(cookie, {
      displayName: 'Current name',
      expected: { displayName: user.username },
    })
    expect(first.status).toBe(200)

    const stale = await updateProfile(cookie, {
      displayName: 'Stale name',
      expected: { displayName: user.username },
    })
    expect(stale.status).toBe(409)
    expect(errorOf(stale).error.code).toBe('CONFLICT')

    const stored = await env.DB.prepare('SELECT display_name FROM users WHERE id = ?')
      .bind(user.id)
      .first<{ display_name: string | null }>()
    expect(stored?.display_name).toBe('Current name')
    expect(await profileAudits()).toHaveLength(1)
  })

  it('checks profile preconditions in the atomic write when a concurrent edit races', async () => {
    const user = await createTestUser()
    let interleaved = false
    const racedDb = new Proxy(env.DB, {
      get(target, key) {
        if (key === 'batch') return async (statements: D1PreparedStatement[]) => {
          if (!interleaved) {
            interleaved = true
            await env.DB.prepare('UPDATE users SET display_name = ? WHERE id = ?')
              .bind('Concurrent name', user.id)
              .run()
          }
          return target.batch(statements)
        }
        const value = Reflect.get(target, key)
        return typeof value === 'function' ? value.bind(target) : value
      },
    })

    await expect(updateOwnProfile(
      racedDb,
      { id: user.id, role: user.role, label: user.username },
      { displayName: 'Stale name', expected: { displayName: user.username } },
      testAuditor(),
    )).rejects.toMatchObject({ status: 409 })

    const stored = await env.DB.prepare('SELECT display_name FROM users WHERE id = ?')
      .bind(user.id)
      .first<{ display_name: string | null }>()
    expect(stored?.display_name).toBe('Concurrent name')
    expect((await profileAudits()).filter((entry) => entry.target_id === user.id)).toHaveLength(0)
  })

  it('writes a delta: a field the request omits is a field it does not touch', async () => {
    const user = await createTestUser()
    const cookie = await loginAs(user)

    // Seeded row: `createTestUser` sets `display_name` to the username and
    // leaves `bio` NULL, so the omissions below are visible in the row itself.
    expect((await updateProfile(cookie, { displayName: 'Ada Lovelace' })).status).toBe(200)
    const second = await updateProfile(cookie, { bio: 'Second bio.' })

    expect(second.status).toBe(200)
    expect(second.body.data.user.displayName).toBe('Ada Lovelace')
    expect(second.body.data.user.username).toBe(user.username)

    const audits = await profileAudits()
    expect(audits).toHaveLength(2)
    expect(JSON.parse(audits[1]?.after ?? '{}')).toEqual({ bio: 'Second bio.' })
    expect(JSON.parse(audits[1]?.before ?? '{}')).toEqual({ bio: null })
  })

  it('clears the bio with either `null` or an empty string', async () => {
    const user = await createTestUser()
    const cookie = await loginAs(user)

    for (const cleared of [null, '']) {
      await updateProfile(cookie, { bio: 'Something to clear.' })
      const response = await updateProfile(cookie, { bio: cleared })

      expect(response.status).toBe(200)
      expect(response.body.data.user.bio).toBeNull()
    }
  })

  it('writes location and pronouns, and clears either the same way (R1.2)', async () => {
    const user = await createTestUser()
    const cookie = await loginAs(user)

    // Messy on purpose: the two spaces are collapsed by `sanitizeSingleLine`, which
    // is the pass a single-line field gets and `bio` (`sanitizeMultiline`) does not.
    const filled = await updateProfile(cookie, {
      location: '  Berlin   DE ',
      pronouns: ' she/her ',
    })

    expect(filled.status).toBe(200)
    expect(filled.body.data.user.location).toBe('Berlin DE')
    expect(filled.body.data.user.pronouns).toBe('she/her')

    // "Clear it" is spelled two ways on this surface, and a column that is not
    // `bio` has to honour both — otherwise an emptied input stores `""`.
    for (const cleared of [null, '']) {
      await updateProfile(cookie, { pronouns: 'Something to clear.' })
      const response = await updateProfile(cookie, { pronouns: cleared })

      expect(response.status).toBe(200)
      expect(response.body.data.user.pronouns).toBeNull()
    }

    const row = await env.DB.prepare('SELECT location, pronouns FROM users WHERE id = ?')
      .bind(user.id)
      .first<{ location: string | null; pronouns: string | null }>()
    expect(row).toEqual({ location: 'Berlin DE', pronouns: null })

    // The log names the two fields this request touched and nothing else.
    const audits = await profileAudits()
    expect(JSON.parse(audits[0]?.after ?? '{}')).toEqual({
      location: 'Berlin DE',
      pronouns: 'she/her',
    })
    expect(JSON.parse(audits[0]?.before ?? '{}')).toEqual({ location: null, pronouns: null })
  })

  it('stores a location that sanitises away to nothing as NULL, not "" (R1.2)', async () => {
    const user = await createTestUser()
    const cookie = await loginAs(user)

    // `"\u0007"` survives `trim()` and is inside the cap, so zod accepts it — the
    // service is what has to turn the emptied result into NULL. Unlike the display
    // name this is not an error: "no location" is a state the column holds.
    const response = await updateProfile(cookie, { location: '\u0007' })
    expect(response.status).toBe(200)
    expect(response.body.data.user.location).toBeNull()

    const row = await env.DB.prepare('SELECT location FROM users WHERE id = ?')
      .bind(user.id)
      .first<{ location: string | null }>()
    expect(row?.location).toBeNull()
  })

  it('bounds location at 100 and pronouns at 40, on write only (R1.2)', async () => {
    const user = await createTestUser()
    const cookie = await loginAs(user)

    const atCap = await updateProfile(cookie, {
      location: 'L'.repeat(MAX_LOCATION_LENGTH),
      pronouns: 'P'.repeat(MAX_PRONOUNS_LENGTH),
    })
    expect(atCap.status).toBe(200)
    expect(atCap.body.data.user.location).toHaveLength(MAX_LOCATION_LENGTH)
    expect(atCap.body.data.user.pronouns).toHaveLength(MAX_PRONOUNS_LENGTH)

    for (const body of [
      { location: 'L'.repeat(MAX_LOCATION_LENGTH + 1) },
      { pronouns: 'P'.repeat(MAX_PRONOUNS_LENGTH + 1) },
    ]) {
      expect((await updateProfile(cookie, body)).status).toBe(422)
    }

    // Refused, not truncated: the row still holds exactly what fitted.
    const row = await env.DB.prepare('SELECT location, pronouns FROM users WHERE id = ?')
      .bind(user.id)
      .first<{ location: string | null; pronouns: string | null }>()
    expect(row?.location).toHaveLength(MAX_LOCATION_LENGTH)
    expect(row?.pronouns).toHaveLength(MAX_PRONOUNS_LENGTH)
  })

  it('enforces the 50/160 caps on write, and only on write (D12)', async () => {
    const user = await createTestUser()
    const cookie = await loginAs(user)

    const atCap = await updateProfile(cookie, {
      displayName: 'D'.repeat(MAX_DISPLAY_NAME_LENGTH),
      bio: 'b'.repeat(MAX_BIO_LENGTH),
    })
    expect(atCap.status).toBe(200)
    expect(atCap.body.data.user.displayName).toHaveLength(MAX_DISPLAY_NAME_LENGTH)

    for (const body of [
      { displayName: 'D'.repeat(MAX_DISPLAY_NAME_LENGTH + 1) },
      { bio: 'b'.repeat(MAX_BIO_LENGTH + 1) },
    ]) {
      expect((await updateProfile(cookie, body)).status).toBe(422)
    }

    // Nothing over-long reached the row: the caps are enforced, not truncated.
    const row = await env.DB.prepare('SELECT display_name, bio FROM users WHERE id = ?')
      .bind(user.id)
      .first<{ display_name: string | null; bio: string | null }>()
    expect(row?.display_name).toHaveLength(MAX_DISPLAY_NAME_LENGTH)
    expect(row?.bio).toHaveLength(MAX_BIO_LENGTH)
  })

  it('refuses a display name that sanitises away to nothing', async () => {
    const user = await createTestUser()
    const cookie = await loginAs(user)

    // `"\u0007"` survives `trim()` — it is a control character, not whitespace —
    // so zod accepts it (length 1) and the *service* is what has to refuse it,
    // rather than saving an account with no name at all.
    const response = await updateProfile(cookie, { displayName: '\u0007' })
    expect(response.status).toBe(400)
    expect(errorOf(response).error.code).toBe('BAD_REQUEST')
  })

  it('refuses every field a signed-in account must not be able to write', async () => {
    const user = await createTestUser()
    const cookie = await loginAs(user)

    // `strictObject` + the "at least one field" refine: a typo and a privilege
    // escalation are refused the same way, before any service code runs.
    const refused: Record<string, unknown>[] = [
      {},
      { role: 'admin' },
      { email: 'someone-else@example.com' },
      { status: 'active' },
      { password: 'a-brand-new-password-1' },
      { deletedAt: null },
      { displayName: '   ' },
    ]

    for (const body of refused) {
      const response = await updateProfile(cookie, body)
      expect(response.status).toBe(422)
      expect(errorOf(response).error.code).toBe('VALIDATION_ERROR')
    }

    // The refusals did not half-apply on the way past.
    const row = await env.DB.prepare('SELECT role, email, status FROM users WHERE id = ?')
      .bind(user.id)
      .first<{ role: string; email: string; status: string }>()
    expect(row).toEqual({ role: 'user', email: user.email, status: 'active' })
    expect(await profileAudits()).toHaveLength(0)
  })

  it('refuses a reserved username, and one another account already holds', async () => {
    const user = await createTestUser()
    const cookie = await loginAs(user)
    const stranger = await createTestUser()

    const reserved = await updateProfile(cookie, { username: 'owner' })
    expect(reserved.status).toBe(400)
    expect(errorOf(reserved).error.message).toMatch(/reserved/i)

    const taken = await updateProfile(cookie, { username: stranger.username })
    expect(taken.status).toBe(409)
    expect(errorOf(taken).error.code).toBe('CONFLICT')

    // Both refusals leave the account holding the name it started with.
    const row = await env.DB.prepare('SELECT username FROM users WHERE id = ?')
      .bind(user.id)
      .first<{ username: string }>()
    expect(row?.username).toBe(user.username)
  })

  it('treats a rename to your own name as a no-op, with no audit row', async () => {
    const user = await createTestUser()
    const cookie = await loginAs(user)

    // Same name, different case: normalisation is what decides this is not a
    // rename, so nothing is written and the log stays clean.
    const response = await updateProfile(cookie, { username: user.username.toUpperCase() })

    expect(response.status).toBe(200)
    expect(response.body.data.user.username).toBe(user.username)
    expect(await profileAudits()).toHaveLength(0)
  })

  it('refuses a suspended account, which can still read its own record', async () => {
    const user = await createTestUser({ role: 'user' })
    const cookie = await loginAs(user)

    await env.DB.prepare(
      `UPDATE users SET status = 'suspended', suspended_until = ?, status_reason = 'paused'
        WHERE id = ?`,
    )
      .bind(Date.now() + 3_600_000, user.id)
      .run()

    const blocked = await updateProfile(cookie, { displayName: 'Ada' })
    expect(blocked.status).toBe(403)
    expect(errorOf(blocked).error.code).toBe('ACCOUNT_DISABLED')

    // READ stays open: a suspended account has to be able to see *why* it is
    // suspended, which is the whole reason the two routes differ on this guard.
    expect((await api('GET', '/api/v1/auth/me', { cookie })).status).toBe(200)
  })

  it('refuses a profile write from an impersonated session', async () => {
    // The reason `requireOwnerSelf` moved into `middleware/auth.ts` as
    // `requireUnimpersonated`: support must not be able to rewrite the identity
    // of the account it is looking at.
    const cookie = await impersonatedCookieFor('profile-imp-target', TEST_PASSWORD)

    const blocked = await updateProfile(cookie, { displayName: 'Ada' })
    expect(blocked.status).toBe(403)
    expect(errorOf(blocked).error.code).toBe('FORBIDDEN')
    expect(errorOf(blocked).error.message).toMatch(/read-only/i)

    expect((await api('GET', '/api/v1/auth/me', { cookie })).status).toBe(200)
    expect(await profileAudits()).toHaveLength(0)
  })

  it('postpones the edit until an outstanding password change is done', async () => {
    const user = await createTestUser({ requirePasswordChange: true })
    const cookie = await loginAs(user)

    const blocked = await updateProfile(cookie, { displayName: 'Ada' })
    expect(blocked.status).toBe(403)
    expect(errorOf(blocked).error.code).toBe('MUST_CHANGE_PASSWORD')
  })

  it('429s the profile form once the seeded allowance is spent', async () => {
    const user = await createTestUser()
    const cookie = await loginAs(user)
    const other = await createTestUser()
    const otherCookie = await loginAs(other)

    // `profile_write_user`: 60 per hour, `block`
    // (seed/0001_platform-defaults.sql). Every one of these is a real write, so
    // this also proves the limit does not sit in front of a request it then
    // fails to serve.
    for (let write = 0; write < 60; write++) {
      expect((await updateProfile(cookie, { displayName: 'Ada' })).status).toBe(200)
    }

    const blocked = await updateProfile(cookie, { displayName: 'Ada' })
    expect(blocked.status).toBe(429)
    expect(errorOf(blocked).error.code).toBe('RATE_LIMITED')
    expect(blocked.headers.get('retry-after')).toBeTruthy()
    expect(blocked.headers.get('x-ratelimit-limit')).toBe('60')
    expect(blocked.headers.get('x-ratelimit-remaining')).toBe('0')

    // Counters are per actor as well as per rule: one abusive form must not
    // exhaust anybody else's allowance.
    expect((await updateProfile(otherCookie, { displayName: 'Ada' })).status).toBe(200)
  })
})

// ============================================================================
// The same endpoint, one field at a time: `avatarKey` (R1.3).
//
// `media.api.spec.ts` owns the upload/delete side and the ownership check that
// needs a row in `media_assets`. What is left for this file is the part of the
// field that is pure write-path: the SHAPE (refused before any query) and the
// `undefined` vs `null` distinction ("not in this body" vs "clear it"), which a
// test that always sends a key can never see.
// ============================================================================

describe('PATCH /api/v1/auth/me { avatarKey } (R1.3)', () => {
  /** A key shaped exactly like the ones `POST /api/v1/media` mints. */
  function avatarKeyFor(ownerId: string): string {
    return `avatars/${ownerId}/${ulid()}.webp`
  }

  it('refuses a key that is not shaped like one this API mints', async () => {
    const user = await createTestUser()
    const cookie = await loginAs(user)

    // `avatarKeySchema` (`validation/profile.schema.ts`) is the only thing that has
    // to reject this: `nyancat.gif` cannot be an avatar anywhere, whatever the
    // database happens to hold, and a shape check is free where a query is not.
    const response = await updateProfile(cookie, { avatarKey: 'nyancat.gif' })

    expect(response.status).toBe(422)
    expect(errorOf(response).error.code).toBe('VALIDATION_ERROR')

    const row = await env.DB.prepare('SELECT avatar_key FROM users WHERE id = ?')
      .bind(user.id)
      .first<{ avatar_key: string | null }>()
    expect(row?.avatar_key).toBeNull()
    expect(await profileAudits()).toHaveLength(0)
  })

  it('leaves the avatar alone when the body does not mention it', async () => {
    // The distinction the whole field rides on: `undefined` means "not in this
    // request", `null` means "clear it" — so a rename must not silently unset an
    // avatar, and the request must not have to re-send a key it does not change.
    // Seeded with SQL on purpose: this file is about the write path, and putting a
    // key here for real is `media.api.spec.ts`'s job.
    const user = await createTestUser()
    const cookie = await loginAs(user)
    const key = avatarKeyFor(user.id)
    await env.DB.prepare('UPDATE users SET avatar_key = ? WHERE id = ?').bind(key, user.id).run()

    const response = await updateProfile(cookie, { bio: 'Still here.' })

    expect(response.status).toBe(200)
    expect(response.body.data.user.avatarKey).toBe(key)
    // Derived from the key on the way out, never stored: one field to read, no
    // client ever has to know how a media URL is shaped.
    expect(response.body.data.user.avatarUrl).toBe(mediaUrlFor(key))

    // ...and the audit names the field the request actually changed.
    const audits = await profileAudits()
    expect(JSON.parse(audits[0]?.after ?? '{}')).toEqual({ bio: 'Still here.' })
  })
})
