import { beforeEach, describe, expect, it } from 'vitest'
import { env } from 'cloudflare:workers'
import {
  TEST_PASSWORD,
  api,
  countRows,
  createTestUser,
  impersonatedCookieFor,
  loginAs,
  resetIsolateCaches,
  setSettingValue,
  type Envelope,
  type ErrorEnvelope,
} from './helpers'
// The one src import in this HTTP suite: `latestRevision` is the *ledger's* own
// answer (`MAX(page_revisions.revision)`), so a test can assert that the
// denormalised `pages.content_revision` the API now reads still agrees with it.
import { latestRevision } from '../src/services/page.service'

// ============================================================================
// /api/v1/pages + GET /api/v1/public/pages/:slug — the owner's link pages.
//
// Tests drive the real Hono app against real D1, like users.admin.spec.ts:
// no mocks, so the UNIQUE indexes, CHECK constraints and FK enforcement are
// the production ones.
//
// Impersonated sessions — the ones that prove a support session is read-only —
// are built by `impersonatedCookieFor` in helpers.ts: there is deliberately no
// public "impersonate" endpoint in the API yet, so the row is stamped there the
// way that route will stamp it.
// ============================================================================

beforeEach(() => {
  resetIsolateCaches()
})

function errorOf(response: { body: unknown }): ErrorEnvelope {
  return response.body as ErrorEnvelope
}

interface ApiPage {
  id: string
  slug: string
  title: string | null
  bio: string | null
  theme: string
  layout: string
  accentColor: string | null
  showBranding: boolean
  status: string
  moderationStatus: string
  visibility: string
  revision: number | null
  publishedAt: number | null
  updatedAt: number
}

interface PageLink {
  id: string
  title: string
  url: string
  domain: string | null
  description: string | null
  icon: string | null
  position: number
  isVisible: boolean
  startsAt: number | null
  endsAt: number | null
}

async function createPageAs(cookie: string, body: unknown = { slug: 'my-page' }) {
  return api<Envelope<ApiPage>>('POST', '/api/v1/pages', { cookie, body })
}

/**
 * `pages.content_revision` straight from D1. The column's `DEFAULT` is 1, so a
 * missing row and a never-published page must not look alike: `-1` for the
 * former, `0` for the latter.
 */
async function contentRevisionOf(pageId: string): Promise<number> {
  const row = await env.DB.prepare('SELECT content_revision FROM pages WHERE id = ?')
    .bind(pageId)
    .first<{ content_revision: number }>()
  return row?.content_revision ?? -1
}

describe('access control on /api/v1/pages', () => {
  it('requires authentication', async () => {
    const response = await api('GET', '/api/v1/pages/mine')
    expect(response.status).toBe(401)
    expect(errorOf(response).error.code).toBe('UNAUTHENTICATED')
  })

  it('lets a plain user create a page: pages need ownership, not capabilities', async () => {
    const user = await createTestUser({ role: 'user' })
    const response = await createPageAs(await loginAs(user))
    expect(response.status).toBe(201)
    expect(response.body.data.slug).toBe('my-page')
  })

  it('blocks a suspended account that still holds a valid session', async () => {
    const user = await createTestUser({ role: 'user' })
    const cookie = await loginAs(user)

    await env.DB.prepare(
      `UPDATE users SET status = 'suspended', suspended_until = ?, status_reason = 'paused'
        WHERE id = ?`,
    )
      .bind(Date.now() + 3_600_000, user.id)
      .run()

    const response = await api('POST', '/api/v1/pages', { cookie, body: { slug: 'nope' } })
    expect(response.status).toBe(403)
    expect(errorOf(response).error.code).toBe('ACCOUNT_DISABLED')
  })

  it('forces a password change before any page action is allowed', async () => {
    const user = await createTestUser({ role: 'user' })
    await env.DB.prepare('UPDATE users SET require_password_change = 1 WHERE id = ?')
      .bind(user.id)
      .run()
    const cookie = await loginAs(user)

    const blocked = await api('GET', '/api/v1/pages/mine', { cookie })
    expect(blocked.status).toBe(403)
    expect(errorOf(blocked).error.code).toBe('MUST_CHANGE_PASSWORD')
  })

  it('rejects writes from impersonated sessions but still allows reads', async () => {
    const cookie = await impersonatedCookieFor('imp-target', TEST_PASSWORD)

    const blocked = await api('POST', '/api/v1/pages', { cookie, body: { slug: 'nope' } })
    expect(blocked.status).toBe(403)
    expect(errorOf(blocked).error.message).toMatch(/read-only/i)

    expect((await api('GET', '/api/v1/pages/mine', { cookie })).status).toBe(200)
  })
})

