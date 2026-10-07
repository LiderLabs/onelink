import { beforeEach, describe, expect, it } from 'vitest'
import { env } from 'cloudflare:workers'
import { now } from '../src/lib/clock'
import { ulid } from '../src/lib/ids'
import { toPageLinkDto } from '../src/services/mappers'
import { purgeTrashedPageLinks } from '../src/services/page.service'
import {
  api,
  countRows,
  createTestUser,
  loginAs,
  resetIsolateCaches,
  setSettingValue,
  type Envelope,
} from './helpers'

beforeEach(resetIsolateCaches)

interface PageDto {
  id: string
  slug: string
}

interface LinkDto {
  id: string
  title: string
  url: string
  groupId: string | null
  openInNewTab: boolean
  thumbnailKey: string | null
  status: 'scheduled' | 'active' | 'expired'
}

interface GroupDto {
  id: string
  name: string
  position: number
}

async function createPage(cookie: string, slug = 'links-v2') {
  return api<Envelope<PageDto>>('POST', '/api/v1/pages', { cookie, body: { slug } })
}

async function createLink(cookie: string, pageId: string, title: string, extra: Record<string, unknown> = {}) {
  return api<Envelope<LinkDto>>('POST', `/api/v1/pages/${pageId}/links`, {
    cookie,
    body: { title, url: `https://example.com/${title.toLowerCase()}`, ...extra },
  })
}

