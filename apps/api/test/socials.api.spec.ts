import { beforeEach, describe, expect, it } from 'vitest'
import { env } from 'cloudflare:workers'
import { MAX_SOCIAL_LINKS_PER_USER } from '../src/lib/constants'
import { ulid } from '../src/lib/ids'
import type { UserSocialLinkRow } from '../src/types'
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
// /api/v1/profile/socials — the caller's social links (R1.2).
//
// The resource half of the profile API, and the first surface in the codebase
// whose rows belong to a USER rather than to a page. Most of what is asserted here
// follows from that: a foreign id must be a 404 and not a 403 (nothing may confirm
// that somebody else's row exists), a listing may only ever contain the caller's
// own rows, and the write budget is the one `PATCH /auth/me` spends on too.
//
// The identity half of R1.2 — `location` and `pronouns` — is asserted in
// `profile.api.spec.ts`, because those are columns on `users` behind that route.
// ============================================================================

beforeEach(() => {
  resetIsolateCaches()
})

interface SocialLink {
  id: string
  platform: string
  url: string
  position: number
  isVisible: boolean
  createdAt: number
  updatedAt: number
}

/** The DTO key set, spelled out so a leaked column fails here rather than reads oddly. */
const SOCIAL_KEYS = ['createdAt', 'id', 'isVisible', 'platform', 'position', 'updatedAt', 'url']

const SOCIALS = '/api/v1/profile/socials'

function errorOf(response: { body: unknown }): ErrorEnvelope {
  return response.body as ErrorEnvelope
}

function listSocials(cookie: string) {
  return api<Envelope<{ socials: SocialLink[] }>>('GET', SOCIALS, { cookie })
}

function createSocial(cookie: string, body: unknown) {
  return api<Envelope<SocialLink>>('POST', SOCIALS, { cookie, body })
}

function updateSocial(cookie: string, id: string, body: unknown) {
  return api<Envelope<SocialLink>>('PATCH', `${SOCIALS}/${id}`, { cookie, body })
}

function deleteSocial(cookie: string, id: string) {
  return api('DELETE', `${SOCIALS}/${id}`, { cookie })
}

function reorderSocials(cookie: string, socialIds: string[]) {
  return api<Envelope<{ socials: SocialLink[] }>>('PUT', `${SOCIALS}/order`, {
    cookie,
    body: { socialIds },
  })
}

/** Every stored row for this user, in slot order, straight from the table. */
async function socialRows(userId: string): Promise<UserSocialLinkRow[]> {
  const { results } = await env.DB.prepare(
    'SELECT * FROM user_social_links WHERE user_id = ? ORDER BY position ASC',
  )
    .bind(userId)
    .all<UserSocialLinkRow>()
  return results
}

interface AuditRow {
  action: string
  target_type: string | null
  target_id: string | null
  actor_user_id: string | null
  status: string
  before: string | null
  after: string | null
}

async function socialAudits(): Promise<AuditRow[]> {
  const { results } = await env.DB.prepare(
    `SELECT action, target_type, target_id, actor_user_id, status, before, after
       FROM audit_logs WHERE action LIKE 'profile.social%' ORDER BY created_at ASC, id ASC`,
  ).all<AuditRow>()
  return results
}