describe('POST /api/v1/pages', () => {
  it('defaults the slug to the normalized username when omitted', async () => {
    // Usernames are stored lower-cased by register/login, and the default slug
    // is the slug-normalised username: `.` is not a slug character, so it folds.
    const user = await createTestUser({ role: 'user', username: 'page.owner' })
    const response = await api<Envelope<ApiPage>>('POST', '/api/v1/pages', {
      cookie: await loginAs(user),
      body: { title: 'Hello' },
    })
    expect(response.status).toBe(201)
    expect(response.body.data.slug).toBe('page-owner')
  })

  it('normalises a mixed-case slug with punctuation', async () => {
    const user = await createTestUser({ role: 'user' })
    const response = await createPageAs(await loginAs(user), { slug: '  Ada.Lovelace_1815!! ' })
    expect(response.status).toBe(201)
    // `normalizeSlug` lower-cases, folds everything outside [a-z0-9-_] to '-',
    // collapses runs of '-', and trims edge punctuation. `_` is a legal slug
    // character (URL-safe and in the reserved-slug alphabet), so it survives.
    expect(response.body.data.slug).toBe('ada-lovelace_1815')
  })

  it('refuses a slug that normalises away instead of inventing one', async () => {
    const user = await createTestUser({ role: 'user' })
    // "!!!" is a valid string so it passes the schema, then normalises to ''.
    // The service refuses the content with a 400 (422 is reserved for a body
    // that does not match the schema at all).
    const response = await createPageAs(await loginAs(user), { slug: '   !!!   ' })
    expect(response.status).toBe(400)
    expect(errorOf(response).error.code).toBe('BAD_REQUEST')
  })

  it('refuses a reserved slug', async () => {
    const user = await createTestUser({ role: 'user' })
    const response = await createPageAs(await loginAs(user), { slug: 'login' })
    expect(response.status).toBe(409)
  })

  it('refuses the /app console namespace, seed included', async () => {
    const user = await createTestUser({ role: 'user' })
    // The list the API actually consults is the seeded `content.reserved_slugs`
    // setting (`DEFAULT_RESERVED_SLUGS` is only the fallback when that row is
    // missing), so this pins the second of the two places `app` must appear.
    const response = await createPageAs(await loginAs(user), { slug: 'app' })
    expect(response.status).toBe(409)
    expect(errorOf(response).error.code).toBe('CONFLICT')
  })

  it('refuses a taken slug (409, not a 500 from the UNIQUE index)', async () => {
    const first = await createTestUser({ role: 'user' })
    const second = await createTestUser({ role: 'user' })

    expect((await createPageAs(await loginAs(first), { slug: 'taken' })).status).toBe(201)

    const clash = await createPageAs(await loginAs(second), { slug: 'Taken' })
    expect(clash.status).toBe(409)
    expect(errorOf(clash).error.code).toBe('CONFLICT')
  })

  it('treats a colliding default slug like an explicit one', async () => {
    // `same-name` and `same.name` are different usernames but normalise to the
    // same slug, so the second owner's implicit slug is a real clash.
    const first = await createTestUser({ role: 'user', username: 'same-name' })
    const second = await createTestUser({ role: 'user', username: 'same.name' })
    expect((await createPageAs(await loginAs(first), { slug: 'same-name' })).status).toBe(201)

    const response = await api<Envelope<ApiPage>>('POST', '/api/v1/pages', {
      cookie: await loginAs(second),
      body: {},
    })
    expect(response.status).toBe(409)
  })

  it('rejects a body with unknown keys (strict object)', async () => {
    const user = await createTestUser({ role: 'user' })
    const response = await createPageAs(await loginAs(user), { slug: 'ok-slug', isAdmin: true })
    expect(response.status).toBe(422)
  })

  it('writes a page.create audit row', async () => {
    const user = await createTestUser({ role: 'user' })
    const created = await createPageAs(await loginAs(user), { slug: 'audited' })
    expect(created.status).toBe(201)

    await expect(
      countRows(
        "SELECT count(*) AS total FROM audit_logs WHERE action = 'page.create' AND target_id = ?",
        (created.body.data as ApiPage).id,
      ),
    ).resolves.toBe(1)
  })
})

