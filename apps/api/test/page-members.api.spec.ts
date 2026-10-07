import { beforeEach, describe, expect, it } from 'vitest'
import { env } from 'cloudflare:workers'
import {
  api,
  createTestUser,
  loginAs,
  resetIsolateCaches,
  type Envelope,
  type ErrorEnvelope,
} from './helpers'

beforeEach(() => {
  resetIsolateCaches()
})

function errorOf(response: { body: unknown }): ErrorEnvelope {
  return response.body as ErrorEnvelope
}

async function createPage(cookie: string, slug: string): Promise<string> {
  const response = await api<Envelope<{ id: string }>>('POST', '/api/v1/pages', {
    cookie,
    body: { slug },
  })
  expect(response.status).toBe(201)
  return response.body.data.id
}

describe('page teams', () => {
  it('accepts email-bound invitations and applies viewer/editor permissions', async () => {
    const owner = await createTestUser()
    const invited = await createTestUser()
    const other = await createTestUser()
    const ownerCookie = await loginAs(owner)
    const invitedCookie = await loginAs(invited)
    const pageId = await createPage(ownerCookie, `team-${owner.username}`)

    const created = await api<Envelope<{ invitation: { id: string; role: string } }>>(
      'POST',
      `/api/v1/pages/${pageId}/invitations`,
      { cookie: ownerCookie, body: { email: invited.email } },
    )
    expect(created.status).toBe(201)
    expect(created.body.data.invitation.role).toBe('viewer')

    const pending = await api<Envelope<{ invitations: Array<{ id: string; page: { id: string } }> }>>(
      'GET',
      '/api/v1/page-invitations',
      { cookie: invitedCookie },
    )
    expect(pending.body.data.invitations).toHaveLength(1)
    expect(pending.body.data.invitations[0]?.page.id).toBe(pageId)

    const wrongAccount = await api('POST', `/api/v1/page-invitations/${created.body.data.invitation.id}/accept`, {
      cookie: await loginAs(other),
    })
    expect(wrongAccount.status).toBe(404)

    const accepted = await api<Envelope<{ invitation: { accepted: boolean; role: string } }>>(
      'POST',
      `/api/v1/page-invitations/${created.body.data.invitation.id}/accept`,
      { cookie: invitedCookie },
    )
    expect(accepted.status).toBe(200)
    expect(accepted.body.data.invitation).toMatchObject({ accepted: true, role: 'viewer' })

    const listing = await api<Envelope<Array<{ id: string; accessRole: string }>>>(
      'GET',
      '/api/v1/pages/mine',
      { cookie: invitedCookie },
    )
    expect(listing.body.data).toContainEqual(expect.objectContaining({ id: pageId, accessRole: 'viewer' }))

    const pageRead = await api('GET', `/api/v1/pages/${pageId}`, { cookie: invitedCookie })
    expect(pageRead.status).toBe(200)
    const memberRead = await api<Envelope<{ members: unknown[] }>>(
      'GET',
      `/api/v1/pages/${pageId}/members`,
      { cookie: invitedCookie },
    )
    expect(memberRead.status).toBe(200)
    expect(memberRead.body.data.members).toHaveLength(2)
    const deniedWrite = await api('POST', `/api/v1/pages/${pageId}/links`, {
      cookie: invitedCookie,
      body: { title: 'Link', url: 'https://example.com' },
    })
    expect(deniedWrite.status).toBe(404)
    expect(errorOf(deniedWrite).error.code).toBe('NOT_FOUND')
    expect((await api('POST', `/api/v1/pages/${pageId}/invitations`, {
      cookie: invitedCookie,
      body: { email: other.email },
    })).status).toBe(404)
    expect((await api('PATCH', `/api/v1/pages/${pageId}/members/${invited.id}`, {
      cookie: invitedCookie,
      body: { role: 'editor' },
    })).status).toBe(404)

    const changed = await api('PATCH', `/api/v1/pages/${pageId}/members/${invited.id}`, {
      cookie: ownerCookie,
      body: { role: 'editor' },
    })
    expect(changed.status).toBe(200)

    const allowedWrite = await api('POST', `/api/v1/pages/${pageId}/links`, {
      cookie: invitedCookie,
      body: { title: 'Link', url: 'https://example.com' },
    })
    expect(allowedWrite.status).toBe(201)
    expect((await api('POST', `/api/v1/pages/${pageId}/invitations`, {
      cookie: invitedCookie,
      body: { email: other.email },
    })).status).toBe(404)

    const removed = await api('DELETE', `/api/v1/pages/${pageId}/members/${invited.id}`, {
      cookie: ownerCookie,
    })
    expect(removed.status).toBe(204)
    expect((await api('GET', `/api/v1/pages/${pageId}`, { cookie: invitedCookie })).status).toBe(404)
  })

  it('prevents non-owners from managing memberships and allows invitation revocation', async () => {
    const owner = await createTestUser()
    const collaborator = await createTestUser()
    const invited = await createTestUser()
    const ownerCookie = await loginAs(owner)
    const collaboratorCookie = await loginAs(collaborator)
    const pageId = await createPage(ownerCookie, `team-${owner.username}`)

    const created = await api<Envelope<{ invitation: { id: string } }>>(
      'POST',
      `/api/v1/pages/${pageId}/invitations`,
      { cookie: ownerCookie, body: { email: invited.email, role: 'editor' } },
    )
    expect(created.status).toBe(201)

    const revoked = await api(
      'DELETE',
      `/api/v1/pages/${pageId}/invitations/${created.body.data.invitation.id}`,
      { cookie: ownerCookie },
    )
    expect(revoked.status).toBe(204)

    const pending = await api<Envelope<{ invitations: unknown[] }>>(
      'GET',
      '/api/v1/page-invitations',
      { cookie: await loginAs(invited) },
    )
    expect(pending.body.data.invitations).toHaveLength(0)

    const memberList = await api('GET', `/api/v1/pages/${pageId}/members`, {
      cookie: collaboratorCookie,
    })
    expect(memberList.status).toBe(404)
  })

  it('rate limits invitations using the shared page-write budget', async () => {
    const owner = await createTestUser()
    const cookie = await loginAs(owner)
    const pageId = await createPage(cookie, `team-${owner.username}`)
    const seededLimit = await env.DB.prepare(
      "SELECT max_requests FROM rate_limits WHERE key = 'pages_write_user'",
    ).first<{ max_requests: number }>()
    if (!seededLimit) throw new Error('The seeded pages_write_user rate limit is missing.')
    try {
      await env.DB.prepare(
        "UPDATE rate_limits SET max_requests = 1 WHERE key = 'pages_write_user'",
      ).run()
      resetIsolateCaches()

      const first = await api('POST', `/api/v1/pages/${pageId}/invitations`, {
        cookie,
        body: { email: 'first-invite@example.com' },
      })
      const second = await api('POST', `/api/v1/pages/${pageId}/invitations`, {
        cookie,
        body: { email: 'second-invite@example.com' },
      })
      expect(first.status).toBe(201)
      expect(second.status).toBe(429)
      expect(errorOf(second).error.code).toBe('RATE_LIMITED')
    } finally {
      await env.DB.prepare(
        "UPDATE rate_limits SET max_requests = ? WHERE key = 'pages_write_user'",
      ).bind(seededLimit.max_requests).run()
      resetIsolateCaches()
    }
  })

  it('revokes pending invitations when their page is deleted', async () => {
    const owner = await createTestUser()
    const invited = await createTestUser()
    const cookie = await loginAs(owner)
    const pageId = await createPage(cookie, `team-${owner.username}`)
    const created = await api<Envelope<{ invitation: { id: string } }>>(
      'POST',
      `/api/v1/pages/${pageId}/invitations`,
      { cookie, body: { email: invited.email } },
    )

    const deleted = await api('DELETE', `/api/v1/pages/${pageId}`, { cookie })
    expect(deleted.status).toBe(204)
    const pending = await api<Envelope<{ invitations: unknown[] }>>(
      'GET',
      '/api/v1/page-invitations',
      { cookie: await loginAs(invited) },
    )
    expect(pending.body.data.invitations).toHaveLength(0)
    const invitation = await env.DB.prepare(
      'SELECT revoked_at FROM page_invitations WHERE id = ?',
    ).bind(created.body.data.invitation.id).first<{ revoked_at: number | null }>()
    expect(invitation?.revoked_at).not.toBeNull()
  })
})
