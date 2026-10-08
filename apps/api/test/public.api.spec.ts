import { beforeEach, describe, expect, it } from 'vitest'
import { env } from 'cloudflare:workers'
import { invalidateRateLimitCache } from '../src/middleware/rate-limit'
import { prunePageAnalytics } from '../src/services/analytics.service'
import { api, createTestUser, loginAs, resetIsolateCaches, type Envelope } from './helpers'

beforeEach(() => resetIsolateCaches())

describe('R1.7 public page and preview contracts', () => {
  it('renders owner identity and visible socials without exposing private fields', async () => {
    const user = await createTestUser({ role: 'user' })
    const cookie = await loginAs(user)
    await env.DB.prepare(
      `UPDATE users SET bio = ?, location = ?, pronouns = ?, avatar_key = ? WHERE id = ?`,
    ).bind(
      'Public profile bio',
      'Vancouver',
      'they/them',
      `avatars/${user.id}/01JGFJJZ5JQ6C2M2P6G3T4W8Z9.webp`,
      user.id,
    ).run()
    await api('POST', '/api/v1/profile/socials', {
      cookie,
      body: { platform: 'github', url: 'https://github.com/example' },
    })
    await api('POST', '/api/v1/profile/socials', {
      cookie,
      body: { platform: 'instagram', url: 'https://instagram.com/hidden', isVisible: false },
    })

    const created = await api<Envelope<{ id: string }>>('POST', '/api/v1/pages', {
      cookie,
      body: { slug: 'identity-public', title: 'Public page' },
    })
    await api('POST', `/api/v1/pages/${created.body.data.id}/publish`, { cookie })
    const response = await api<Envelope<{
      page: { owner: Record<string, unknown> }
      links: unknown[]
      groups: unknown[]
    }>>('GET', '/api/v1/public/pages/identity-public')

    expect(response.status).toBe(200)
    expect(response.body.data.page.owner).toMatchObject({
      username: user.username,
      displayName: user.username,
      avatarUrl: `/api/v1/media/avatars/${user.id}/01JGFJJZ5JQ6C2M2P6G3T4W8Z9.webp`,
      bio: 'Public profile bio',
      location: 'Vancouver',
      pronouns: 'they/them',
      socials: [{ platform: 'github', url: 'https://github.com/example', position: 0 }],
    })
    const serialized = JSON.stringify(response.body)
    for (const forbidden of [
      '"status"',
      'moderationStatus',
      'revision',
      'viewCount',
      'clicks',
      'userId',
      'avatar_key',
      'createdAt',
      'updatedAt',
    ]) {
      expect(serialized).not.toContain(forbidden)
    }
  })

  it('uses the same render DTO for preview and public reads, without leaking draft changes', async () => {
    const user = await createTestUser({ role: 'user' })
    const cookie = await loginAs(user)
    const created = await api<Envelope<{ id: string }>>('POST', '/api/v1/pages', {
      cookie,
      body: { slug: 'preview-parity', title: 'Published title' },
    })
    const pageId = created.body.data.id
    const group = await api<Envelope<{ id: string }>>('POST', `/api/v1/pages/${pageId}/groups`, {
      cookie,
      body: { name: 'Work' },
    })
    await api('POST', `/api/v1/pages/${pageId}/links`, {
      cookie,
      body: {
        title: 'Published link',
        url: 'https://example.com/published',
        groupId: group.body.data.id,
      },
    })
    await api('POST', `/api/v1/pages/${pageId}/publish`, { cookie })

    const publicBefore = await api<Envelope<unknown>>('GET', '/api/v1/public/pages/preview-parity')
    const previewBefore = await api<Envelope<unknown>>(
      'GET',
      `/api/v1/pages/${pageId}/preview`,
      { cookie },
    )
    expect(previewBefore.status).toBe(200)
    expect(previewBefore.body.data).toEqual(publicBefore.body.data)

    const draft = await api<Envelope<{
      draft: {
        content: {
          page: { title: string | null }
          links: Array<{ title: string }>
        }
        updatedAt: number | null
      }
    }>>('GET', `/api/v1/pages/${pageId}/draft`, { cookie })
    draft.body.data.draft.content.page.title = 'Unpublished preview title'
    draft.body.data.draft.content.links[0]!.title = 'Unpublished preview link'
    const saved = await api('PUT', `/api/v1/pages/${pageId}/draft`, {
      cookie,
      body: {
        content: draft.body.data.draft.content,
        updatedAt: draft.body.data.draft.updatedAt,
      },
    })
    expect(saved.status).toBe(200)

    const previewAfter = await api<Envelope<{ page: { title: string }; links: Array<{ title: string }> }>>(
      'GET',
      `/api/v1/pages/${pageId}/preview`,
      { cookie },
    )
    const publicAfter = await api<Envelope<{ page: { title: string }; links: Array<{ title: string }> }>>(
      'GET',
      '/api/v1/public/pages/preview-parity',
    )
    expect(previewAfter.body.data.page.title).toBe('Unpublished preview title')
    expect(previewAfter.body.data.links[0]?.title).toBe('Unpublished preview link')
    expect(publicAfter.body.data.page.title).toBe('Published title')
    expect(publicAfter.body.data.links[0]?.title).toBe('Published link')
  })

  it('always exposes the public page base URL setting', async () => {
    const response = await api<Envelope<{ settings: Record<string, unknown> }>>(
      'GET',
      '/api/v1/public/settings',
    )
    expect(response.body.data.settings['platform.pages_base_url']).toBeTypeOf('string')
  })

  it('records anonymous views and valid link clicks as daily aggregates', async () => {
    const owner = await createTestUser()
    const cookie = await loginAs(owner)
    const created = await api<Envelope<{ id: string }>>('POST', '/api/v1/pages', {
      cookie,
      body: { slug: 'analytics-events', title: 'Analytics' },
    })
    const pageId = created.body.data.id
    const link = await api<Envelope<{ id: string }>>('POST', `/api/v1/pages/${pageId}/links`, {
      cookie,
      body: { title: 'Example', url: 'https://example.com' },
    })
    await api('POST', `/api/v1/pages/${pageId}/publish`, { cookie })

    expect((await api('POST', '/api/v1/public/pages/analytics-events/events', { body: { type: 'view' } })).status).toBe(204)
    expect((await api('POST', '/api/v1/public/pages/analytics-events/events', {
      body: { type: 'click', linkId: link.body.data.id },
    })).status).toBe(204)

    const page = await env.DB.prepare('SELECT view_count FROM pages WHERE id=?').bind(pageId).first<{ view_count: number }>()
    const clicks = await env.DB.prepare('SELECT clicks FROM page_links WHERE id=?').bind(link.body.data.id).first<{ clicks: number }>()
    const daily = await env.DB.prepare('SELECT views,clicks FROM page_analytics_daily WHERE page_id=?')
      .bind(pageId).first<{ views: number; clicks: number }>()
    expect(page?.view_count).toBe(1)
    expect(clicks?.clicks).toBe(1)
    expect(daily).toEqual({ views: 1, clicks: 1 })
  })

  it('rejects invalid analytics targets and exposes reports only to the page owner', async () => {
    const owner = await createTestUser()
    const cookie = await loginAs(owner)
    const created = await api<Envelope<{ id: string }>>('POST', '/api/v1/pages', {
      cookie,
      body: { slug: 'analytics-private', title: 'Analytics' },
    })
    await api('POST', `/api/v1/pages/${created.body.data.id}/publish`, { cookie })

    expect((await api('POST', '/api/v1/public/pages/analytics-private/events', {
      body: { type: 'click', linkId: '01JGFJJZ5JQ6C2M2P6G3T4W8Z9' },
    })).status).toBe(404)
    expect((await api('POST', '/api/v1/public/pages/analytics-private/events', {
      body: { type: 'view', linkId: '01JGFJJZ5JQ6C2M2P6G3T4W8Z9' },
    })).status).toBe(422)

    const report = await api<Envelope<{ totalViews: number; daily: Array<{ date: string; views: number; clicks: number }> }>>(
      'GET', `/api/v1/pages/${created.body.data.id}/analytics?days=7`, { cookie },
    )
    expect(report.status).toBe(200)
    expect(report.body.data.totalViews).toBe(0)
    expect(report.body.data.daily).toHaveLength(7)
    const stranger = await loginAs(await createTestUser())
    expect((await api('GET', `/api/v1/pages/${created.body.data.id}/analytics`, { cookie: stranger })).status).toBe(404)
  })

  it('rate-limits anonymous analytics events by IP', async () => {
    const owner = await createTestUser()
    const cookie = await loginAs(owner)
    const created = await api<Envelope<{ id: string }>>('POST', '/api/v1/pages', {
      cookie,
      body: { slug: 'analytics-throttle', title: 'Analytics' },
    })
    await api('POST', `/api/v1/pages/${created.body.data.id}/publish`, { cookie })
    await env.DB.prepare("UPDATE rate_limits SET max_requests=1,action='block' WHERE key='analytics_event_ip'").run()
    invalidateRateLimitCache()
    try {
      expect((await api('POST', '/api/v1/public/pages/analytics-throttle/events', { body: { type: 'view' } })).status).toBe(204)
      expect((await api('POST', '/api/v1/public/pages/analytics-throttle/events', { body: { type: 'view' } })).status).toBe(429)
      const page = await env.DB.prepare('SELECT view_count FROM pages WHERE id=?').bind(created.body.data.id).first<{ view_count: number }>()
      expect(page?.view_count).toBe(1)
    } finally {
      await env.DB.prepare("UPDATE rate_limits SET max_requests=600,action='block' WHERE key='analytics_event_ip'").run()
      invalidateRateLimitCache()
    }
  })

  it('prunes daily analytics outside the bounded retention period', async () => {
    const owner = await createTestUser()
    const cookie = await loginAs(owner)
    const created = await api<Envelope<{ id: string }>>('POST', '/api/v1/pages', {
      cookie,
      body: { slug: 'analytics-retention', title: 'Analytics' },
    })
    const referenceTime = Date.UTC(2026, 9, 8)
    const oldDate = new Date(referenceTime - 91 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10)
    await env.DB.prepare('INSERT INTO page_analytics_daily(page_id,event_date,views,clicks) VALUES(?,?,3,1)')
      .bind(created.body.data.id, oldDate).run()

    expect(await prunePageAnalytics(env.DB, 90, referenceTime)).toBe(1)
    expect(await env.DB.prepare('SELECT page_id FROM page_analytics_daily WHERE page_id=?')
      .bind(created.body.data.id).first()).toBeNull()
  })
})