describe('GET /api/v1/pages/mine and GET /:id', () => {
  it('lists only the caller’s pages and reports totals', async () => {
    const owner = await createTestUser({ role: 'user' })
    const stranger = await createTestUser({ role: 'user' })
    const cookie = await loginAs(owner)

    await createPageAs(cookie, { slug: 'mine-one' })
    await createPageAs(cookie, { slug: 'mine-two' })
    await createPageAs(await loginAs(stranger), { slug: 'not-mine' })

    const response = await api<Envelope<Record<string, unknown>[]>>('GET', '/api/v1/pages/mine', {
      cookie,
    })
    expect(response.status).toBe(200)
    expect(response.body.data).toHaveLength(2)
  })

  it('returns owner DTOs — camelCase fields only, plus the list meta (R1.1)', async () => {
    const owner = await createTestUser({ role: 'user' })
    const cookie = await loginAs(owner)

    await createPageAs(cookie, { slug: 'dto-one' })
    await createPageAs(cookie, { slug: 'dto-two' })

    const response = await api<Envelope<Record<string, unknown>[]>>(
      'GET',
      '/api/v1/pages/mine?page=1&limit=1',
      { cookie },
    )

    expect(response.status).toBe(200)
    // `meta` is what the SPA paginates on: two pages at one per request is the
    // smallest request that proves `total` counts rows the page did not return.
    expect(response.body.meta).toMatchObject({ page: 1, limit: 1, total: 2, totalPages: 2 })

    expect(response.body.data).toHaveLength(1)
    const page = response.body.data[0] ?? {}

    // The exact key set, not a subset: a column the mapper does not name must
    // not survive the round trip, which is how raw `user_id`, `deleted_at` and
    // `content_revision` used to leak straight out of the table.
    expect(Object.keys(page).sort()).toEqual([
      'accentColor',
      'bio',
      'createdAt',
      'deletedAt',
      'id',
      'layout',
      'moderationStatus',
      'publishedAt',
      'revision',
      'showBranding',
      'slug',
      'status',
      'theme',
      'title',
      'updatedAt',
      'visibility',
    ])
    expect(Object.keys(page).filter((key) => key.includes('_'))).toEqual([])
  })

  it('answers 404 — not 403 — for another user’s page', async () => {
    const owner = await createTestUser({ role: 'user' })
    const stranger = await createTestUser({ role: 'user' })

    const created = await createPageAs(await loginAs(owner), { slug: 'private-page' })
    const pageId = (created.body.data as ApiPage).id

    const response = await api('GET', `/api/v1/pages/${pageId}`, {
      cookie: await loginAs(stranger),
    })
    expect(response.status).toBe(404)
  })

  it('returns the owned page with its links in position order', async () => {
    const user = await createTestUser({ role: 'user' })
    const cookie = await loginAs(user)
    const created = await createPageAs(cookie, { slug: 'with-links' })
    const pageId = (created.body.data as ApiPage).id

    for (const title of ['one', 'two']) {
      const added = await api('POST', `/api/v1/pages/${pageId}/links`, {
        cookie,
        body: { title, url: `https://example.com/${title}` },
      })
      expect(added.status).toBe(201)
    }

    const response = await api<Envelope<{ page: ApiPage; links: PageLink[] }>>(
      'GET',
      `/api/v1/pages/${pageId}`,
      { cookie },
    )
    expect(response.status).toBe(200)
    expect(response.body.data.links.map((link) => link.title)).toEqual(['one', 'two'])
  })
})

