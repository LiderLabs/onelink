import { now } from '../lib/clock'
import { MAX_LINKS_PER_PAGE_HARD_CAP, MAX_SLUG_LENGTH } from '../lib/constants'
import { badRequest, conflict, forbidden, notFound } from '../lib/errors'
import {
  hostnameOf,
  normalizeSlug,
  normalizeUrl,
  sanitizeMultiline,
  sanitizeSingleLine,
} from '../lib/http'
import { ulid } from '../lib/ids'
import { asCount } from '../lib/query'
import { auditInsertStmt } from './audit.service'
import { toApiPage, toPageLinkDto, toPublicPage } from './mappers'
import {
  getNumberSetting,
  getSettingsMap,
  reservedSlugsOf,
  SETTING_KEYS,
} from './settings.service'
import type {
  ActorInfo,
  Auditor,
  PageLinkRow,
  PageRow,
  Pagination,
} from '../types'

// ============================================================================
// Pages and page links.
//
// Ownership model: a page belongs to exactly one user, and only that user may
// read or mutate it through these routes. Missing, deleted, and foreign pages
// all answer `404 Page`, never 403, so a caller cannot probe "does this id
// belong to someone" by watching the status code change.
//
// Slugs are claimed at creation and IMMUTABLE in this slice. A slug whose page
// is deleted stays reserved (`slug_reservations`) so nobody can inherit the
// removed page's inbound links and reputation.
//
// Every mutation claims an audit entry with `targetType: 'page'` and lands the
// INSERT in the same `db.batch()` as the change — the user.service.ts contract.
// ============================================================================

export interface PageListResult {
  rows: PageRow[]
  total: number
}

export async function listOwnPages(
  db: D1Database,
  userId: string,
  pagination: Pagination,
): Promise<PageListResult> {
  const [rowsResult, countResult] = await db.batch([
    db
      .prepare(
        'SELECT * FROM pages WHERE user_id = ? AND deleted_at IS NULL ORDER BY updated_at DESC, id DESC LIMIT ? OFFSET ?',
      )
      .bind(userId, pagination.limit, pagination.offset),
    db
      .prepare('SELECT count(*) AS total FROM pages WHERE user_id = ? AND deleted_at IS NULL')
      .bind(userId),
  ])

  return {
    rows: (rowsResult?.results ?? []) as unknown as PageRow[],
    total: asCount((countResult?.results?.[0] ?? null) as { total?: unknown } | null),
  }
}

/**
 * An owned, live page — or `404 Page` when the id names nothing the caller may
 * see. This is the ONLY read path the owner routes use: it cannot leak.
 */
export async function requireOwnedPage(
  db: D1Database,
  userId: string,
  pageId: string,
): Promise<PageRow> {
  const row = await db
    .prepare('SELECT * FROM pages WHERE id = ? AND user_id = ? AND deleted_at IS NULL LIMIT 1')
    .bind(pageId, userId)
    .first<PageRow>()
  if (!row) throw notFound('Page')
  return row
}

/**
 * Policy on a not-yet-stored slug, checked after normalisation. Reserved and
 * taken slugs both refuse with 409: both mean "pick another", and callers do
 * not need to distinguish "the platform said no" from "a peer got there
 * first".
 */
async function assertSlugAvailable(db: D1Database, slug: string): Promise<void> {
  if (slug.length === 0) throw badRequest('A slug is required.')
  if (slug.length > MAX_SLUG_LENGTH) {
    throw badRequest(`Slugs must be at most ${MAX_SLUG_LENGTH} characters.`)
  }

  const settings = await getSettingsMap(db)
  if (reservedSlugsOf(settings).includes(slug)) {
    throw conflict('That slug is reserved. Try another.')
  }

  const taken = await db
    .prepare('SELECT 1 AS taken FROM pages WHERE slug = ? AND deleted_at IS NULL LIMIT 1')
    .bind(slug)
    .first<{ taken: number }>()
  if (taken) throw conflict('That slug is already taken.')

  const reserved = await db
    .prepare('SELECT 1 AS held FROM slug_reservations WHERE slug = ? AND released_at IS NULL LIMIT 1')
    .bind(slug)
    .first<{ held: number }>()
  if (reserved) throw conflict('That slug is already taken.')
}

