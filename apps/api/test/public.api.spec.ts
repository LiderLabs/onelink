import { beforeEach, describe, expect, it } from 'vitest'
import { env } from 'cloudflare:workers'
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
})