describe('editing a page', () => {
  it('updates presentation fields without touching what was not sent', async () => {
    const user = await createTestUser({ role: 'user' })
    const cookie = await loginAs(user)
    const created = await createPageAs(cookie, {
      slug: 'edit-page',
      title: 'Original',
      bio: 'Original bio',
      accentColor: '#112233',
    })
    const pageId = (created.body.data as ApiPage).id

    const patched = await api<Envelope<ApiPage>>('PATCH', `/api/v1/pages/${pageId}`, {
      cookie,
      body: { title: 'Renamed', layout: 'grid', showBranding: false },
    })
    expect(patched.status).toBe(200)
    expect(patched.body.data.title).toBe('Renamed')
    expect(patched.body.data.layout).toBe('grid')
    expect(patched.body.data.showBranding).toBe(false)
    // Absent from the body, so left alone — not cleared.
    expect(patched.body.data.bio).toBe('Original bio')
    expect(patched.body.data.accentColor).toBe('#112233')
  })

  it('clears nullable fields with an explicit null', async () => {
    const user = await createTestUser({ role: 'user' })
    const cookie = await loginAs(user)
    const created = await createPageAs(cookie, {
      slug: 'clear-page',
      title: 'Has a title',
      bio: 'Has a bio',
      accentColor: '#445566',
    })
    const pageId = (created.body.data as ApiPage).id

    // `null` ("clear it") must survive intact all the way to SQL NULL. Turning
    // it into `undefined` ("leave it alone") in the route is what made an
    // optional column impossible to empty from a client.
    const cleared = await api<Envelope<ApiPage>>('PATCH', `/api/v1/pages/${pageId}`, {
      cookie,
      body: { title: null, bio: null, accentColor: null },
    })
    expect(cleared.status).toBe(200)
    expect(cleared.body.data.title).toBeNull()
    expect(cleared.body.data.bio).toBeNull()
    expect(cleared.body.data.accentColor).toBeNull()
  })

  it('rejects an empty patch and a patch from a non-owner', async () => {
    const user = await createTestUser({ role: 'user' })
    const cookie = await loginAs(user)
    const created = await createPageAs(cookie, { slug: 'guarded-page' })
    const pageId = (created.body.data as ApiPage).id

    const empty = await api('PATCH', `/api/v1/pages/${pageId}`, { cookie, body: {} })
    expect(empty.status).toBe(422)

    const stranger = await createTestUser({ role: 'user' })
    const foreign = await api('PATCH', `/api/v1/pages/${pageId}`, {
      cookie: await loginAs(stranger),
      body: { title: 'Hijacked' },
    })
    expect(foreign.status).toBe(404)
  })
})