describe('POST /api/v1/profile/socials', () => {
  it('appends a social link, normalising the platform and the URL, and logs one audit row', async () => {
    const user = await createTestUser()
    const cookie = await loginAs(user)

    // Messy on purpose: the platform in the case a human types and the URL with the
    // padding a paste carries. Both are the client's problem, not the database's —
    // and neither is ambiguous, so neither is refused.
    const created = await createSocial(cookie, {
      platform: '  GitHub ',
      url: '  https://github.com/ada  ',
    })

    expect(created.status).toBe(201)
    expect(created.body.data.platform).toBe('github')
    expect(created.body.data.url).toBe('https://github.com/ada')
    expect(created.body.data.position).toBe(0)
    expect(created.body.data.isVisible).toBe(true)
    expect(Object.keys(created.body.data).sort()).toEqual(SOCIAL_KEYS)

    const row = await env.DB.prepare('SELECT * FROM user_social_links WHERE id = ?')
      .bind(created.body.data.id)
      .first<UserSocialLinkRow>()
    expect(row?.user_id).toBe(user.id)
    expect(row?.is_visible).toBe(1)
    expect(row?.position).toBe(0)
    // `user_id` is the one column the DTO drops and the one the INSERT must still set.
    expect(created.body.data).not.toHaveProperty('userId')

    const audits = await socialAudits()
    expect(audits).toHaveLength(1)
    const [entry] = audits
    expect(entry?.action).toBe('profile.social.create')
    expect(entry?.target_type).toBe('user')
    expect(entry?.target_id).toBe(user.id)
    expect(entry?.actor_user_id).toBe(user.id)
    expect(entry?.status).toBe('success')
    expect(JSON.parse(entry?.after ?? '{}')).toEqual({
      platform: 'github',
      url: 'https://github.com/ada',
      isVisible: true,
    })
  })

  it('honours an explicit `isVisible: false`, and keeps the link in the owner list', async () => {
    const user = await createTestUser()
    const cookie = await loginAs(user)

    const created = await createSocial(cookie, {
      platform: 'mastodon',
      url: 'https://mastodon.social/@ada',
      isVisible: false,
    })

    expect(created.status).toBe(201)
    expect(created.body.data.isVisible).toBe(false)

    // Hidden is for the PUBLIC render (R1.7), not for the owner's own editor: a
    // listing that filtered here would leave the row uneditable.
    const listed = await listSocials(cookie)
    expect(listed.body.data.socials.map((social) => social.id)).toEqual([created.body.data.id])
  })

  it('appends above the highest slot, so a deleted slot is never reused by accident', async () => {
    const user = await createTestUser()
    const cookie = await loginAs(user)

    const first = await createSocial(cookie, { platform: 'github', url: 'https://github.com/ada' })
    const second = await createSocial(cookie, { platform: 'x', url: 'https://x.com/ada' })
    const third = await createSocial(cookie, { platform: 'bluesky', url: 'https://bsky.app/ada' })
    expect([first, second, third].map((r) => r.body.data.position)).toEqual([0, 1, 2])

    expect((await deleteSocial(cookie, second.body.data.id)).status).toBe(204)

    const fourth = await createSocial(cookie, {
      platform: 'youtube',
      url: 'https://youtube.com/@ada',
    })
    expect(fourth.status).toBe(201)
    // 3, not 1: the hole the delete left stays a hole until a reorder closes it, so
    // "a new social is last" holds whatever has been removed in the meantime.
    expect(fourth.body.data.position).toBe(3)
    expect((await socialRows(user.id)).map((row) => row.position)).toEqual([0, 2, 3])
  })

  it('refuses an unknown platform (422) and anything that is not an http(s) URL (400)', async () => {
    const user = await createTestUser()
    const cookie = await loginAs(user)

    // Shape problems: the body named something outside the contract. Zod answers
    // these, so no service code ever runs.
    for (const body of [
      // Not on `SOCIAL_PLATFORMS` — `instagram` is, which is why this is `myspace`.
      { platform: 'myspace', url: 'https://myspace.com/ada' },
      { platform: '', url: 'https://example.com' },
      // `position` is the order route's business, not the create body's.
      { platform: 'github', url: 'https://github.com/ada', position: 5 },
      {},
      { platform: 'github' },
    ]) {
      const refused = await createSocial(cookie, body)
      expect(refused.status).toBe(422)
      expect(errorOf(refused).error.code).toBe('VALIDATION_ERROR')
    }

    // Content problems: the platform is fine, the URL is not a place a browser can
    // be sent. `javascript:` is the one that matters — stored verbatim it becomes a
    // script in an href on a public page.
    for (const url of ['javascript:alert(1)', 'not a url', 'ftp://example.com/ada', 'https://']) {
      const refused = await createSocial(cookie, { platform: 'github', url })
      expect(refused.status).toBe(400)
      expect(errorOf(refused).error.code).toBe('BAD_REQUEST')
    }

    // Nothing above half-applied, and nothing was logged as if it had.
    expect(await socialRows(user.id)).toHaveLength(0)
    expect(await socialAudits()).toHaveLength(0)
  })

  it('strips credentials from a URL rather than storing them', async () => {
    const user = await createTestUser()
    const cookie = await loginAs(user)

    // `normalizeUrl` (R1.0, shared with page links) drops the userinfo: a social URL
    // is rendered into an href, and a stored password in one is a leaked password.
    const created = await createSocial(cookie, {
      platform: 'github',
      url: 'https://ada:hunter2@github.com/ada',
    })

    expect(created.status).toBe(201)
    expect(created.body.data.url).toBe('https://github.com/ada')
  })

  it('caps the profile at 20 socials', async () => {
    const user = await createTestUser()
    const cookie = await loginAs(user)

    for (let index = 0; index < MAX_SOCIAL_LINKS_PER_USER; index++) {
      const created = await createSocial(cookie, {
        platform: 'github',
        url: `https://github.com/ada/${index}`,
      })
      expect(created.status).toBe(201)
    }

    const refused = await createSocial(cookie, {
      platform: 'github',
      url: 'https://github.com/one-too-many',
    })
    expect(refused.status).toBe(400)
    expect(errorOf(refused).error.code).toBe('BAD_REQUEST')
    expect(errorOf(refused).error.message).toContain(String(MAX_SOCIAL_LINKS_PER_USER))
    expect(await socialRows(user.id)).toHaveLength(MAX_SOCIAL_LINKS_PER_USER)
  })
})

