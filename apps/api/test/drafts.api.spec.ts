import { beforeEach, describe, expect, it } from 'vitest'
import { env } from 'cloudflare:workers'
import {
  api,
  countRows,
  createTestUser,
  loginAs,
  resetIsolateCaches,
  type ErrorEnvelope,
  type Envelope,
} from './helpers'

beforeEach(() => resetIsolateCaches())

interface Draft {
  content: {
    v: 1
    page: {
      title: string | null
      bio: string | null
      theme: 'light' | 'dark'
      layout: 'list' | 'grid'
      accentColor: string | null
      showBranding: boolean
    }
    groups: Array<{ id?: string; name: string }>
    links: Array<{
      id?: string
      title: string
      url: string
      description: string | null
      icon: string | null
      isVisible: boolean
      groupId: string | null
      openInNewTab: boolean
      thumbnailKey: string | null
      startsAt: number | null
      endsAt: number | null
    }>
  }
  updatedAt: number | null
  unpublishedChanges: boolean
}

async function pageFor(cookie: string, slug: string) {
  const response = await api<Envelope<{ id: string }>>('POST', '/api/v1/pages', {
    cookie,
    body: { slug, title: 'Live title' },
  })
  return response.body.data.id
}

async function save(cookie: string, pageId: string, draft: Draft) {
  return api<Envelope<{ draft: Draft }>>('PUT', `/api/v1/pages/${pageId}/draft`, {
    cookie,
    body: { content: draft.content, updatedAt: draft.updatedAt },
  })
}