describe('publish lifecycle', () => {
  it('publishes a draft, bumps the revision, and snapshots the content', async () => {
    const user = await createTestUser({ role: 'user' })
    const cookie = await loginAs(user)
    const created = await createPageAs(cookie, { slug: 'lifecycle' })
    const pageId = (created.body.data as ApiPage).id

    await api('POST', `/api/v1/pages/${pageId}/links`, {
      cookie,
      body: { title: 'Docs', url: 'https://example.com/docs' },
    })

    const first = await api<Envelope<ApiPage>>('POST', `/api/v1/pages/${pageId}/publish`, { cookie })
    expect(first.status).toBe(200)
    expect(first.body.data.status).toBe('published')
    expect(first.body.data.revision).toBe(1)
    expect(first.body.data.publishedAt).toBeTypeOf('number')

    const second = await api<Envelope<ApiPage>>('POST', `/api/v1/pages/${pageId}/publish`, { cookie })
    expect(second.body.data.revision).toBe(2)

    await expect(
      countRows('SELECT count(*) AS total FROM page_revisions WHERE page_id = ?', pageId),
    ).resolves.toBe(2)
  })

  it('mirrors the live revision into pages.content_revision', async () => {
    const user = await createTestUser({ role: 'user' })
    const cookie = await loginAs(user)
    const created = await createPageAs(cookie, { slug: 'mirrored' })
    const pageId = (created.body.data as ApiPage).id

    // A draft has published nothing. The column's own DEFAULT is 1, so unless
    // create stamps a sentinel, `revision` could not tell "never published"
    // from "published once" (R1.0).
    expect(created.body.data.revision).toBeNull()
    expect(await contentRevisionOf(pageId)).toBe(0)

    await api('POST', `/api/v1/pages/${pageId}/publish`, { cookie })

    // `revision` is now read from this column rather than aggregated out of
    // `page_revisions`, so the copy has to stay honest: assert it against the
    // ledger's own answer. The second publish in the test above proves the
    // column keeps moving (the wire saw 1, then 2).
    expect(await contentRevisionOf(pageId)).toBe(1)
    expect(await contentRevisionOf(pageId)).toBe(await latestRevision(env.DB, pageId))
  })

  it('unpublishes without deleting history', async () => {
    const user = await createTestUser({ role: 'user' })
    const cookie = await loginAs(user)
    const created = await createPageAs(cookie, { slug: 'unpub' })
    const pageId = (created.body.data as ApiPage).id

    await api('POST', `/api/v1/pages/${pageId}/publish`, { cookie })
    const unpublished = await api<Envelope<ApiPage>>('POST', `/api/v1/pages/${pageId}/unpublish`, {
      cookie,
    })
    expect(unpublished.status).toBe(200)
    expect(unpublished.body.data.status).toBe('draft')
    expect(unpublished.body.data.publishedAt).toBeNull()

    // Taking a page down does not erase what was published: `revision` still
    // names the last published snapshot, and `pages.content_revision` is left
    // alone so a republication continues from the live number (R1.0).
    expect(unpublished.body.data.revision).toBe(1)
    expect(await contentRevisionOf(pageId)).toBe(1)

    await expect(
      countRows('SELECT count(*) AS total FROM page_revisions WHERE page_id = ?', pageId),
    ).resolves.toBe(1)
  })

  it('deletes the page, its links, and reserves the slug', async () => {
    const user = await createTestUser({ role: 'user' })
    const cookie = await loginAs(user)
    const created = await createPageAs(cookie, { slug: 'farewell' })
    const pageId = (created.body.data as ApiPage).id

    await api('POST', `/api/v1/pages/${pageId}/links`, {
      cookie,
      body: { title: 'Gone', url: 'https://example.com/gone' },
    })

    const deleted = await api('DELETE', `/api/v1/pages/${pageId}`, { cookie })
    expect(deleted.status).toBe(204)

    expect((await api('GET', `/api/v1/pages/${pageId}`, { cookie })).status).toBe(404)

    // The slug stays taken: nobody inherits the removed page's URL.
    const reclaim = await createPageAs(cookie, { slug: 'farewell' })
    expect(reclaim.status).toBe(409)
  })
})