describe('GET /api/v1/profile/socials', () => {
  it('lists only the caller rows, in slot order', async () => {
    const ada = await createTestUser()
    const grace = await createTestUser()
    const adaCookie = await loginAs(ada)
    const graceCookie = await loginAs(grace)

    const second = await createSocial(adaCookie, { platform: 'x', url: 'https://x.com/ada' })
    const first = await createSocial(adaCookie, { platform: 'github', url: 'https://github.com/ada' })
    await createSocial(graceCookie, { platform: 'github', url: 'https://github.com/grace' })

    // Two inserts already sit in slots [0, 1], so what this really pins down is that
    // the client is shown `ORDER BY position` — the order the owner chose — and that
    // someone else's row is nowhere near it.
    const listed = await listSocials(adaCookie)
    expect(listed.status).toBe(200)
    expect(listed.body.data.socials.map((social) => social.id)).toEqual([
      second.body.data.id,
      first.body.data.id,
    ])

    const graceList = await listSocials(graceCookie)
    expect(graceList.body.data.socials).toHaveLength(1)

    expect(await socialRows(ada.id)).toHaveLength(2)
  })

  it('answers an anonymous caller with 401', async () => {
    expect((await api('GET', SOCIALS)).status).toBe(401)
    expect((await updateSocial('', 'nope', { url: 'https://github.com/ada' })).status).toBe(401)
    expect((await deleteSocial('', 'nope')).status).toBe(401)
  })
})