export interface CreatePageInput {
  slug?: string | undefined
  title?: string | undefined
  bio?: string | undefined
  theme?: 'light' | 'dark' | undefined
  layout?: 'list' | 'grid' | undefined
  accentColor?: string | null | undefined
  showBranding?: boolean | undefined
}

/**
 * Creates a draft page for the caller's own account.
 *
 * `slug` is optional: when omitted the owner's (already normalised, unique)
 * username is used, so the common case needs no decision until someone picks a
 * name the platform reserved. A defaulted slug that collides answers 409
 * exactly like an explicit one; the caller picks another.
 */
export async function createPage(
  db: D1Database,
  actor: ActorInfo,
  username: string,
  input: CreatePageInput,
  auditor: Auditor,
): Promise<Record<string, unknown>> {
  const slug = normalizeSlug(input.slug === undefined ? username : input.slug)
  if (slug.length === 0) {
    throw badRequest('That slug is empty once normalised. Try another.')
  }
  await assertSlugAvailable(db, slug)

  const timestamp = now()
  const pageId = ulid()
  const title = input.title ? sanitizeSingleLine(input.title, 120) : null
  const bio = input.bio ? sanitizeMultiline(input.bio, 500) || null : null

  const entry = auditor.claim({
    action: 'page.create',
    targetType: 'page',
    targetId: pageId,
    targetLabel: slug,
    actorUserId: actor.id,
    actorRole: actor.role,
    actorLabel: actor.label,
    after: { slug, title },
  })

  await db.batch([
    db
      .prepare(
        `INSERT INTO pages (
           id, user_id, slug, title, bio, theme, layout, accent_color,
           show_branding, created_at, updated_at
         ) VALUES (?,?,?,?,?,?,?,?,?,?,?)`,
      )
      .bind(
        pageId,
        actor.id,
        slug,
        title,
        bio,
        input.theme ?? 'light',
        input.layout ?? 'list',
        input.accentColor ?? null,
        input.showBranding === false ? 0 : 1,
        timestamp,
        timestamp,
      ),
    auditInsertStmt(db, entry),
  ])

  const row = await db.prepare('SELECT * FROM pages WHERE id = ?').bind(pageId).first<PageRow>()
  if (!row) throw notFound('Page')
  return toApiPage(row, null)
}

export interface UpdatePageInput {
  title?: string | null | undefined
  bio?: string | null | undefined
  theme?: 'light' | 'dark' | undefined
  layout?: 'list' | 'grid' | undefined
  accentColor?: string | null | undefined
  showBranding?: boolean | undefined
}

export async function updatePage(
  db: D1Database,
  actor: ActorInfo,
  target: PageRow,
  input: UpdatePageInput,
  auditor: Auditor,
): Promise<Record<string, unknown>> {
  const patch: string[] = []
  const binds: unknown[] = []
  const before: Record<string, unknown> = {}
  const after: Record<string, unknown> = {}

  const setField = (column: string, value: unknown, key: string): void => {
    patch.push(`${column} = ?`)
    binds.push(value)
    before[key] = (target as unknown as Record<string, unknown>)[column] ?? null
    after[key] = value ?? null
  }

  if (input.title !== undefined) {
    const title = input.title === null ? null : sanitizeSingleLine(input.title, 120) || null
    setField('title', title, 'title')
  }
  if (input.bio !== undefined) {
    const bio = input.bio === null ? null : sanitizeMultiline(input.bio, 500) || null
    setField('bio', bio, 'bio')
  }
  if (input.theme !== undefined) setField('theme', input.theme, 'theme')
  if (input.layout !== undefined) setField('layout', input.layout, 'layout')
  if (input.accentColor !== undefined) setField('accent_color', input.accentColor, 'accentColor')
  if (input.showBranding !== undefined) {
    setField('show_branding', input.showBranding ? 1 : 0, 'showBranding')
  }

  if (patch.length === 0) return toApiPage(target, await latestRevision(db, target.id))

  const timestamp = now()
  const entry = auditor.claim({
    action: 'page.update',
    targetType: 'page',
    targetId: target.id,
    targetLabel: target.slug,
    actorUserId: actor.id,
    actorRole: actor.role,
    actorLabel: actor.label,
    before,
    after,
  })

  await db.batch([
    db
      .prepare(`UPDATE pages SET ${patch.join(', ')}, updated_at = ? WHERE id = ?`)
      .bind(...binds, timestamp, target.id),
    auditInsertStmt(db, entry),
  ])

  const row = await db.prepare('SELECT * FROM pages WHERE id = ?').bind(target.id).first<PageRow>()
  if (!row) throw notFound('Page')
  return toApiPage(row, await latestRevision(db, target.id))
}