describe('page links', () => {
  it('normalises URLs, derives the domain, and rejects non-http schemes', async () => {
    const user = await createTestUser({ role: 'user' })
    const cookie = await loginAs(user)
    const created = await createPageAs(cookie, { slug: 'linky' })
    const pageId = (created.body.data as ApiPage).id

    const good = await api<Envelope<PageLink>>('POST', `/api/v1/pages/${pageId}/links`, {
      cookie,
      body: { title: 'Example', url: 'HTTPS://Example.COM/some/path?x=1' },
    })
    expect(good.status).toBe(201)
    expect(good.body.data.domain).toBe('example.com')

    const bad = await api('POST', `/api/v1/pages/${pageId}/links`, {
      cookie,
      body: { title: 'Evil', url: 'javascript:alert(1)' },
    })
    expect(bad.status).toBe(400)
  })

  it('reorders links and refuses partial or duplicated orderings', async () => {
    const user = await createTestUser({ role: 'user' })
    const cookie = await loginAs(user)
    const created = await createPageAs(cookie, { slug: 'ordering' })
    const pageId = (created.body.data as ApiPage).id

    const ids: string[] = []
    for (const title of ['a', 'b', 'c']) {
      const added = await api<Envelope<PageLink>>('POST', `/api/v1/pages/${pageId}/links`, {
        cookie,
        body: { title, url: `https://example.com/${title}` },
      })
      ids.push(added.body.data.id)
    }

    const reversed = await api<Envelope<{ links: PageLink[] }>>(
      'PUT',
      `/api/v1/pages/${pageId}/links/order`,
      { cookie, body: { linkIds: [...ids].reverse() } },
    )
    expect(reversed.status).toBe(200)
    expect(reversed.body.data.links.map((link) => link.title)).toEqual(['c', 'b', 'a'])

    const partial = await api('PUT', `/api/v1/pages/${pageId}/links/order`, {
      cookie,
      body: { linkIds: [ids[0]] },
    })
    expect(partial.status).toBe(400)

    const duplicated = await api('PUT', `/api/v1/pages/${pageId}/links/order`, {
      cookie,
      body: { linkIds: [ids[0], ids[0], ids[1]] },
    })
    expect(duplicated.status).toBe(400)
  })

  it('enforces the configured links-per-page cap', async () => {
    const user = await createTestUser({ role: 'user' })
    const cookie = await loginAs(user)
    const created = await createPageAs(cookie, { slug: 'capped' })
    const pageId = (created.body.data as ApiPage).id

    // The seeded cap is 50; lowering it keeps this test to three requests. The
    // row is global state that resetDatabase() deliberately preserves, so it is
    // restored here rather than left to leak into later tests in this file.
    await setSettingValue('content.max_links_per_page', '2')

    try {
      for (const title of ['one', 'two']) {
        const added = await api('POST', `/api/v1/pages/${pageId}/links`, {
          cookie,
          body: { title, url: `https://example.com/${title}` },
        })
        expect(added.status).toBe(201)
      }

      const overflow = await api('POST', `/api/v1/pages/${pageId}/links`, {
        cookie,
        body: { title: 'three', url: 'https://example.com/three' },
      })
      expect(overflow.status).toBe(400)
    } finally {
      await setSettingValue('content.max_links_per_page', '50')
    }
  })

  it('updates a link, clears an optional field, and refuses a foreign link id', async () => {
    const user = await createTestUser({ role: 'user' })
    const cookie = await loginAs(user)
    const page = await createPageAs(cookie, { slug: 'edit-links' })
    const pageId = (page.body.data as ApiPage).id

    const added = await api<Envelope<PageLink>>('POST', `/api/v1/pages/${pageId}/links`, {
      cookie,
      body: { title: 'Before', url: 'https://example.com/before', description: 'note' },
    })
    const linkId = added.body.data.id

    const patched = await api<Envelope<PageLink>>('PATCH', `/api/v1/pages/${pageId}/links/${linkId}`, {
      cookie,
      body: { title: 'After', description: null },
    })
    expect(patched.status).toBe(200)
    expect(patched.body.data.title).toBe('After')
    expect(patched.body.data.description).toBeNull()

    const empty = await api('PATCH', `/api/v1/pages/${pageId}/links/${linkId}`, {
      cookie,
      body: {},
    })
    expect(empty.status).toBe(422)

    const stranger = await createTestUser({ role: 'user' })
    const foreign = await api('PATCH', `/api/v1/pages/${pageId}/links/${linkId}`, {
      cookie: await loginAs(stranger),
      body: { title: 'Hijacked' },
    })
    expect(foreign.status).toBe(404)
  })

  it('unschedules a link window with an explicit null', async () => {
    const user = await createTestUser({ role: 'user' })
    const cookie = await loginAs(user)
    const page = await createPageAs(cookie, { slug: 'unschedule' })
    const pageId = (page.body.data as ApiPage).id

    const added = await api<Envelope<PageLink>>('POST', `/api/v1/pages/${pageId}/links`, {
      cookie,
      body: {
        title: 'Timed',
        url: 'https://example.com/timed',
        startsAt: 1_700_000_000_000,
        endsAt: 1_800_000_000_000,
      },
    })
    expect(added.body.data.startsAt).toBe(1_700_000_000_000)

    // `null` is how a window is removed; without it a scheduled link could be
    // given a window but never taken out of one.
    const cleared = await api<Envelope<PageLink>>(
      'PATCH',
      `/api/v1/pages/${pageId}/links/${added.body.data.id}`,
      { cookie, body: { startsAt: null, endsAt: null } },
    )
    expect(cleared.status).toBe(200)
    expect(cleared.body.data.startsAt).toBeNull()
    expect(cleared.body.data.endsAt).toBeNull()
  })

  it('soft-deletes a link so it leaves the detail payload', async () => {
    const user = await createTestUser({ role: 'user' })
    const cookie = await loginAs(user)
    const page = await createPageAs(cookie, { slug: 'link-removal' })
    const pageId = (page.body.data as ApiPage).id

    const added = await api<Envelope<PageLink>>('POST', `/api/v1/pages/${pageId}/links`, {
      cookie,
      body: { title: 'Doomed', url: 'https://example.com/doomed' },
    })

    const removed = await api('DELETE', `/api/v1/pages/${pageId}/links/${added.body.data.id}`, {
      cookie,
    })
    expect(removed.status).toBe(204)

    const detail = await api<Envelope<{ links: PageLink[] }>>('GET', `/api/v1/pages/${pageId}`, {
      cookie,
    })
    expect(detail.body.data.links).toHaveLength(0)
  })
})

