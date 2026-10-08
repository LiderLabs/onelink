import { beforeEach, describe, expect, it } from 'vitest'
import { env } from 'cloudflare:workers'
import { invalidateSettingsCache } from '../src/services/settings.service'
import { app } from '../src/app'
import { avatarWebp } from './fixtures/media'
import { api, apiBytes, createTestUser, loginAs, resetIsolateCaches, type Envelope } from './helpers'

beforeEach(resetIsolateCaches)

async function createPublishedPage(slug: string) {
  const owner = await createTestUser()
  const cookie = await loginAs(owner)
  const created = await api<Envelope<{ id: string }>>('POST', '/api/v1/pages', {
    cookie,
    body: { slug, title: 'Reported page' },
  })
  await api('POST', `/api/v1/pages/${created.body.data.id}/links`, {
    cookie,
    body: { title: 'A link', url: 'https://example.com/offer' },
  })
  await api('POST', `/api/v1/pages/${created.body.data.id}/publish`, { cookie })
  return { pageId: created.body.data.id, owner }
}

describe('public report intake', () => {
  it('stores a frozen page snapshot and suppresses repeated reports', async () => {
    const { pageId } = await createPublishedPage('reported-public-page')
    const path = '/api/v1/public/pages/reported-public-page/reports'
    const body = { category: 'spam', description: 'This page redirects to a scam.' }

    const first = await api<Envelope<{ received: boolean }>>('POST', path, { body })
    const duplicate = await api<Envelope<{ received: boolean }>>('POST', path, { body })

    expect(first.status).toBe(201)
    expect(first.body.data.received).toBe(true)
    expect(duplicate.status).toBe(200)
    expect(await env.DB.prepare('SELECT count(*) AS total FROM reports WHERE page_id=?')
      .bind(pageId).first<{ total: number }>()).toMatchObject({ total: 1 })
    const row = await env.DB.prepare('SELECT target_snapshot,status FROM reports WHERE page_id=?')
      .bind(pageId).first<{ target_snapshot: string; status: string }>()
    expect(row?.status).toBe('open')
    expect(JSON.parse(row!.target_snapshot)).toMatchObject({
      page: { slug: 'reported-public-page', title: 'Reported page' },
      links: [{ title: 'A link', url: 'https://example.com/offer' }],
    })
  })

  it('does not accept reports for an unpublished page', async () => {
    const owner = await createTestUser()
    const cookie = await loginAs(owner)
    await api('POST', '/api/v1/pages', { cookie, body: { slug: 'not-published', title: 'Draft' } })
    const response = await api('POST', '/api/v1/public/pages/not-published/reports', {
      body: { category: 'abuse' },
    })
    expect(response.status).toBe(404)
  })

  it('supports link and page-owner report targets without accepting client-supplied target ids', async () => {
    const { pageId, owner } = await createPublishedPage('reported-targets')
    const link = await env.DB.prepare('SELECT id FROM page_links WHERE page_id=? AND deleted_at IS NULL LIMIT 1')
      .bind(pageId).first<{ id: string }>()
    const path = '/api/v1/public/pages/reported-targets/reports'
    expect((await api('POST', path, {
      body: { category: 'malware', targetType: 'link', linkId: link!.id },
    })).status).toBe(201)
    expect((await api('POST', path, { body: { category: 'impersonation', targetType: 'user' } })).status).toBe(201)
    const { results } = await env.DB.prepare('SELECT target_type,target_id,page_id FROM reports ORDER BY created_at,id')
      .all<{ target_type: string; target_id: string; page_id: string }>()
    expect(results).toHaveLength(2)
    expect(results[0]).toMatchObject({ target_type: 'link', target_id: link!.id, page_id: pageId })
    expect(results[1]).toMatchObject({ target_type: 'user', target_id: owner.id, page_id: pageId })
  })
})