async function latestRevision(db: D1Database, pageId: string): Promise<number | null> {
  const row = await db
    .prepare('SELECT revision FROM page_revisions WHERE page_id = ? ORDER BY revision DESC LIMIT 1')
    .bind(pageId)
    .first<{ revision: number }>()
  return row?.revision ?? null
}

export interface PageDetail {
  page: Record<string, unknown>
  links: ReturnType<typeof toPageLinkDto>[]
}

export async function getOwnedPageDetail(db: D1Database, target: PageRow): Promise<PageDetail> {
  const { results } = await db
    .prepare(
      'SELECT * FROM page_links WHERE page_id = ? AND deleted_at IS NULL ORDER BY position ASC, id ASC',
    )
    .bind(target.id)
    .all<PageLinkRow>()

  return {
    page: toApiPage(target, await latestRevision(db, target.id)),
    links: results.map(toPageLinkDto),
  }
}

export async function publishPage(
  db: D1Database,
  actor: ActorInfo,
  target: PageRow,
  auditor: Auditor,
): Promise<Record<string, unknown>> {
  if (target.moderation_status === 'removed') {
    throw forbidden('That page was removed by moderation and cannot be published.')
  }

  const timestamp = now()
  const links = await db
    .prepare(
      'SELECT * FROM page_links WHERE page_id = ? AND deleted_at IS NULL ORDER BY position ASC, id ASC',
    )
    .bind(target.id)
    .all<PageLinkRow>()

  const existing = await db
    .prepare('SELECT revision FROM page_revisions WHERE page_id = ? ORDER BY revision DESC LIMIT 1')
    .bind(target.id)
    .first<{ revision: number }>()
  const revision = (existing?.revision ?? 0) + 1

  const snapshot = JSON.stringify({
    page: toApiPage({ ...target, status: 'published', updated_at: timestamp }, revision),
    links: links.results.map(toPageLinkDto),
  })

  const entry = auditor.claim({
    action: 'page.publish',
    targetType: 'page',
    targetId: target.id,
    targetLabel: target.slug,
    actorUserId: actor.id,
    actorRole: actor.role,
    actorLabel: actor.label,
    after: { revision, linkCount: links.results.length },
  })

  await db.batch([
    db
      .prepare(
        // Publish state is the 0001 `status` column, and `first_published_at` is
        // written once — COALESCE keeps the original across republications.
        `UPDATE pages
            SET status = 'published',
                published_at = ?,
                first_published_at = COALESCE(first_published_at, ?),
                updated_at = ?
          WHERE id = ?`,
      )
      .bind(timestamp, timestamp, timestamp, target.id),
    db
      .prepare(
        // `reason` is NOT NULL and CHECKed in 0001; `created_by` is the history
        // FK, so the snapshot outlives the account that made it.
        `INSERT INTO page_revisions (id, page_id, revision, snapshot, reason, created_by, created_at)
         VALUES (?,?,?,?,?,?,?)`,
      )
      .bind(ulid(), target.id, revision, snapshot, 'publish', actor.id, timestamp),
    auditInsertStmt(db, entry),
  ])

  const row = await db.prepare('SELECT * FROM pages WHERE id = ?').bind(target.id).first<PageRow>()
  if (!row) throw notFound('Page')
  return toApiPage(row, revision)
}

export async function unpublishPage(
  db: D1Database,
  actor: ActorInfo,
  target: PageRow,
  auditor: Auditor,
): Promise<Record<string, unknown>> {
  if (target.status !== 'published') {
    return toApiPage(target, await latestRevision(db, target.id))
  }

  const timestamp = now()
  const entry = auditor.claim({
    action: 'page.unpublish',
    targetType: 'page',
    targetId: target.id,
    targetLabel: target.slug,
    actorUserId: actor.id,
    actorRole: actor.role,
    actorLabel: actor.label,
    before: { status: 'published' },
    after: { status: 'draft' },
  })

  await db.batch([
    db
      // `published_at` is cleared so the payload never claims a draft is live;
      // `first_published_at` keeps the historical date.
      .prepare('UPDATE pages SET status = ?, published_at = NULL, updated_at = ? WHERE id = ?')
      .bind('draft', timestamp, target.id),
    auditInsertStmt(db, entry),
  ])

  const row = await db.prepare('SELECT * FROM pages WHERE id = ?').bind(target.id).first<PageRow>()
  if (!row) throw notFound('Page')
  return toApiPage(row, await latestRevision(db, target.id))
}