// ============================================================================
// GET /api/v1/public/pages/:slug — the anonymous read path.
//
// Every visibility rule lives in one function (getPublicPage), and until this
// block existed none of it was exercised: the owner-side suite above can only
// ever see the owner's own pages. Each rule gets a page of its own here, and
// each unreachable state must be indistinguishable from an unknown slug.
// ============================================================================

interface PublicPagePayload {
  page: {
    slug: string
    title: string | null
    owner: { username: string; displayName: string }
  }
  links: PageLink[]
}

function publicRead(slug: string) {
  return api<Envelope<PublicPagePayload>>('GET', `/api/v1/public/pages/${slug}`)
}

/**
 * Creates a page, adds whatever links were asked for, publishes it, and returns
 * the owner's session. Publishing last keeps the revision snapshot faithful to
 * what the owner actually published.
 */
async function publishedPage(slug: string, links: readonly Record<string, unknown>[] = []) {
  const user = await createTestUser({ role: 'user' })
  const cookie = await loginAs(user)
  const created = await createPageAs(cookie, { slug, title: `${slug} title` })
  const pageId = (created.body.data as ApiPage).id

  for (const body of links) {
    const added = await api('POST', `/api/v1/pages/${pageId}/links`, { cookie, body })
    expect(added.status).toBe(201)
  }

  const published = await api('POST', `/api/v1/pages/${pageId}/publish`, { cookie })
  expect(published.status).toBe(200)

  return { user, cookie, pageId }
}