describe('staff report queue', () => {
  it('requires report capability and supports assignment and resolution', async () => {
    await createPublishedPage('staff-report-case')
    await api('POST', '/api/v1/public/pages/staff-report-case/reports', { body: { category: 'malware' } })

    const regularUser = await loginAs(await createTestUser())
    expect((await api('GET', '/api/v1/admin/reports', { cookie: regularUser })).status).toBe(403)

    const moderator = await createTestUser({ role: 'moderator' })
    const cookie = await loginAs(moderator)
    const queue = await api<Envelope<Array<{ id: string; status: string }>>>('GET', '/api/v1/admin/reports', { cookie })
    expect(queue.status).toBe(200)
    expect(queue.body.data).toHaveLength(1)
    const reportId = queue.body.data[0]!.id

    const assigned = await api<Envelope<Record<string, unknown>>>('POST', `/api/v1/admin/reports/${reportId}/assign`, { cookie })
    expect(assigned.status).toBe(200)
    expect(assigned.body.data).toMatchObject({ status: 'reviewing', assigned_admin_id: moderator.id })

    const resolved = await api<Envelope<Record<string, unknown>>>('POST', `/api/v1/admin/reports/${reportId}/resolve`, {
      cookie,
      body: { status: 'resolved', notes: 'Reviewed and removed the malicious link.' },
    })
    expect(resolved.status).toBe(200)
    expect(resolved.body.data).toMatchObject({ status: 'resolved', resolved_by: moderator.id })
    expect(await env.DB.prepare('SELECT action FROM report_actions WHERE report_id=? ORDER BY created_at')
      .bind(reportId).all<{ action: string }>()).toMatchObject({ results: [{ action: 'assign' }, { action: 'note' }] })
  })
})

describe('sanction appeals', () => {
  it('allows a suspended user to appeal with the revoked cookie and applies an overturn safely', async () => {
    const target = await createTestUser()
    const targetCookie = await loginAs(target)
    const moderator = await createTestUser({ role: 'moderator' })
    const moderatorCookie = await loginAs(moderator)
    await api('POST', `/api/v1/admin/users/${target.id}/suspend`, {
      cookie: moderatorCookie,
      body: { reason: 'Repeated abuse', durationHours: 48 },
    })
    const sanction = await env.DB.prepare("SELECT id FROM sanctions WHERE user_id=? AND type='suspend'")
      .bind(target.id).first<{ id: string }>()
    expect(sanction).not.toBeNull()
    expect((await api('GET', '/api/v1/auth/me', { cookie: targetCookie })).status).toBe(401)

    const submitted = await api<Envelope<{ appeal: { id: string; status: string } }>>('POST', '/api/v1/appeals', {
      cookie: targetCookie,
      body: { sanctionId: sanction!.id, message: 'This suspension was applied to the wrong account.' },
    })
    expect(submitted.status).toBe(201)
    expect(submitted.body.data.appeal.status).toBe('pending')
    expect((await apiBytes('POST', `/api/v1/appeals/${submitted.body.data.appeal.id}/evidence`, {
      cookie: targetCookie, bytes: avatarWebp(), contentType: 'image/webp',
    })).status).toBe(201)
    const mine = await api<Envelope<{ appeals: Array<{ id: string }> }>>('GET', '/api/v1/appeals/mine', { cookie: targetCookie })
    expect(mine.body.data.appeals.map((appeal) => appeal.id)).toContain(submitted.body.data.appeal.id)

    const decision = await api<Envelope<Record<string, unknown>>>(
      'POST', `/api/v1/admin/appeals/${submitted.body.data.appeal.id}/decision`, {
        cookie: moderatorCookie,
        body: { decision: 'overturn', notes: 'Evidence shows the account was misidentified.' },
      },
    )
    expect(decision.status).toBe(200)
    expect(decision.body.data).toMatchObject({ status: 'approved', decision: 'overturn' })
    expect(await env.DB.prepare('SELECT status,status_reason FROM users WHERE id=?').bind(target.id)
      .first<{ status: string; status_reason: string | null }>()).toEqual({ status: 'active', status_reason: null })
    expect(await env.DB.prepare('SELECT status FROM sanctions WHERE id=?').bind(sanction!.id)
      .first<{ status: string }>()).toEqual({ status: 'overturned' })
    expect((await api('GET', '/api/v1/auth/me', { cookie: targetCookie })).status).toBe(401)
    const evidenceResponse = await app.request(`http://localhost/api/v1/admin/appeals/${submitted.body.data.appeal.id}/evidence`,
      { headers: { cookie: moderatorCookie } }, env)
    expect(evidenceResponse.status).toBe(200)
    expect(evidenceResponse.headers.get('cache-control')).toBe('no-store')
    expect(new Uint8Array(await evidenceResponse.arrayBuffer())).toEqual(avatarWebp())
  })
})