describe('page drafts and revision history', () => {
  it('keeps autosaves isolated from live page and link rows until publish', async () => {
    const user = await createTestUser({ role: 'user' })
    const cookie = await loginAs(user)
    const pageId = await pageFor(cookie, 'draft-isolation')
    const link = await api<Envelope<{ id: string }>>('POST', `/api/v1/pages/${pageId}/links`, {
      cookie,
      body: { title: 'Live link', url: 'https://example.com/live' },
    })
    await api('POST', `/api/v1/pages/${pageId}/publish`, { cookie })

    const current = (await api<Envelope<{ draft: Draft }>>(
      'GET',
      `/api/v1/pages/${pageId}/draft`,
      { cookie },
    )).body.data.draft
    current.content.page.title = 'Unpublished title'
    current.content.links[0]!.title = 'Unpublished link'
    const saved = await save(cookie, pageId, current)
    expect(saved.status).toBe(200)
    expect(saved.body.data.draft.unpublishedChanges).toBe(true)

    const page = await api<Envelope<{ page: { title: string }; links: Array<{ id: string; title: string }> }>>(
      'GET',
      `/api/v1/pages/${pageId}`,
      { cookie },
    )
    expect(page.body.data.page.title).toBe('Live title')
    expect(page.body.data.links[0]?.title).toBe('Live link')
    expect(link.body.data.id).toBe(page.body.data.links[0]?.id)
    expect((await api('GET', '/api/v1/public/pages/draft-isolation')).status).toBe(200)
    const publicPage = await api<Envelope<{ page: { title: string }; links: Array<{ title: string }> }>>(
      'GET',
      '/api/v1/public/pages/draft-isolation',
    )
    expect(publicPage.body.data.page.title).toBe('Live title')
    expect(publicPage.body.data.links[0]?.title).toBe('Live link')
  })

  it('rejects a stale autosave and allows the current guard value', async () => {
    const user = await createTestUser({ role: 'user' })
    const cookie = await loginAs(user)
    const pageId = await pageFor(cookie, 'draft-guard')
    const initial = (await api<Envelope<{ draft: Draft }>>(
      'GET',
      `/api/v1/pages/${pageId}/draft`,
      { cookie },
    )).body.data.draft

    initial.content.page.title = 'First save'
    const first = await save(cookie, pageId, initial)
    expect(first.status).toBe(200)
    expect(first.body.data.draft.updatedAt).toBeTypeOf('number')

    initial.content.page.title = 'Stale save'
    const stale = await api<ErrorEnvelope>('PUT', `/api/v1/pages/${pageId}/draft`, {
      cookie,
      body: { content: initial.content, updatedAt: initial.updatedAt },
    })
    expect(stale.status).toBe(412)
    expect(stale.body.error.code).toBe('PRECONDITION_FAILED')

    const current = first.body.data.draft
    current.content.page.title = 'Current save'
    expect((await save(cookie, pageId, current)).status).toBe(200)
  })

  it('hides draft, preview, and revision resources belonging to another owner', async () => {
    const owner = await createTestUser({ role: 'user' })
    const stranger = await createTestUser({ role: 'user' })
    const ownerCookie = await loginAs(owner)
    const strangerCookie = await loginAs(stranger)
    const pageId = await pageFor(ownerCookie, 'private-draft')
    await api('POST', `/api/v1/pages/${pageId}/publish`, { cookie: ownerCookie })

    expect((await api('GET', `/api/v1/pages/${pageId}/draft`, { cookie: strangerCookie })).status).toBe(404)
    expect((await api('GET', `/api/v1/pages/${pageId}/preview`, { cookie: strangerCookie })).status).toBe(404)
    expect((await api('GET', `/api/v1/pages/${pageId}/revisions`, { cookie: strangerCookie })).status).toBe(404)
  })

  it('publishes saved draft content, restores history to a draft, and discards safely', async () => {
    const user = await createTestUser({ role: 'user' })
    const cookie = await loginAs(user)
    const pageId = await pageFor(cookie, 'draft-publish')
    await api('POST', `/api/v1/pages/${pageId}/links`, {
      cookie,
      body: { title: 'Original link', url: 'https://example.com/original' },
    })
    await api('POST', `/api/v1/pages/${pageId}/publish`, { cookie })

    const initial = (await api<Envelope<{ draft: Draft }>>(
      'GET',
      `/api/v1/pages/${pageId}/draft`,
      { cookie },
    )).body.data.draft
    initial.content.page.title = 'Edited title'
    initial.content.links[0]!.title = 'Edited link'
    const saved = await save(cookie, pageId, initial)
    const publish = await api<Envelope<{ revision: number; unpublishedChanges: boolean }>>(
      'POST',
      `/api/v1/pages/${pageId}/publish`,
      { cookie },
    )
    expect(publish.body.data.revision).toBe(2)
    expect(publish.body.data.unpublishedChanges).toBe(false)

    const revisions = await api<Envelope<{ revisions: Array<{ revision: number }> }>>(
      'GET',
      `/api/v1/pages/${pageId}/revisions`,
      { cookie },
    )
    expect(revisions.body.data.revisions.map(({ revision }) => revision)).toEqual([2, 1])
    const detail = await api<Envelope<{ content: Draft['content'] }>>(
      'GET',
      `/api/v1/pages/${pageId}/revisions/1`,
      { cookie },
    )
    expect(detail.body.data.content.page.title).toBe('Live title')

    const restored = await api<Envelope<{ draft: Draft }>>(
      'POST',
      `/api/v1/pages/${pageId}/revisions/1/restore`,
      { cookie },
    )
    expect(restored.body.data.draft.unpublishedChanges).toBe(true)
    expect(restored.body.data.draft.content.page.title).toBe('Live title')
    const preview = await api<Envelope<{ page: { title: string } }>>(
      'GET',
      `/api/v1/pages/${pageId}/preview`,
      { cookie },
    )
    expect(preview.body.data.page.title).toBe('Live title')

    const discarded = await api<Envelope<{ draft: Draft }>>(
      'POST',
      `/api/v1/pages/${pageId}/draft/discard`,
      { cookie },
    )
    expect(discarded.body.data.draft.unpublishedChanges).toBe(false)
    expect(discarded.body.data.draft.content.page.title).toBe('Edited title')
    expect(saved.status).toBe(200)
    expect((await api('GET', '/api/v1/public/pages/draft-publish')).status).toBe(200)
    const live = await api<Envelope<{ page: { title: string } }>>(
      'GET',
      '/api/v1/public/pages/draft-publish',
    )
    expect(live.body.data.page.title).toBe('Edited title')
  })

  it('reads a legacy snapshot without the version envelope', async () => {
    const user = await createTestUser({ role: 'user' })
    const cookie = await loginAs(user)
    const pageId = await pageFor(cookie, 'legacy-snapshot')
    await api('POST', `/api/v1/pages/${pageId}/publish`, { cookie })
    await env.DB.prepare('UPDATE page_revisions SET snapshot = ? WHERE page_id = ? AND revision = 1')
      .bind(JSON.stringify({
        page: { title: 'Legacy title', bio: null, theme: 'dark', layout: 'grid', accentColor: null, showBranding: true },
        links: [],
      }), pageId)
      .run()

    const response = await api<Envelope<{ content: Draft['content'] }>>(
      'GET',
      `/api/v1/pages/${pageId}/revisions/1`,
      { cookie },
    )
    expect(response.status).toBe(200)
    expect(response.body.data.content.v).toBe(1)
    expect(response.body.data.content.page.title).toBe('Legacy title')
    expect(response.body.data.content.groups).toEqual([])
  })

  it('keeps only the newest ten published revisions', async () => {
    const user = await createTestUser({ role: 'user' })
    const cookie = await loginAs(user)
    const pageId = await pageFor(cookie, 'revision-pruning')
    for (let revision = 0; revision < 11; revision += 1) {
      const response = await api('POST', `/api/v1/pages/${pageId}/publish`, { cookie })
      expect(response.status).toBe(200)
    }
    await expect(countRows(
      'SELECT count(*) AS total FROM page_revisions WHERE page_id = ?',
      pageId,
    )).resolves.toBe(10)
  })

  it('returns a soft 429 when the autosave throttle is depleted', async () => {
    const user = await createTestUser({ role: 'user' })
    const cookie = await loginAs(user)
    const pageId = await pageFor(cookie, 'autosave-throttle')
    await env.DB.prepare(
      "UPDATE rate_limits SET max_requests = 1, action = 'throttle' WHERE key = 'page_autosave_user'",
    ).run()
    resetIsolateCaches()
    const draft = (await api<Envelope<{ draft: Draft }>>(
      'GET',
      `/api/v1/pages/${pageId}/draft`,
      { cookie },
    )).body.data.draft
    expect((await save(cookie, pageId, draft)).status).toBe(200)
    expect((await save(cookie, pageId, draft)).status).toBe(429)
  })
})