describe('PATCH /api/v1/profile/socials/:id', () => {
  it('updates one field, leaves the rest alone, and logs before and after', async () => {
    const user = await createTestUser()
    const cookie = await loginAs(user)

    const created = await createSocial(cookie, {
      platform: 'github',
      url: 'https://github.com/ada',
      isVisible: false,
    })

    const updated = await updateSocial(cookie, created.body.data.id, {
      url: 'https://github.com/ada-lovelace',
    })

    expect(updated.status).toBe(200)
    expect(updated.body.data.url).toBe('https://github.com/ada-lovelace')
    // Untouched: a PATCH that reset these would silently unhide a hidden link.
    expect(updated.body.data.platform).toBe('github')
    expect(updated.body.data.isVisible).toBe(false)
    expect(updated.body.data.position).toBe(0)
    expect(updated.body.data.updatedAt).toBeGreaterThanOrEqual(created.body.data.updatedAt)
    expect(Object.keys(updated.body.data).sort()).toEqual(SOCIAL_KEYS)

    const audits = await socialAudits()
    expect(audits.map((entry) => entry.action)).toEqual([
      'profile.social.create',
      'profile.social.update',
    ])
    // A delta, not a restatement of the row: the log names the field that moved.
    expect(JSON.parse(audits[1]?.before ?? '{}')).toEqual({ url: 'https://github.com/ada' })
    expect(JSON.parse(audits[1]?.after ?? '{}')).toEqual({ url: 'https://github.com/ada-lovelace' })
  })

  it('sends ordering to the order route instead of honouring `position` here', async () => {
    const user = await createTestUser()
    const cookie = await loginAs(user)

    const created = await createSocial(cookie, { platform: 'github', url: 'https://github.com/ada' })

    // Not "ignored": a body carrying a slot this route cannot honour is refused, so a
    // client never walks away believing it reordered something.
    const refused = await updateSocial(cookie, created.body.data.id, { position: 4 })
    expect(refused.status).toBe(422)
    expect(errorOf(refused).error.code).toBe('VALIDATION_ERROR')

    // And an empty delta is a client bug, not a request to rewrite the row as-is.
    expect((await updateSocial(cookie, created.body.data.id, {})).status).toBe(422)
    expect(await socialRows(user.id)).toHaveLength(1)
    expect((await socialAudits()).map((entry) => entry.action)).toEqual(['profile.social.create'])
  })

  it('answers 404 — never 403 — for another account id, and writes nothing', async () => {
    const ada = await createTestUser()
    const grace = await createTestUser()
    const graceCookie = await loginAs(grace)

    const created = await createSocial(await loginAs(ada), {
      platform: 'github',
      url: 'https://github.com/ada',
    })

    const refused = await updateSocial(graceCookie, created.body.data.id, {
      url: 'https://github.com/hijacked',
    })

    // 404 and not 403: anything else would confirm to a stranger that the row exists.
    expect(refused.status).toBe(404)
    expect(errorOf(refused).error.code).toBe('NOT_FOUND')

    const rows = await socialRows(ada.id)
    expect(rows[0]?.url).toBe('https://github.com/ada')
    // A refused attempt is not an event on this row, so only the create is logged.
    expect((await socialAudits()).map((entry) => entry.action)).toEqual(['profile.social.create'])
  })

  it('answers 404 for an id that was never issued', async () => {
    const user = await createTestUser()
    const cookie = await loginAs(user)

    const refused = await updateSocial(cookie, ulid(), { url: 'https://github.com/ada' })
    expect(refused.status).toBe(404)
    expect(errorOf(refused).error.code).toBe('NOT_FOUND')
  })
})