/**
 * Soft-deletes the page and its links together, and reserves the freed slug so
 * nobody can inherit the removed page's inbound links and reputation.
 *
 * The page is never hard-deleted here — only `deleted_at` is set — so the
 * ON DELETE RESTRICT tripwires on `page_links.page_id` and the reservation's
 * `page_id` reference cannot trip.
 */
export async function deletePage(
  db: D1Database,
  actor: ActorInfo,
  target: PageRow,
  auditor: Auditor,
): Promise<void> {
  const timestamp = now()

  const entry = auditor.claim({
    action: 'page.delete',
    targetType: 'page',
    targetId: target.id,
    targetLabel: target.slug,
    actorUserId: actor.id,
    actorRole: actor.role,
    actorLabel: actor.label,
    before: { slug: target.slug, status: target.status },
  })

  await db.batch([
    db
      .prepare('UPDATE page_links SET deleted_at = ? WHERE page_id = ? AND deleted_at IS NULL')
      .bind(timestamp, target.id),
    db
      .prepare('UPDATE pages SET deleted_at = ?, deleted_by = ? WHERE id = ?')
      .bind(timestamp, actor.id, target.id),
    db
      .prepare(
        `INSERT INTO slug_reservations (id, slug, page_id, reserved_by, reason, created_at)
         VALUES (?,?,?,?,?,?)`,
      )
      .bind(ulid(), target.slug, target.id, actor.id, 'page_deleted', timestamp),
    auditInsertStmt(db, entry),
  ])
}

export async function maxLinksPerPage(db: D1Database): Promise<number> {
  const configured = await getNumberSetting(db, SETTING_KEYS.maxLinksPerPage, 50)
  return Math.min(Math.max(Math.trunc(configured), 1), MAX_LINKS_PER_PAGE_HARD_CAP)
}

export interface CreatePageLinkInput {
  title: string
  url: string
  description?: string | null | undefined
  icon?: string | null | undefined
  isVisible?: boolean | undefined
  startsAt?: number | null | undefined
  endsAt?: number | null | undefined
}

export async function createPageLink(
  db: D1Database,
  actor: ActorInfo,
  target: PageRow,
  input: CreatePageLinkInput,
  auditor: Auditor,
): Promise<Record<string, unknown>> {
  const countRow = await db
    .prepare('SELECT count(*) AS total FROM page_links WHERE page_id = ? AND deleted_at IS NULL')
    .bind(target.id)
    .first<{ total?: unknown }>()
  const limit = await maxLinksPerPage(db)
  if (asCount(countRow) >= limit) {
    throw badRequest(`That page already holds the maximum of ${limit} links.`)
  }

  const url = normalizeUrl(input.url)
  if (!url) throw badRequest('That URL is not a usable http(s) address.')
  const title = sanitizeSingleLine(input.title, 140)
  if (title.length === 0) throw badRequest('A link title is required.')
  const description =
    input.description == null ? null : sanitizeMultiline(input.description, 280) || null
  const icon = input.icon == null ? null : sanitizeSingleLine(input.icon, 80) || null

  const top = await db
    .prepare(
      'SELECT COALESCE(MAX(position), -1) AS top FROM page_links WHERE page_id = ? AND deleted_at IS NULL',
    )
    .bind(target.id)
    .first<{ top: number }>()
  const position = (top?.top ?? -1) + 1

  const timestamp = now()
  const linkId = ulid()

  const entry = auditor.claim({
    action: 'page.link.create',
    targetType: 'page',
    targetId: target.id,
    targetLabel: target.slug,
    actorUserId: actor.id,
    actorRole: actor.role,
    actorLabel: actor.label,
    metadata: { linkId, position },
    after: { title, url },
  })

  await db.batch([
    db
      .prepare(
        `INSERT INTO page_links (
           id, page_id, title, url, domain, description, icon, position,
           is_visible, starts_at, ends_at, created_at, updated_at
         ) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)`,
      )
      .bind(
        linkId,
        target.id,
        title,
        url,
        hostnameOf(url),
        description,
        icon,
        position,
        input.isVisible === false ? 0 : 1,
        input.startsAt ?? null,
        input.endsAt ?? null,
        timestamp,
        timestamp,
      ),
    auditInsertStmt(db, entry),
  ])

  const row = await db
    .prepare('SELECT * FROM page_links WHERE id = ?')
    .bind(linkId)
    .first<PageLinkRow>()
  if (!row) throw notFound('Page link')
  return toPageLinkDto(row)
}