describe('automatic review flags', () => {
  it('creates a review-only flag from configured literal keywords on publish', async () => {
    const previous = await env.DB.prepare(`SELECT key,value FROM settings
      WHERE key IN ('moderation.auto_flag_enabled','moderation.auto_flag_keywords')`)
      .all<{ key: string; value: string }>()
    await env.DB.prepare("UPDATE settings SET value='true' WHERE key='moderation.auto_flag_enabled'").run()
    await env.DB.prepare("UPDATE settings SET value='[\"credential theft\"]' WHERE key='moderation.auto_flag_keywords'").run()
    invalidateSettingsCache()
    try {
      const owner = await createTestUser()
      const cookie = await loginAs(owner)
      const page = await api<Envelope<{ id: string }>>('POST', '/api/v1/pages', {
        cookie,
        body: { slug: 'auto-flag-page', title: 'Credential theft warning' },
      })
      await api('POST', `/api/v1/pages/${page.body.data.id}/publish`, { cookie })
      await api('POST', `/api/v1/pages/${page.body.data.id}/publish`, { cookie })
      const flags = await env.DB.prepare("SELECT source,rule,status FROM content_flags WHERE page_id=?")
        .bind(page.body.data.id).all<{ source: string; rule: string; status: string }>()
      expect(flags.results).toEqual([{ source: 'auto', rule: 'credential theft', status: 'open' }])
      expect((await env.DB.prepare('SELECT status FROM users WHERE id=?').bind(owner.id)
        .first<{ status: string }>())?.status).toBe('active')
    } finally {
      for (const row of previous.results) {
        await env.DB.prepare('UPDATE settings SET value=? WHERE key=?').bind(row.value, row.key).run()
      }
      invalidateSettingsCache()
    }
  })
})

describe('content moderation', () => {
  it('hides a removed page from public reads and restores it through staff action', async () => {
    const { pageId } = await createPublishedPage('moderated-page')
    const moderator = await createTestUser({ role: 'moderator' })
    const cookie = await loginAs(moderator)
    expect((await api('GET', '/api/v1/public/pages/moderated-page')).status).toBe(200)

    const removed = await api('POST', `/api/v1/admin/content/pages/${pageId}/remove`, {
      cookie,
      body: { reason: 'Confirmed malware promotion.' },
    })
    expect(removed.status).toBe(200)
    expect((await api('GET', '/api/v1/public/pages/moderated-page')).status).toBe(404)

    const restored = await api('POST', `/api/v1/admin/content/pages/${pageId}/restore`, {
      cookie,
      body: { reason: 'The report was overturned.' },
    })
    expect(restored.status).toBe(200)
    expect((await api('GET', '/api/v1/public/pages/moderated-page')).status).toBe(200)
  })

  it('stores report evidence only in PRIVATE_BUCKET and requires staff to retrieve it', async () => {
    await createPublishedPage('report-evidence')
    await api('POST', '/api/v1/public/pages/report-evidence/reports', { body: { category: 'malware' } })
    const moderator = await createTestUser({ role: 'moderator' })
    const moderatorCookie = await loginAs(moderator)
    const queue = await api<Envelope<Array<{ id: string }>>>('GET', '/api/v1/admin/reports', { cookie: moderatorCookie })
    const reportId = queue.body.data[0]!.id
    const upload = await apiBytes<Envelope<{ id: string }>>('POST', `/api/v1/admin/reports/${reportId}/evidence`, {
      cookie: moderatorCookie, bytes: avatarWebp(), contentType: 'image/webp',
    })
    expect(upload.status).toBe(201)
    const report = await env.DB.prepare('SELECT evidence_key FROM reports WHERE id=?')
      .bind(reportId).first<{ evidence_key: string }>()
    expect(report?.evidence_key).toContain('report_evidence/')
    expect(await env.PRIVATE_BUCKET.get(report!.evidence_key)).not.toBeNull()
    expect(await env.PUBLIC_BUCKET.get(report!.evidence_key)).toBeNull()

    const privateRead = await app.request(`http://localhost/api/v1/admin/reports/${reportId}/evidence`,
      { headers: { cookie: moderatorCookie } }, env)
    expect(privateRead.status).toBe(200)
    expect(privateRead.headers.get('cache-control')).toBe('no-store')
    expect(new Uint8Array(await privateRead.arrayBuffer())).toEqual(avatarWebp())
    expect((await app.request(`http://localhost/api/v1/media/${report!.evidence_key}`, {}, env)).status).toBe(404)

    const regularUser = await loginAs(await createTestUser())
    expect((await app.request(`http://localhost/api/v1/admin/reports/${reportId}/evidence`,
      { headers: { cookie: regularUser } }, env)).status).toBe(403)
  })
})