describe('GET /api/v1/public/pages/:slug', () => {
  it('serves a published page anonymously, with visible links in position order', async () => {
    const { user } = await publishedPage('public-page', [
      { title: 'first', url: 'https://example.com/one' },
      { title: 'second', url: 'https://example.com/two' },
    ])

    const response = await publicRead('public-page')
    expect(response.status).toBe(200)
    expect(response.body.data.page.slug).toBe('public-page')
    expect(response.body.data.page.title).toBe('public-page title')
    expect(response.body.data.page.owner).toEqual({
      username: user.username,
      displayName: user.username,
    })
    expect(response.body.data.links.map((link) => link.title)).toEqual(['first', 'second'])

    // Nothing an anonymous reader must not have: internal columns that leaked
    // into the owner shape, moderation counters, revision history, click counts.
    const raw = JSON.stringify(response.body)
    for (const forbidden of [
      'moderationStatus',
      'moderation_status',
      'revision',
      'viewCount',
      'clicks',
      'firstPublishedAt',
    ]) {
      expect(raw).not.toContain(forbidden)
    }
  })

  it('answers 404 for a draft, an unknown slug, and a moderation-removed page', async () => {
    const user = await createTestUser({ role: 'user' })
    const cookie = await loginAs(user)
    const draft = await createPageAs(cookie, { slug: 'still-draft' })
    const pageId = (draft.body.data as ApiPage).id

    // Created but never published.
    expect((await publicRead('still-draft')).status).toBe(404)
    expect((await publicRead('never-existed')).status).toBe(404)

    await api('POST', `/api/v1/pages/${pageId}/publish`, { cookie })
    expect((await publicRead('still-draft')).status).toBe(200)

    // Taken down by moderation. The schema ties `removed_at` to
    // `moderation_status`, so both move together.
    await env.DB.prepare(
      `UPDATE pages SET moderation_status = 'removed', removed_at = ?, removed_reason = 'spam'
        WHERE id = ?`,
    )
      .bind(Date.now(), pageId)
      .run()

    const removed = await publicRead('still-draft')
    expect(removed.status).toBe(404)
    expect(errorOf(removed).error.code).toBe('NOT_FOUND')
  })

  it('hides links that are switched off or outside their window', async () => {
    const hour = 3_600_000
    const now = Date.now()

    await publishedPage('scheduled', [
      { title: 'live', url: 'https://example.com/live' },
      { title: 'switched-off', url: 'https://example.com/off', isVisible: false },
      { title: 'future', url: 'https://example.com/future', startsAt: now + hour },
      { title: 'expired', url: 'https://example.com/expired', endsAt: now - hour },
      {
        title: 'windowed',
        url: 'https://example.com/windowed',
        startsAt: now - hour,
        endsAt: now + hour,
      },
    ])

    const response = await publicRead('scheduled')
    expect(response.status).toBe(200)
    expect(response.body.data.links.map((link) => link.title)).toEqual(['live', 'windowed'])
  })

  it('normalises the slug, and drops off the public surface when unpublished', async () => {
    const { cookie, pageId } = await publishedPage('ada-lovelace')

    // Case and punctuation are not a second namespace: /Ada.Lovelace is the
    // same page as /ada-lovelace.
    expect((await publicRead('Ada.Lovelace')).status).toBe(200)

    await api('POST', `/api/v1/pages/${pageId}/unpublish`, { cookie })
    expect((await publicRead('ada-lovelace')).status).toBe(404)
  })

  it('takes a published page down when its owner is suspended', async () => {
    const { user } = await publishedPage('suspended-owner')
    expect((await publicRead('suspended-owner')).status).toBe(200)

    await env.DB.prepare(
      `UPDATE users SET status = 'suspended', suspended_until = ?, status_reason = 'paused'
        WHERE id = ?`,
    )
      .bind(Date.now() + 3_600_000, user.id)
      .run()

    expect((await publicRead('suspended-owner')).status).toBe(404)
  })
})