export async function requireOwnedPageLink(
  db: D1Database,
  target: PageRow,
  linkId: string,
): Promise<PageLinkRow> {
  const row = await db
    .prepare('SELECT * FROM page_links WHERE id = ? AND page_id = ? AND deleted_at IS NULL LIMIT 1')
    .bind(linkId, target.id)
    .first<PageLinkRow>()
  if (!row) throw notFound('Page link')
  return row
}

export interface UpdatePageLinkInput {
  title?: string | undefined
  url?: string | undefined
  description?: string | null | undefined
  icon?: string | null | undefined
  isVisible?: boolean | undefined
  startsAt?: number | null | undefined
  endsAt?: number | null | undefined
}

export async function updatePageLink(
  db: D1Database,
  actor: ActorInfo,
  target: PageRow,
  link: PageLinkRow,
  input: UpdatePageLinkInput,
  auditor: Auditor,
): Promise<Record<string, unknown>> {
  const patch: string[] = []
  const binds: unknown[] = []
  const before: Record<string, unknown> = {}
  const after: Record<string, unknown> = {}

  const setField = (column: string, value: unknown, key: string): void => {
    patch.push(`${column} = ?`)
    binds.push(value)
    before[key] = (link as unknown as Record<string, unknown>)[column] ?? null
    after[key] = value ?? null
  }

  if (input.title !== undefined) {
    const title = sanitizeSingleLine(input.title, 140)
    if (title.length === 0) throw badRequest('A link title is required.')
    setField('title', title, 'title')
  }
  if (input.url !== undefined) {
    const url = normalizeUrl(input.url)
    if (!url) throw badRequest('That URL is not a usable http(s) address.')
    setField('url', url, 'url')
    setField('domain', hostnameOf(url), 'domain')
  }
  if (input.description !== undefined) {
    const description = input.description === null ? null : sanitizeMultiline(input.description, 280) || null
    setField('description', description, 'description')
  }
  if (input.icon !== undefined) {
    const icon = input.icon === null ? null : sanitizeSingleLine(input.icon, 80) || null
    setField('icon', icon, 'icon')
  }
  if (input.isVisible !== undefined) setField('is_visible', input.isVisible ? 1 : 0, 'isVisible')
  if (input.startsAt !== undefined) setField('starts_at', input.startsAt, 'startsAt')
  if (input.endsAt !== undefined) setField('ends_at', input.endsAt, 'endsAt')

  if (patch.length === 0) return toPageLinkDto(link)

  const timestamp = now()
  const entry = auditor.claim({
    action: 'page.link.update',
    targetType: 'page',
    targetId: target.id,
    targetLabel: target.slug,
    actorUserId: actor.id,
    actorRole: actor.role,
    actorLabel: actor.label,
    metadata: { linkId: link.id },
    before,
    after,
  })

  await db.batch([
    db
      .prepare(`UPDATE page_links SET ${patch.join(', ')}, updated_at = ? WHERE id = ?`)
      .bind(...binds, timestamp, link.id),
    auditInsertStmt(db, entry),
  ])

  const row = await db
    .prepare('SELECT * FROM page_links WHERE id = ?')
    .bind(link.id)
    .first<PageLinkRow>()
  if (!row) throw notFound('Page link')
  return toPageLinkDto(row)
}

export async function deletePageLink(
  db: D1Database,
  actor: ActorInfo,
  target: PageRow,
  link: PageLinkRow,
  auditor: Auditor,
): Promise<void> {
  const timestamp = now()
  const entry = auditor.claim({
    action: 'page.link.delete',
    targetType: 'page',
    targetId: target.id,
    targetLabel: target.slug,
    actorUserId: actor.id,
    actorRole: actor.role,
    actorLabel: actor.label,
    metadata: { linkId: link.id },
    before: { title: link.title, url: link.url },
  })

  await db.batch([
    db.prepare('UPDATE page_links SET deleted_at = ? WHERE id = ?').bind(timestamp, link.id),
    auditInsertStmt(db, entry),
  ])
}