describe('PUT /api/v1/profile/socials/order', () => {
  it('replaces the ordering and returns the list in the new order', async () => {
    const user = await createTestUser()
    const cookie = await loginAs(user)

    const first = await createSocial(cookie, { platform: 'github', url: 'https://github.com/ada' })
    const second = await createSocial(cookie, { platform: 'x', url: 'https://x.com/ada' })
    const third = await createSocial(cookie, { platform: 'bluesky', url: 'https://bsky.app/ada' })

    const reordered = await reorderSocials(cookie, [
      third.body.data.id,
      first.body.data.id,
      second.body.data.id,
    ])

    expect(reordered.status).toBe(200)
    expect(reordered.body.data.socials.map((social) => social.id)).toEqual([
      third.body.data.id,
      first.body.data.id,
      second.body.data.id,
    ])
    // Dense from 0 again, in the requested order — that is what "order" means here.
    expect(reordered.body.data.socials.map((social) => social.position)).toEqual([0, 1, 2])

    const audits = await socialAudits()
    const reorder = audits.at(-1)
    expect(reorder?.action).toBe('profile.socials.reorder')
    expect(reorder?.target_id).toBe(user.id)
    expect(JSON.parse(reorder?.after ?? '{}')).toEqual({
      order: [third.body.data.id, first.body.data.id, second.body.data.id],
    })
  })

  it('closes the gap a delete left behind', async () => {
    const user = await createTestUser()
    const cookie = await loginAs(user)

    const first = await createSocial(cookie, { platform: 'github', url: 'https://github.com/ada' })
    const second = await createSocial(cookie, { platform: 'x', url: 'https://x.com/ada' })
    const third = await createSocial(cookie, { platform: 'bluesky', url: 'https://bsky.app/ada' })
    expect((await deleteSocial(cookie, second.body.data.id)).status).toBe(204)

    // Slots 0 and 2 hold the survivors until a reorder asks for anything else.
    expect((await socialRows(user.id)).map((row) => row.position)).toEqual([0, 2])

    const reordered = await reorderSocials(cookie, [third.body.data.id, first.body.data.id])
    expect(reordered.status).toBe(200)
    expect(reordered.body.data.socials.map((social) => social.position)).toEqual([0, 1])
    expect((await socialRows(user.id)).map((row) => row.id)).toEqual([
      third.body.data.id,
      first.body.data.id,
    ])
  })

  it('refuses an ordering that is not exactly the caller rows', async () => {
    const user = await createTestUser()
    const cookie = await loginAs(user)

    const first = await createSocial(cookie, { platform: 'github', url: 'https://github.com/ada' })
    const second = await createSocial(cookie, { platform: 'x', url: 'https://x.com/ada' })

    for (const socialIds of [
      [first.body.data.id], // partial: the omitted row would fall out of the ordering
      [first.body.data.id, first.body.data.id], // repeated, into two slots at once
      [first.body.data.id, second.body.data.id, ulid()], // a row that is not ours
    ]) {
      const refused = await reorderSocials(cookie, socialIds)
      expect(refused.status).toBe(400)
      expect(errorOf(refused).error.code).toBe('BAD_REQUEST')
    }

    // An empty list is a shape problem — there is nothing to order — so zod answers.
    const empty = await reorderSocials(cookie, [])
    expect(empty.status).toBe(422)
    expect(errorOf(empty).error.code).toBe('VALIDATION_ERROR')

    // Nothing moved: a refused ordering never reached the table.
    expect((await socialRows(user.id)).map((row) => row.id)).toEqual([
      first.body.data.id,
      second.body.data.id,
    ])
    expect((await socialAudits()).map((entry) => entry.action)).toEqual([
      'profile.social.create',
      'profile.social.create',
    ])
  })
})

describe('DELETE /api/v1/profile/socials/:id', () => {
  it('removes the row and logs what was lost', async () => {
    const user = await createTestUser()
    const cookie = await loginAs(user)

    const created = await createSocial(cookie, { platform: 'github', url: 'https://github.com/ada' })

    const removed = await deleteSocial(cookie, created.body.data.id)
    expect(removed.status).toBe(204)
    expect(removed.body).toBeNull()
    expect(await socialRows(user.id)).toHaveLength(0)

    // A hard delete, so the `before` snapshot is the only record of what the row held.
    const entry = (await socialAudits()).at(-1)
    expect(entry?.action).toBe('profile.social.delete')
    expect(entry?.target_type).toBe('user')
    expect(entry?.target_id).toBe(user.id)
    expect(entry?.actor_user_id).toBe(user.id)
    expect(JSON.parse(entry?.before ?? '{}')).toEqual({
      platform: 'github',
      url: 'https://github.com/ada',
    })
  })

  it('answers 404 on a second delete, and on a foreign id', async () => {
    const ada = await createTestUser()
    const grace = await createTestUser()
    const adaCookie = await loginAs(ada)
    const graceCookie = await loginAs(grace)

    const created = await createSocial(adaCookie, {
      platform: 'github',
      url: 'https://github.com/ada',
    })

    // Not idempotent by design: the second call names a row that is already gone.
    expect((await deleteSocial(adaCookie, created.body.data.id)).status).toBe(204)
    expect((await deleteSocial(adaCookie, created.body.data.id)).status).toBe(404)

    const other = await createSocial(adaCookie, { platform: 'x', url: 'https://x.com/ada' })
    const refused = await deleteSocial(graceCookie, other.body.data.id)
    expect(refused.status).toBe(404)
    expect(errorOf(refused).error.code).toBe('NOT_FOUND')

    // The foreign attempt deleted nothing, and only the two real events are logged.
    expect((await socialRows(ada.id)).map((row) => row.id)).toEqual([other.body.data.id])
    expect((await socialAudits()).map((entry) => entry.action)).toEqual([
      'profile.social.create',
      'profile.social.delete',
      'profile.social.create',
    ])
  })
})