describe('R1.5 groups and link fields', () => {
  it('round-trips link fields and enforces page-image ownership', async () => {
    const owner = await createTestUser()
    const other = await createTestUser()
    const cookie = await loginAs(owner)
    const page = await createPage(cookie)
    const group = await api<Envelope<GroupDto>>('POST', `/api/v1/pages/${page.body.data.id}/groups`, {
      cookie,
      body: { name: 'Featured' },
    })
    expect(group.status).toBe(201)

    const key = `page-images/${owner.id}/${ulid()}.webp`
    await env.DB.prepare(
      `INSERT INTO media_assets
        (id, owner_user_id, r2_key, bucket, kind, mime, size_bytes, width, height, uploaded_by, status, created_at)
       VALUES (?, ?, ?, 'public', 'page_image', 'image/webp', 100, 10, 10, ?, 'active', ?)`,
    ).bind(ulid(), owner.id, key, owner.id, now()).run()
    const foreignKey = `page-images/${other.id}/${ulid()}.webp`
    await env.DB.prepare(
      `INSERT INTO media_assets
        (id, owner_user_id, r2_key, bucket, kind, mime, size_bytes, width, height, uploaded_by, status, created_at)
       VALUES (?, ?, ?, 'public', 'page_image', 'image/webp', 100, 10, 10, ?, 'active', ?)`,
    ).bind(ulid(), other.id, foreignKey, other.id, now()).run()

    const otherPage = await createPage(await loginAs(other), 'another-links-page')
    const foreignGroup = await api<Envelope<GroupDto>>(
      'POST', `/api/v1/pages/${otherPage.body.data.id}/groups`, { cookie: await loginAs(other), body: { name: 'Foreign' } },
    )
    const wrongGroup = await createLink(cookie, page.body.data.id, 'Foreign Group', {
      groupId: foreignGroup.body.data.id,
    })
    expect(wrongGroup.status).toBe(404)

    const link = await createLink(cookie, page.body.data.id, 'Featured Link', {
      groupId: group.body.data.id,
      openInNewTab: true,
      thumbnailKey: key,
    })
    expect(link.status).toBe(201)
    expect(link.body.data).toMatchObject({
      groupId: group.body.data.id,
      openInNewTab: true,
      thumbnailKey: key,
      status: 'active',
    })

    const foreignImage = await createLink(cookie, page.body.data.id, 'Foreign Image', {
      thumbnailKey: foreignKey,
    })
    expect(foreignImage.status).toBe(404)

    const updated = await api<Envelope<LinkDto>>(
      'PATCH',
      `/api/v1/pages/${page.body.data.id}/links/${link.body.data.id}`,
      { cookie, body: { groupId: null, openInNewTab: false, thumbnailKey: null } },
    )
    expect(updated.body.data).toMatchObject({ groupId: null, openInNewTab: false, thumbnailKey: null })

    const deleted = await api('DELETE', `/api/v1/pages/${page.body.data.id}/groups/${group.body.data.id}`, { cookie })
    expect(deleted.status).toBe(204)
    const row = await env.DB.prepare('SELECT group_id FROM page_links WHERE id = ?')
      .bind(link.body.data.id).first<{ group_id: string | null }>()
    expect(row?.group_id).toBeNull()
  })

  it('supports group CRUD and full-list reordering', async () => {
    const user = await createTestUser()
    const cookie = await loginAs(user)
    const page = await createPage(cookie)
    const first = await api<Envelope<GroupDto>>('POST', `/api/v1/pages/${page.body.data.id}/groups`, {
      cookie, body: { name: 'First' },
    })
    const second = await api<Envelope<GroupDto>>('POST', `/api/v1/pages/${page.body.data.id}/groups`, {
      cookie, body: { name: 'Second' },
    })
    expect(first.body.data.position).toBe(0)
    expect(second.body.data.position).toBe(1)

    const renamed = await api<Envelope<GroupDto>>(
      'PATCH',
      `/api/v1/pages/${page.body.data.id}/groups/${first.body.data.id}`,
      { cookie, body: { name: 'Renamed' } },
    )
    expect(renamed.body.data.name).toBe('Renamed')

    const ordered = await api<Envelope<{ groups: GroupDto[] }>>(
      'PUT',
      `/api/v1/pages/${page.body.data.id}/groups/order`,
      { cookie, body: { groupIds: [second.body.data.id, first.body.data.id] } },
    )
    expect(ordered.body.data.groups.map(group => group.id)).toEqual([second.body.data.id, first.body.data.id])

    const partial = await api('PUT', `/api/v1/pages/${page.body.data.id}/groups/order`, {
      cookie, body: { groupIds: [first.body.data.id] },
    })
    expect(partial.status).toBe(400)
  })

  it('maps pre-R1.5 rows using the migration defaults', async () => {
    const user = await createTestUser()
    const cookie = await loginAs(user)
    const page = await createPage(cookie)
    const id = ulid()
    await env.DB.prepare(
      `INSERT INTO page_links (id, page_id, position, title, url, created_at, updated_at)
       VALUES (?, ?, 0, 'Legacy', 'https://example.com/legacy', ?, ?)`,
    ).bind(id, page.body.data.id, now(), now()).run()

    const listed = await api<Envelope<{ links: LinkDto[] }>>(
      'GET', `/api/v1/pages/${page.body.data.id}/links`, { cookie },
    )
    expect(listed.body.data.links.find(link => link.id === id)).toMatchObject({
      groupId: null,
      openInNewTab: false,
      thumbnailKey: null,
      status: 'active',
    })
  })

  it('bulk operations are all-or-nothing and audit each affected link', async () => {
    const user = await createTestUser()
    const cookie = await loginAs(user)
    const page = await createPage(cookie)
    const first = await createLink(cookie, page.body.data.id, 'One')
    const second = await createLink(cookie, page.body.data.id, 'Two')
    const group = await api<Envelope<GroupDto>>('POST', `/api/v1/pages/${page.body.data.id}/groups`, {
      cookie, body: { name: 'Group' },
    })

    const invalid = await api('POST', `/api/v1/pages/${page.body.data.id}/links/bulk`, {
      cookie, body: { ids: [first.body.data.id, ulid()], action: 'hide' },
    })
    expect(invalid.status).toBe(400)
    expect(await countRows('SELECT COUNT(*) AS total FROM page_links WHERE is_visible = 0')).toBe(0)

    const moved = await api<Envelope<{ links: LinkDto[] }>>(
      'POST',
      `/api/v1/pages/${page.body.data.id}/links/bulk`,
      { cookie, body: { ids: [first.body.data.id, second.body.data.id], action: 'move', groupId: group.body.data.id } },
    )
    expect(moved.status).toBe(200)
    expect(moved.body.data.links.every(link => link.groupId === group.body.data.id)).toBe(true)

    const hidden = await api('POST', `/api/v1/pages/${page.body.data.id}/links/bulk`, {
      cookie, body: { ids: [first.body.data.id, second.body.data.id], action: 'hide' },
    })
    expect(hidden.status).toBe(200)
    expect(await countRows(
      `SELECT COUNT(*) AS total FROM audit_logs WHERE action = 'page.link.bulk_hide' AND target_id = ?`,
      page.body.data.id,
    )).toBe(2)

    const shown = await api('POST', `/api/v1/pages/${page.body.data.id}/links/bulk`, {
      cookie, body: { ids: [first.body.data.id], action: 'show' },
    })
    expect(shown.status).toBe(200)
    const trashed = await api<Envelope<{ links: LinkDto[] }>>('POST', `/api/v1/pages/${page.body.data.id}/links/bulk`, {
      cookie, body: { ids: [first.body.data.id], action: 'delete' },
    })
    expect(trashed.body.data.links).toHaveLength(1)
  })

  it('lists trashed links, restores them, and purges expired trash by policy', async () => {
    const user = await createTestUser()
    const cookie = await loginAs(user)
    const page = await createPage(cookie)
    const link = await createLink(cookie, page.body.data.id, 'Trash me')
    await api('DELETE', `/api/v1/pages/${page.body.data.id}/links/${link.body.data.id}`, { cookie })

    const live = await api<Envelope<{ links: LinkDto[] }>>('GET', `/api/v1/pages/${page.body.data.id}/links`, { cookie })
    const trash = await api<Envelope<{ links: LinkDto[] }>>(
      'GET', `/api/v1/pages/${page.body.data.id}/links?trashed=1`, { cookie },
    )
    expect(live.body.data.links).toHaveLength(0)
    expect(trash.body.data.links).toHaveLength(1)

    const restored = await api<Envelope<LinkDto>>(
      'POST',
      `/api/v1/pages/${page.body.data.id}/links/${link.body.data.id}/restore`,
      { cookie },
    )
    expect(restored.status).toBe(200)
    const emptyTrash = await api<Envelope<{ links: LinkDto[] }>>(
      'GET', `/api/v1/pages/${page.body.data.id}/links?trashed=1`, { cookie },
    )
    expect(emptyTrash.body.data.links).toHaveLength(0)

    await api('DELETE', `/api/v1/pages/${page.body.data.id}/links/${link.body.data.id}`, { cookie })
    const recentLink = await createLink(cookie, page.body.data.id, 'Recent trash')
    await api('DELETE', `/api/v1/pages/${page.body.data.id}/links/${recentLink.body.data.id}`, { cookie })
    const maintenanceAt = now()
    const cutoff = maintenanceAt - 30 * 24 * 60 * 60 * 1000
    await env.DB.prepare('UPDATE page_links SET deleted_at = ? WHERE id = ?')
      .bind(cutoff, link.body.data.id).run()
    await env.DB.prepare('UPDATE page_links SET deleted_at = ? WHERE id = ?')
      .bind(cutoff + 1, recentLink.body.data.id).run()
    await setSettingValue('content.trash_retention_days', '30')
    expect(await purgeTrashedPageLinks(env.DB, maintenanceAt)).toBe(1)
    expect(await countRows('SELECT COUNT(*) AS total FROM page_links WHERE id = ?', link.body.data.id)).toBe(0)
    expect(await countRows('SELECT COUNT(*) AS total FROM page_links WHERE id = ?', recentLink.body.data.id)).toBe(1)
  })

  it('applies the pages write limit to bulk operations', async () => {
    const user = await createTestUser()
    const cookie = await loginAs(user)
    const page = await createPage(cookie)
    const link = await createLink(cookie, page.body.data.id, 'Limit')
    await env.DB.prepare(
      `UPDATE rate_limits SET max_requests = 1 WHERE key = 'pages_write_user'`,
    ).run()
    resetIsolateCaches()

    const first = await api('POST', `/api/v1/pages/${page.body.data.id}/links/bulk`, {
      cookie, body: { ids: [link.body.data.id], action: 'hide' },
    })
    const second = await api('POST', `/api/v1/pages/${page.body.data.id}/links/bulk`, {
      cookie, body: { ids: [link.body.data.id], action: 'show' },
    })
    expect(first.status).toBe(200)
    expect(second.status).toBe(429)
  })
})

describe('derived link schedule status', () => {
  const row = {
    id: 'link', page_id: 'page', title: 'Scheduled', url: 'https://example.com',
    domain: 'example.com', icon: null, description: null, position: 0, is_visible: 1,
    starts_at: 1_000, ends_at: 2_000, group_id: null, open_in_new_tab: 0,
    thumbnail_key: null, clicks: 0, created_at: 0, updated_at: 0, deleted_at: null,
  }

  it('uses inclusive start/end boundaries and marks links outside the window', () => {
    expect(toPageLinkDto(row, 999).status).toBe('scheduled')
    expect(toPageLinkDto(row, 1_000).status).toBe('active')
    expect(toPageLinkDto(row, 2_000).status).toBe('active')
    expect(toPageLinkDto(row, 2_001).status).toBe('expired')
  })
})