/**
 * Replaces link ordering explicitly. The body must name every live link
 * exactly once — a partial list would silently drop the unmentioned links from
 * the ordering, and positions are dense by construction so there is nothing
 * safe to merge a subset against.
 */
export async function reorderPageLinks(
  db: D1Database,
  actor: ActorInfo,
  target: PageRow,
  linkIds: readonly string[],
  auditor: Auditor,
): Promise<ReturnType<typeof toPageLinkDto>[]> {
  if (new Set(linkIds).size !== linkIds.length) {
    throw badRequest('Link ids must not repeat.')
  }

  const { results } = await db
    .prepare('SELECT id FROM page_links WHERE page_id = ? AND deleted_at IS NULL')
    .bind(target.id)
    .all<{ id: string }>()
  const live = new Set(results.map((row) => row.id))

  if (linkIds.length !== live.size || !linkIds.every((id) => live.has(id))) {
    throw badRequest('The ordering must name every link on this page exactly once.')
  }

  const timestamp = now()
  const entry = auditor.claim({
    action: 'page.links.reorder',
    targetType: 'page',
    targetId: target.id,
    targetLabel: target.slug,
    actorUserId: actor.id,
    actorRole: actor.role,
    actorLabel: actor.label,
    after: { order: [...linkIds] },
  })

  const statements: D1PreparedStatement[] = linkIds.map((id, index) =>
    db.prepare('UPDATE page_links SET position = ?, updated_at = ? WHERE id = ?').bind(index, timestamp, id),
  )
  statements.push(auditInsertStmt(db, entry))
  await db.batch(statements)

  const ordered = await db
    .prepare(
      'SELECT * FROM page_links WHERE page_id = ? AND deleted_at IS NULL ORDER BY position ASC, id ASC',
    )
    .bind(target.id)
    .all<PageLinkRow>()
  return ordered.results.map(toPageLinkDto)
}

// ------------------------------------------------------------------ public --

export interface PublicPageResult {
  page: Record<string, unknown>
  links: ReturnType<typeof toPageLinkDto>[]
}

/**
 * The anonymous read path. Every visibility rule lives here, in one place:
 *
 *   - slug normalised, page live
 *   - published, and not removed by moderation
 *   - owner usable (active) and not deleted
 *   - links visible, live, and inside their schedule window
 *
 * Anything else answers `404 Page` — the same code an unknown slug gets — so
 * the response reveals nothing about why a page is unreachable.
 */
export async function getPublicPage(db: D1Database, rawSlug: string): Promise<PublicPageResult> {
  const slug = normalizeSlug(rawSlug)
  if (slug.length === 0) throw notFound('Page')

  const page = await db
    .prepare('SELECT * FROM pages WHERE slug = ? AND deleted_at IS NULL LIMIT 1')
    .bind(slug)
    .first<PageRow>()
  if (!page || page.status !== 'published' || page.moderation_status !== 'visible') {
    throw notFound('Page')
  }

  const owner = await db
    .prepare(
      'SELECT id, username, display_name, status, deleted_at FROM users WHERE id = ? LIMIT 1',
    )
    .bind(page.user_id)
    .first<{
      id: string
      username: string
      display_name: string | null
      status: string
      deleted_at: number | null
    }>()
  if (!owner || owner.status !== 'active' || owner.deleted_at !== null) {
    throw notFound('Page')
  }

  const timestamp = now()
  const { results } = await db
    .prepare(
      `SELECT * FROM page_links
         WHERE page_id = ? AND deleted_at IS NULL AND is_visible = 1
           AND (starts_at IS NULL OR starts_at <= ?)
           AND (ends_at IS NULL OR ends_at >= ?)
         ORDER BY position ASC, id ASC`,
    )
    .bind(page.id, timestamp, timestamp)
    .all<PageLinkRow>()

  const displayName = owner.display_name?.trim() ? owner.display_name : owner.username
  return {
    page: toPublicPage(page, owner.username, displayName, results.map(toPageLinkDto)),
    links: results.map(toPageLinkDto),
  }
}