describe('access control', () => {
  it('lets an impersonated session read the profile but never write it', async () => {
    const cookie = await impersonatedCookieFor('socials-imp-target', TEST_PASSWORD)

    // Support has to be able to see what it is looking at...
    const listed = await listSocials(cookie)
    expect(listed.status).toBe(200)
    expect(listed.body.data.socials).toEqual([])

    // ...and must not be able to touch it. Every write is refused, including the
    // ones aimed at an id that does not exist — which is the point: the guard runs
    // before the lookup, so a refusal never depends on the row being real.
    for (const blocked of [
      await createSocial(cookie, { platform: 'github', url: 'https://github.com/ada' }),
      await updateSocial(cookie, ulid(), { url: 'https://github.com/ada' }),
      await reorderSocials(cookie, [ulid()]),
      await deleteSocial(cookie, ulid()),
    ]) {
      expect(blocked.status).toBe(403)
      expect(errorOf(blocked).error.code).toBe('FORBIDDEN')
      expect(errorOf(blocked).error.message).toMatch(/read-only/i)
    }

    expect(await socialAudits()).toHaveLength(0)
  })

  it('refuses a suspended account on the read and the write alike', async () => {
    const user = await createTestUser({ role: 'user' })
    const cookie = await loginAs(user)

    await env.DB.prepare(
      `UPDATE users SET status = 'suspended', suspended_until = ?, status_reason = 'paused'
        WHERE id = ?`,
    )
      .bind(Date.now() + 3_600_000, user.id)
      .run()

    // Unlike `GET /auth/me`, which a suspended account keeps: this read is the
    // profile editor, not the record that explains the suspension.
    expect((await listSocials(cookie)).status).toBe(403)

    const blocked = await createSocial(cookie, { platform: 'github', url: 'https://github.com/ada' })
    expect(blocked.status).toBe(403)
    expect(errorOf(blocked).error.code).toBe('ACCOUNT_DISABLED')
  })

  it('postpones every social edit until an outstanding password change is done', async () => {
    const user = await createTestUser({ requirePasswordChange: true })
    const cookie = await loginAs(user)

    expect((await listSocials(cookie)).status).toBe(403)

    const blocked = await createSocial(cookie, { platform: 'github', url: 'https://github.com/ada' })
    expect(blocked.status).toBe(403)
    expect(errorOf(blocked).error.code).toBe('MUST_CHANGE_PASSWORD')
  })
})

describe('write budget', () => {
  it('spends one budget shared with `PATCH /auth/me`', async () => {
    const user = await createTestUser()
    const cookie = await loginAs(user)

    // `profile_write_user` is 60 per hour (seed/0001_platform-defaults.sql), and both
    // surfaces spend the same counter — editing the bio and reordering socials are the
    // same profile being written, so a client cannot double its allowance by
    // alternating endpoints.
    for (let write = 0; write < 59; write++) {
      const response = await api('PATCH', '/api/v1/auth/me', { cookie, body: { displayName: 'Ada' } })
      expect(response.status).toBe(200)
    }

    // The 60th write is the social, and it is served: the limit sits in front of the
    // request it counts, not in front of the work it does.
    const created = await createSocial(cookie, { platform: 'github', url: 'https://github.com/ada' })
    expect(created.status).toBe(201)

    const blocked = await createSocial(cookie, { platform: 'x', url: 'https://x.com/ada' })
    expect(blocked.status).toBe(429)
    expect(errorOf(blocked).error.code).toBe('RATE_LIMITED')
    expect(blocked.headers.get('x-ratelimit-limit')).toBe('60')
    expect(blocked.headers.get('x-ratelimit-remaining')).toBe('0')
    expect(blocked.headers.get('retry-after')).toBeTruthy()

    // Spent, not merely spiked at: the profile form is closed too.
    const profile = await api('PATCH', '/api/v1/auth/me', { cookie, body: { displayName: 'Ada' } })
    expect(profile.status).toBe(429)

    expect(await socialRows(user.id)).toHaveLength(1)
  })
})



