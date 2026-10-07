import { now } from '../lib/clock'
import { DAY, MAX_LINKS_PER_PAGE_HARD_CAP, MAX_SLUG_LENGTH } from '../lib/constants'
import { badRequest, conflict, notFound } from '../lib/errors'
import {
  hostnameOf,
  normalizeSlug,
  normalizeUrl,
  sanitizeMultiline,
  sanitizeSingleLine,
} from '../lib/http'
import { ulid } from '../lib/ids'
import { PAGE_IMAGE_KEY_PATTERN } from '../lib/media'
import { asCount } from '../lib/query'
import { auditInsertStmt } from './audit.service'
import { toApiPage, toPageLinkDto } from './mappers'
import { ownerPageDto, publishDraft, readPageDraft } from './page-draft.service'
import { renderPublicPage } from './public-page.service'
import {
  getNumberSetting,
  getSettingsMap,
  reservedSlugsOf,
  SETTING_KEYS,
} from './settings.service'
import type {
  ActorInfo,
  Auditor,
  LinkGroupRow,
  PageLinkRow,
  PageRow,
} from '../types'

// ============================================================================
// Pages and page links.
//
// Ownership model: a page belongs to exactly one user, and only that user may
// read or mutate it through these routes. Missing, deleted, and foreign pages
// all answer `404 Page`, never 403, so a caller cannot probe "does this id
// belong to someone" by watching the status code change.
//
// Every "may this actor reach this page?" question is answered in
// `page-access.service.ts` (R1.0): this file receives a row it is already
// allowed to act on and never decides access itself.
//
// Slugs are claimed at creation and can be renamed by their owner (R1.4). Both
// deleted pages and released rename addresses stay reserved so nobody can
// inherit inbound links or reputation.
//
// Every mutation claims an audit entry with `targetType: 'page'` and lands the
// INSERT in the same `db.batch()` as the change — the user.service.ts contract.
// ============================================================================

/**
 * Listing and single-page access moved to `page-access.service.ts` (R1.0) —
 * `listAccessiblePages`, `requirePageAccess`, `requirePageLinkAccess` — so the
 * predicate that decides "reachable" has exactly one home.
 */

/**
 * The value of `pages.content_revision` before a page's first publish.
 *
 * The column is `INTEGER NOT NULL DEFAULT 1` in 0001 and nothing ever wrote it,
 * so it sat at 1 forever and could not be trusted (R1.0). Publishing now copies
 * the revision it writes into `page_revisions` into this column, and a page
 * that has never been published is stamped 0 — the only value that can mean "no
 * revision yet" without inventing a plausible-looking `1` for a draft.
 */
const NEVER_PUBLISHED = 0

/**
 * Policy on a not-yet-stored slug, checked after normalisation. Reserved and
 * taken slugs both refuse with 409: both mean "pick another", and callers do
 * not need to distinguish "the platform said no" from "a peer got there
 * first".
 */
// Exported (R1.0) because R1.4's slug rename applies exactly this policy to a
// page's CURRENT slug rather than a proposed one; a second copy of these rules
// would drift the moment one of them changed.
export type SlugAvailabilityReason = 'reserved' | 'taken' | 'reservation'

export interface SlugAvailability {
  slug: string
  available: boolean
  reason: SlugAvailabilityReason | null
}

export async function checkSlugAvailability(
  db: D1Database,
  slug: string,
  exceptPageId?: string,
): Promise<SlugAvailability> {
  if (slug.length === 0) throw badRequest('A slug is required.')
  if (slug.length > MAX_SLUG_LENGTH) {
    throw badRequest(`Slugs must be at most ${MAX_SLUG_LENGTH} characters.`)
  }

  const settings = await getSettingsMap(db)
  if (reservedSlugsOf(settings).includes(slug)) {
    return { slug, available: false, reason: 'reserved' }
  }

  const taken = await db
    .prepare('SELECT 1 AS taken FROM pages WHERE slug = ? AND deleted_at IS NULL AND id IS NOT ? LIMIT 1')
    .bind(slug, exceptPageId ?? null)
    .first<{ taken: number }>()
  if (taken) return { slug, available: false, reason: 'taken' }

  const reserved = await db
    .prepare('SELECT 1 AS held FROM slug_reservations WHERE slug = ? AND released_at IS NULL LIMIT 1')
    .bind(slug)
    .first<{ held: number }>()
  if (reserved) return { slug, available: false, reason: 'reservation' }

  return { slug, available: true, reason: null }
}

export async function assertSlugAvailable(
  db: D1Database,
  slug: string,
  exceptPageId?: string,
): Promise<void> {
  const availability = await checkSlugAvailability(db, slug, exceptPageId)
  if (availability.reason === 'reserved') throw conflict('That slug is reserved. Try another.')
  if (availability.reason) throw conflict('That slug is already taken.')
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
           show_branding, content_revision, created_at, updated_at
         ) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`,
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
        // A brand-new page has published nothing, so the row says so rather
        // than inheriting the column's `DEFAULT 1` (R1.0).
        NEVER_PUBLISHED,
        timestamp,
        timestamp,
      ),
    auditInsertStmt(db, entry),
  ])

  const row = await db.prepare('SELECT * FROM pages WHERE id = ?').bind(pageId).first<PageRow>()
  if (!row) throw notFound('Page')
  return ownerPageDto(db, row)
}

export interface UpdatePageInput {
  slug?: string | undefined
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
  const nextSlug = input.slug === undefined ? undefined : normalizeSlug(input.slug)
  if (nextSlug !== undefined && nextSlug.length === 0) {
    throw badRequest('That slug is empty once normalised. Try another.')
  }
  if (nextSlug !== undefined && nextSlug !== target.slug) {
    await assertSlugAvailable(db, nextSlug, target.id)
    patch.push('slug = ?')
    binds.push(nextSlug)
    before.slug = target.slug
    after.slug = nextSlug
  }

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

  if (patch.length === 0) return ownerPageDto(db, target)

  const timestamp = now()
  const slugChanged = nextSlug !== undefined && nextSlug !== target.slug
  const entry = auditor.claim({
    action: slugChanged ? 'page.slug_change' : 'page.update',
    targetType: 'page',
    targetId: target.id,
    targetLabel: target.slug,
    actorUserId: actor.id,
    actorRole: actor.role,
    actorLabel: actor.label,
    before,
    after,
  })

  const update = db
    .prepare(
      `UPDATE pages SET ${patch.join(', ')}, updated_at = ?
        WHERE id = ? AND deleted_at IS NULL
          AND (? IS NULL OR (
            NOT EXISTS (SELECT 1 FROM pages WHERE slug = ? AND deleted_at IS NULL AND id != ?)
            AND NOT EXISTS (SELECT 1 FROM slug_reservations WHERE slug = ? AND released_at IS NULL)
          ))`,
    )
    .bind(
      ...binds,
      timestamp,
      target.id,
      slugChanged ? nextSlug! : null,
      slugChanged ? nextSlug! : null,
      target.id,
      slugChanged ? nextSlug! : null,
    )

  if (slugChanged) {
    await db.batch([
      update,
      auditInsertStmt(db, entry, true),
      db
        .prepare(
          `INSERT INTO slug_reservations (id, slug, page_id, reserved_by, reason, created_at)
           SELECT ?, ?, ?, ?, 'page_renamed', ? WHERE changes() = 1`,
        )
        .bind(ulid(), target.slug, target.id, actor.id, timestamp),
    ])
  } else {
    await db.batch([update, auditInsertStmt(db, entry, true)])
  }

  const row = await db.prepare('SELECT * FROM pages WHERE id = ?').bind(target.id).first<PageRow>()
  if (!row) throw notFound('Page')
  if (slugChanged && row.slug !== nextSlug) throw conflict('That slug is no longer available.')
  return ownerPageDto(db, row)
}

/**
 * The revision `row` is currently showing, read from the page row itself.
 *
 * `0` means the page has never been published, which the API reports as
 * `revision: null`. Unpublishing deliberately leaves the value alone: the page
 * still has a last-published revision, it is simply not live.
 */
function revisionOfPage(row: PageRow): number | null {
  return row.content_revision > NEVER_PUBLISHED ? row.content_revision : null
}

/**
 * A page row as the OWNER sees it (R1.1).
 *
 * `GET /pages/mine` (the listing) and `GET /pages/:id` (the single read) both go
 * through here, so the two can never disagree about a field name or about how a
 * revision is reported — which is exactly what happened while `/mine` returned
 * raw `PageRow` rows and leaked `user_id`, `deleted_at` and `content_revision`.
 *
 * `Record<string, unknown>` rather than an interface because the DTO shape *is*
 * `toApiPage`, and a second hand-maintained interface for it is a thing that
 * drifts without failing.
 */
export function toOwnerPageDto(row: PageRow): Record<string, unknown> {
  return { ...toApiPage(row, revisionOfPage(row)), unpublishedChanges: false }
}

/**
 * Cross-check only, and exported for exactly that reason (R1.0): the API now
 * reads `pages.content_revision`, while `page_revisions` is the ledger that
 * value is copied from. A test asserts the two agree after a publish, which is
 * what keeps the denormalised column honest instead of dead.
 */
export async function latestRevision(db: D1Database, pageId: string): Promise<number | null> {
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
    page: await ownerPageDto(db, target),
    links: results.map(toPageLinkDto),
  }
}

export async function publishPage(
  db: D1Database,
  actor: ActorInfo,
  target: PageRow,
  auditor: Auditor,
): Promise<Record<string, unknown>> {
  return publishDraft(db, actor, target, auditor)
}

export async function unpublishPage(
  db: D1Database,
  actor: ActorInfo,
  target: PageRow,
  auditor: Auditor,
): Promise<Record<string, unknown>> {
  if (target.status !== 'published') {
    return toApiPage(target, revisionOfPage(target))
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
      // `first_published_at` keeps the historical date and `content_revision`
      // is left untouched for the same reason — the page still has a
      // last-published revision, it is simply not live (R1.0).
      .prepare('UPDATE pages SET status = ?, published_at = NULL, updated_at = ? WHERE id = ?')
      .bind('draft', timestamp, target.id),
    db.prepare('DELETE FROM page_drafts WHERE page_id = ?').bind(target.id),
    auditInsertStmt(db, entry),
  ])

  const row = await db.prepare('SELECT * FROM pages WHERE id = ?').bind(target.id).first<PageRow>()
  if (!row) throw notFound('Page')
  return toApiPage(row, revisionOfPage(row))
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
      .prepare(
        `UPDATE page_invitations SET revoked_at = ?
          WHERE page_id = ? AND accepted_at IS NULL AND revoked_at IS NULL`,
      )
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
  groupId?: string | null | undefined
  openInNewTab?: boolean | undefined
  thumbnailKey?: string | null | undefined
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
  await assertLinkGroup(db, target.id, input.groupId ?? null)
  await assertOwnedPageImage(db, actor.id, input.thumbnailKey ?? null)

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
           is_visible, starts_at, ends_at, group_id, open_in_new_tab, thumbnail_key,
           created_at, updated_at
         ) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
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
        input.groupId ?? null,
        input.openInNewTab === true ? 1 : 0,
        input.thumbnailKey ?? null,
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

export interface UpdatePageLinkInput {
  title?: string | undefined
  url?: string | undefined
  description?: string | null | undefined
  icon?: string | null | undefined
  isVisible?: boolean | undefined
  groupId?: string | null | undefined
  openInNewTab?: boolean | undefined
  thumbnailKey?: string | null | undefined
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
  if (input.groupId !== undefined) {
    await assertLinkGroup(db, target.id, input.groupId)
    setField('group_id', input.groupId, 'groupId')
  }
  if (input.openInNewTab !== undefined) {
    setField('open_in_new_tab', input.openInNewTab ? 1 : 0, 'openInNewTab')
  }
  if (input.thumbnailKey !== undefined) {
    await assertOwnedPageImage(db, actor.id, input.thumbnailKey)
    setField('thumbnail_key', input.thumbnailKey, 'thumbnailKey')
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
      .prepare(`UPDATE page_links SET ${patch.join(', ')}, updated_at = ? WHERE id = ? AND page_id = ? AND deleted_at IS NULL`)
      .bind(...binds, timestamp, link.id, target.id),
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

function toLinkGroupDto(row: LinkGroupRow): Record<string, unknown> {
  return {
    id: row.id,
    name: row.name,
    position: row.position,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  }
}

async function assertLinkGroup(db: D1Database, pageId: string, groupId: string | null): Promise<void> {
  if (groupId === null) return
  const row = await db.prepare('SELECT id FROM link_groups WHERE id = ? AND page_id = ?')
    .bind(groupId, pageId).first()
  if (!row) throw notFound('Link group')
}

async function assertOwnedPageImage(db: D1Database, ownerId: string, key: string | null): Promise<void> {
  if (key === null) return
  if (!PAGE_IMAGE_KEY_PATTERN.test(key)) throw badRequest('That is not a page-image key.')
  const row = await db.prepare(
    `SELECT id FROM media_assets
      WHERE r2_key = ? AND owner_user_id = ? AND kind = 'page_image'
        AND bucket = 'public' AND status = 'active'`,
  ).bind(key, ownerId).first()
  if (!row) throw notFound('Page image')
}

export async function listPageLinks(
  db: D1Database,
  target: PageRow,
  trashed = false,
): Promise<Record<string, unknown>[]> {
  const rows = await db.prepare(
    `SELECT * FROM page_links
      WHERE page_id = ? AND deleted_at IS ${trashed ? 'NOT ' : ''}NULL
      ORDER BY position ASC, id ASC`,
  ).bind(target.id).all<PageLinkRow>()
  return rows.results.map(toPageLinkDto)
}

export async function listLinkGroups(db: D1Database, target: PageRow): Promise<Record<string, unknown>[]> {
  const rows = await db.prepare(
    'SELECT * FROM link_groups WHERE page_id = ? ORDER BY position ASC, id ASC',
  ).bind(target.id).all<LinkGroupRow>()
  return rows.results.map(toLinkGroupDto)
}

export async function createLinkGroup(
  db: D1Database,
  actor: ActorInfo,
  target: PageRow,
  name: string,
  auditor: Auditor,
): Promise<Record<string, unknown>> {
  const cleanName = sanitizeSingleLine(name, 80)
  if (!cleanName) throw badRequest('A group name is required.')
  const id = ulid()
  const timestamp = now()
  const entry = auditor.claim({
    action: 'page.group.create',
    targetType: 'page',
    targetId: target.id,
    targetLabel: target.slug,
    actorUserId: actor.id,
    actorRole: actor.role,
    actorLabel: actor.label,
    metadata: { groupId: id },
    after: { name: cleanName },
  })
  await db.batch([
    db.prepare(
      `INSERT INTO link_groups (id, page_id, name, position, created_at, updated_at)
       SELECT ?, ?, ?, COALESCE(MAX(position), -1) + 1, ?, ?
         FROM link_groups WHERE page_id = ?`,
    ).bind(id, target.id, cleanName, timestamp, timestamp, target.id),
    auditInsertStmt(db, entry),
  ])
  const row = await db.prepare('SELECT * FROM link_groups WHERE id = ?').bind(id).first<LinkGroupRow>()
  if (!row) throw notFound('Link group')
  return toLinkGroupDto(row)
}

export async function updateLinkGroup(
  db: D1Database,
  actor: ActorInfo,
  target: PageRow,
  groupId: string,
  name: string,
  auditor: Auditor,
): Promise<Record<string, unknown>> {
  const group = await db.prepare('SELECT * FROM link_groups WHERE id = ? AND page_id = ?')
    .bind(groupId, target.id).first<LinkGroupRow>()
  if (!group) throw notFound('Link group')
  const cleanName = sanitizeSingleLine(name, 80)
  if (!cleanName) throw badRequest('A group name is required.')
  const timestamp = now()
  const entry = auditor.claim({
    action: 'page.group.update',
    targetType: 'page',
    targetId: target.id,
    targetLabel: target.slug,
    actorUserId: actor.id,
    actorRole: actor.role,
    actorLabel: actor.label,
    metadata: { groupId },
    before: { name: group.name },
    after: { name: cleanName },
  })
  await db.batch([
    db.prepare('UPDATE link_groups SET name = ?, updated_at = ? WHERE id = ? AND page_id = ?')
      .bind(cleanName, timestamp, groupId, target.id),
    auditInsertStmt(db, entry, true),
  ])
  const row = await db.prepare('SELECT * FROM link_groups WHERE id = ?').bind(groupId).first<LinkGroupRow>()
  if (!row) throw notFound('Link group')
  return toLinkGroupDto(row)
}

export async function deleteLinkGroup(
  db: D1Database,
  actor: ActorInfo,
  target: PageRow,
  groupId: string,
  auditor: Auditor,
): Promise<void> {
  const group = await db.prepare('SELECT * FROM link_groups WHERE id = ? AND page_id = ?')
    .bind(groupId, target.id).first<LinkGroupRow>()
  if (!group) throw notFound('Link group')
  const entry = auditor.claim({
    action: 'page.group.delete',
    targetType: 'page',
    targetId: target.id,
    targetLabel: target.slug,
    actorUserId: actor.id,
    actorRole: actor.role,
    actorLabel: actor.label,
    metadata: { groupId },
    before: { name: group.name },
  })
  await db.batch([
    db.prepare('UPDATE page_links SET group_id = NULL, updated_at = ? WHERE page_id = ? AND group_id = ?')
      .bind(now(), target.id, groupId),
    db.prepare('DELETE FROM link_groups WHERE id = ? AND page_id = ?').bind(groupId, target.id),
    auditInsertStmt(db, entry, true),
  ])
}

export async function reorderLinkGroups(
  db: D1Database,
  actor: ActorInfo,
  target: PageRow,
  groupIds: readonly string[],
  auditor: Auditor,
): Promise<Record<string, unknown>[]> {
  if (new Set(groupIds).size !== groupIds.length) throw badRequest('Group ids must not repeat.')
  const rows = await db.prepare('SELECT id FROM link_groups WHERE page_id = ?').bind(target.id).all<{ id: string }>()
  const currentIds = new Set(rows.results.map(row => row.id))
  if (groupIds.length !== currentIds.size || !groupIds.every(id => currentIds.has(id))) {
    throw badRequest('The ordering must name every group on this page exactly once.')
  }
  if (groupIds.length === 0) return []

  const timestamp = now()
  const entry = auditor.claim({
    action: 'page.groups.reorder',
    targetType: 'page',
    targetId: target.id,
    targetLabel: target.slug,
    actorUserId: actor.id,
    actorRole: actor.role,
    actorLabel: actor.label,
    after: { order: [...groupIds] },
  })
  const ids = groupIds.map(() => '?').join(', ')
  const count = groupIds.length
  const statements = [
    db.prepare(
      `UPDATE pages SET updated_at = updated_at WHERE id = ? AND (
         (SELECT COUNT(*) FROM link_groups WHERE page_id = ?) != ?
         OR (SELECT COUNT(*) FROM link_groups WHERE page_id = ? AND id IN (${ids})) != ?
       )`,
    ).bind(target.id, target.id, count, target.id, ...groupIds, count),
    db.prepare(
      `UPDATE link_groups SET position = -1 - position
        WHERE page_id = ? AND (SELECT COUNT(*) FROM link_groups WHERE page_id = ?) = ?
          AND (SELECT COUNT(*) FROM link_groups WHERE page_id = ? AND id IN (${ids})) = ?`,
    ).bind(target.id, target.id, count, target.id, ...groupIds, count),
    ...groupIds.map((id, position) => db.prepare(
      `UPDATE link_groups SET position = ?, updated_at = ?
        WHERE id = ? AND page_id = ?
          AND (SELECT COUNT(*) FROM link_groups WHERE page_id = ?) = ?
          AND (SELECT COUNT(*) FROM link_groups WHERE page_id = ? AND id IN (${ids})) = ?`,
    ).bind(position, timestamp, id, target.id, target.id, count, target.id, ...groupIds, count)),
    auditInsertStmt(db, entry, true),
  ]
  const result = await db.batch(statements)
  if ((result[0]?.meta.changes ?? 0) !== 0) {
    throw conflict('The group list changed while it was being saved. Reload and try again.')
  }
  return listLinkGroups(db, target)
}

export type BulkLinkAction = 'hide' | 'show' | 'delete' | 'move'

export async function bulkUpdatePageLinks(
  db: D1Database,
  actor: ActorInfo,
  target: PageRow,
  ids: readonly string[],
  action: BulkLinkAction,
  groupId: string | null | undefined,
  auditor: Auditor,
): Promise<Record<string, unknown>[]> {
  if (new Set(ids).size !== ids.length) throw badRequest('Link ids must not repeat.')
  const rows = await db.prepare(
    `SELECT * FROM page_links WHERE page_id = ? AND deleted_at IS NULL AND id IN (${ids.map(() => '?').join(', ')})`,
  ).bind(target.id, ...ids).all<PageLinkRow>()
  if (rows.results.length !== ids.length) {
    throw badRequest('Every link must be live and belong to this page.')
  }
  if (action === 'move') await assertLinkGroup(db, target.id, groupId ?? null)

  const timestamp = now()
  const statements: D1PreparedStatement[] = []
  const idList = ids.map(() => '?').join(', ')
  statements.push(db.prepare(
    `UPDATE pages SET updated_at = updated_at WHERE id = ?
       AND (SELECT COUNT(*) FROM page_links
              WHERE page_id = ? AND deleted_at IS NULL AND id IN (${idList})) != ?`,
  ).bind(target.id, target.id, ...ids, ids.length))

  for (const link of rows.results) {
    const before = { isVisible: link.is_visible === 1, deletedAt: link.deleted_at, groupId: link.group_id }
    const after = action === 'hide'
      ? { isVisible: false }
      : action === 'show'
        ? { isVisible: true }
        : action === 'delete'
          ? { deletedAt: timestamp }
          : { groupId: groupId ?? null }
    const entry = auditor.claim({
      action: `page.link.bulk_${action}`,
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
    const assignment = action === 'hide' || action === 'show'
      ? 'is_visible = ?'
      : action === 'delete'
        ? 'deleted_at = ?'
        : 'group_id = ?'
    const value = action === 'hide' ? 0
      : action === 'show' ? 1
        : action === 'delete' ? timestamp
          : groupId ?? null
    statements.push(db.prepare(
      `UPDATE page_links SET ${assignment}, updated_at = ?
        WHERE id = ? AND page_id = ? AND deleted_at IS NULL
          AND (SELECT COUNT(*) FROM page_links WHERE page_id = ? AND deleted_at IS NULL AND id IN (${idList})) = ?`,
    ).bind(value, timestamp, link.id, target.id, target.id, ...ids, ids.length))
    statements.push(auditInsertStmt(db, entry, true))
  }
  const result = await db.batch(statements)
  if ((result[0]?.meta.changes ?? 0) !== 0) {
    throw conflict('The link list changed while the action was being saved. Reload and try again.')
  }
  return listPageLinks(db, target)
}

export async function restorePageLink(
  db: D1Database,
  actor: ActorInfo,
  target: PageRow,
  linkId: string,
  auditor: Auditor,
): Promise<Record<string, unknown>> {
  const link = await db.prepare(
    'SELECT * FROM page_links WHERE id = ? AND page_id = ? AND deleted_at IS NOT NULL',
  ).bind(linkId, target.id).first<PageLinkRow>()
  if (!link) throw notFound('Page link')
  const limit = await maxLinksPerPage(db)
  const timestamp = now()
  const entry = auditor.claim({
    action: 'page.link.restore',
    targetType: 'page',
    targetId: target.id,
    targetLabel: target.slug,
    actorUserId: actor.id,
    actorRole: actor.role,
    actorLabel: actor.label,
    metadata: { linkId },
    before: { deletedAt: link.deleted_at },
    after: { deletedAt: null },
  })
  const result = await db.batch([
    db.prepare(
      `UPDATE page_links SET deleted_at = NULL,
          position = (SELECT COALESCE(MAX(position), -1) + 1 FROM page_links
                       WHERE page_id = ? AND deleted_at IS NULL),
          updated_at = ?
        WHERE id = ? AND page_id = ? AND deleted_at IS NOT NULL
          AND (SELECT COUNT(*) FROM page_links WHERE page_id = ? AND deleted_at IS NULL) < ?`,
    ).bind(target.id, timestamp, linkId, target.id, target.id, limit),
    auditInsertStmt(db, entry, true),
  ])
  if (result[0]?.meta.changes !== 1) throw conflict('The link could not be restored. Check the page link limit and try again.')
  const restored = await db.prepare('SELECT * FROM page_links WHERE id = ?').bind(linkId).first<PageLinkRow>()
  if (!restored) throw notFound('Page link')
  return toPageLinkDto(restored)
}

export async function purgeTrashedPageLinks(db: D1Database, timestamp = now()): Promise<number> {
  const configured = await getNumberSetting(db, SETTING_KEYS.trashRetentionDays, 30)
  const retentionDays = Math.max(1, Math.min(Math.trunc(configured), 3650))
  const result = await db.prepare(
    'DELETE FROM page_links WHERE deleted_at IS NOT NULL AND deleted_at <= ?',
  ).bind(timestamp - retentionDays * DAY).run()
  return result.meta.changes
}

// ------------------------------------------------------------------ public --

export interface PublicPageResult {
  page: Record<string, unknown>
  links: ReturnType<typeof toPageLinkDto>[]
  groups: Array<{ id: string; name: string; position: number }>
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

  const timestamp = now()
  const [linkRows, groupRows] = await Promise.all([
    db
    .prepare(
      `SELECT * FROM page_links
         WHERE page_id = ? AND deleted_at IS NULL AND is_visible = 1
           AND (starts_at IS NULL OR starts_at <= ?)
           AND (ends_at IS NULL OR ends_at >= ?)
         ORDER BY position ASC, id ASC`,
    )
    .bind(page.id, timestamp, timestamp)
    .all<PageLinkRow>(),
    db.prepare(
      'SELECT * FROM link_groups WHERE page_id = ? ORDER BY position ASC, id ASC',
    ).bind(page.id).all<LinkGroupRow>(),
  ])
  const links = linkRows.results.map((row) => toPageLinkDto(row, timestamp))
  return renderPublicPage(
    db,
    page.user_id,
    {
      slug: page.slug,
      title: page.title,
      bio: page.bio,
      theme: page.theme ?? 'light',
      layout: page.layout,
      accentColor: page.accent_color,
      showBranding: page.show_branding === 1,
    },
    links,
    groupRows.results,
  )
}

export async function getPagePreview(db: D1Database, page: PageRow): Promise<PublicPageResult> {
  const state = await readPageDraft(db, page)
  const timestamp = now()
  const links = state.content.links.flatMap((link, position) => {
    if (!link.isVisible) return []
    if (link.startsAt !== null && link.startsAt > timestamp) return []
    if (link.endsAt !== null && link.endsAt < timestamp) return []
    const row: PageLinkRow = {
      id: link.id ?? ulid(),
      page_id: page.id,
      title: link.title,
      url: link.url,
      domain: hostnameOf(link.url),
      icon: link.icon ?? null,
      description: link.description ?? null,
      position,
      is_visible: 1,
      starts_at: link.startsAt,
      ends_at: link.endsAt,
      group_id: link.groupId ?? null,
      open_in_new_tab: link.openInNewTab ? 1 : 0,
      thumbnail_key: link.thumbnailKey ?? null,
      clicks: 0,
      created_at: timestamp,
      updated_at: timestamp,
      deleted_at: null,
    }
    return [toPageLinkDto(row, timestamp)]
  })
  const groups = state.content.groups.map((group, position) => ({
    id: group.id ?? ulid(),
    page_id: page.id,
    name: group.name,
    position,
    created_at: timestamp,
    updated_at: timestamp,
  }))
  return renderPublicPage(
    db,
    page.user_id,
    {
      slug: page.slug,
      title: state.content.page.title,
      bio: state.content.page.bio,
      theme: state.content.page.theme,
      layout: state.content.page.layout,
      accentColor: state.content.page.accentColor,
      showBranding: state.content.page.showBranding,
    },
    links,
    groups,
  )
}
