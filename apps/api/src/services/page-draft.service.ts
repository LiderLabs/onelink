import { now } from '../lib/clock'
import { MAX_LINKS_PER_PAGE_HARD_CAP } from '../lib/constants'
import { badRequest, conflict, forbidden, notFound, preconditionFailed } from '../lib/errors'
import {
  hostnameOf,
  normalizeUrl,
  sanitizeMultiline,
  sanitizeSingleLine,
} from '../lib/http'
import { ulid } from '../lib/ids'
import { PAGE_IMAGE_KEY_PATTERN } from '../lib/media'
import { placeholders } from '../lib/query'
import { auditInsertStmt } from './audit.service'
import { toApiPage } from './mappers'
import { getNumberSetting, SETTING_KEYS } from './settings.service'
import type {
  ActorInfo,
  Auditor,
  LinkGroupRow,
  PageDraftRow,
  PageLinkRow,
  PageRevisionRow,
  PageRow,
} from '../types'
import { pageDraftContentSchema, type PageDraftContent } from '../validation/page.schema'

type DraftLink = PageDraftContent['links'][number] & { id: string }
type DraftGroup = PageDraftContent['groups'][number] & { id: string }

export interface PageDraftState {
  content: PageDraftContent
  updatedAt: number | null
  unpublishedChanges: boolean
}

function ownerPageContent(page: PageRow): PageDraftContent['page'] {
  return {
    title: page.title,
    bio: page.bio,
    theme: page.theme ?? 'light',
    layout: page.layout,
    accentColor: page.accent_color,
    showBranding: page.show_branding === 1,
  }
}

function parseStoredContent(raw: string): PageDraftContent {
  const parsed: unknown = JSON.parse(raw)
  const validated = pageDraftContentSchema.safeParse(parsed)
  if (!validated.success) throw new Error('Stored page draft has an invalid content envelope.')
  return validated.data
}

async function liveContent(db: D1Database, page: PageRow): Promise<PageDraftContent> {
  const [linkRows, groupRows] = await Promise.all([
    db.prepare(
      'SELECT * FROM page_links WHERE page_id = ? AND deleted_at IS NULL ORDER BY position, id',
    ).bind(page.id).all<PageLinkRow>(),
    db.prepare(
      'SELECT * FROM link_groups WHERE page_id = ? ORDER BY position, id',
    ).bind(page.id).all<LinkGroupRow>(),
  ])

  return {
    v: 1,
    page: ownerPageContent(page),
    groups: groupRows.results.map((group) => ({ id: group.id, name: group.name })),
    links: linkRows.results.map((link) => ({
      id: link.id,
      title: link.title,
      url: link.url,
      description: link.description,
      icon: link.icon,
      isVisible: link.is_visible === 1,
      groupId: link.group_id,
      openInNewTab: link.open_in_new_tab === 1,
      thumbnailKey: link.thumbnail_key,
      startsAt: link.starts_at,
      endsAt: link.ends_at,
    })),
  }
}

function hasUnpublishedChanges(page: PageRow, draft: PageDraftRow | null): boolean {
  if (!draft) return false
  if (page.status !== 'published' || page.published_at === null) return true
  return draft.updated_at > page.published_at
}

export async function ownerPageDto(
  db: D1Database,
  page: PageRow,
): Promise<Record<string, unknown>> {
  const draft = await db.prepare(
    'SELECT * FROM page_drafts WHERE page_id = ?',
  ).bind(page.id).first<PageDraftRow>()
  return {
    ...toApiPage(page, page.content_revision > 0 ? page.content_revision : null),
    unpublishedChanges: hasUnpublishedChanges(page, draft),
  }
}

export async function ownerPageDtos(
  db: D1Database,
  pages: PageRow[],
): Promise<Record<string, unknown>[]> {
  if (pages.length === 0) return []
  const { results } = await db.prepare(
    `SELECT * FROM page_drafts WHERE page_id IN (${placeholders(pages.length)})`,
  ).bind(...pages.map((page) => page.id)).all<PageDraftRow>()
  const drafts = new Map(results.map((draft) => [draft.page_id, draft]))
  return pages.map((page) => ({
    ...toApiPage(page, page.content_revision > 0 ? page.content_revision : null),
    unpublishedChanges: hasUnpublishedChanges(page, drafts.get(page.id) ?? null),
  }))
}

export async function readPageDraft(
  db: D1Database,
  page: PageRow,
): Promise<PageDraftState> {
  const draft = await db.prepare(
    'SELECT * FROM page_drafts WHERE page_id = ?',
  ).bind(page.id).first<PageDraftRow>()
  const unpublishedChanges = hasUnpublishedChanges(page, draft)
  return {
    content: draft && unpublishedChanges
      ? parseStoredContent(draft.content)
      : await liveContent(db, page),
    updatedAt: draft?.updated_at ?? null,
    unpublishedChanges,
  }
}

async function canonicalizeContent(
  db: D1Database,
  page: PageRow,
  ownerId: string,
  input: PageDraftContent,
  previous: PageDraftContent | null,
  remapIds: boolean,
): Promise<PageDraftContent> {
  const limit = Math.min(
    Math.max(Math.trunc(await getNumberSetting(db, SETTING_KEYS.maxLinksPerPage, 50)), 1),
    MAX_LINKS_PER_PAGE_HARD_CAP,
  )
  if (input.links.length > limit) {
    throw badRequest(`A page may hold at most ${limit} links.`)
  }

  const liveIds = await Promise.all([
    db.prepare('SELECT id FROM page_links WHERE page_id = ?').bind(page.id).all<{ id: string }>(),
    db.prepare('SELECT id FROM link_groups WHERE page_id = ?').bind(page.id).all<{ id: string }>(),
  ])
  const knownLinkIds = new Set([
    ...liveIds[0].results.map(({ id }) => id),
    ...(previous?.links.map(({ id }) => id) ?? []),
  ])
  const knownGroupIds = new Set([
    ...liveIds[1].results.map(({ id }) => id),
    ...(previous?.groups.map(({ id }) => id).filter((id): id is string => id !== undefined) ?? []),
  ])

  const groupIds = new Set<string>()
  const suppliedGroupIds = new Set<string>()
  const groupRemap = new Map<string, string>()
  const groups: DraftGroup[] = input.groups.map((group) => {
    if (group.id && suppliedGroupIds.has(group.id)) throw badRequest('Group ids must not repeat.')
    if (group.id) suppliedGroupIds.add(group.id)
    if (group.id && !remapIds && !knownGroupIds.has(group.id)) {
      throw notFound('Link group')
    }
    const id = remapIds || !group.id ? ulid() : group.id
    if (group.id) groupRemap.set(group.id, id)
    groupIds.add(id)
    const name = sanitizeSingleLine(group.name, 80)
    if (!name) throw badRequest('A group name is required.')
    return { id, name }
  })

  const linkIds = new Set<string>()
  const suppliedLinkIds = new Set<string>()
  const links: DraftLink[] = input.links.map((link) => {
    if (link.id && suppliedLinkIds.has(link.id)) throw badRequest('Link ids must not repeat.')
    if (link.id) suppliedLinkIds.add(link.id)
    if (link.id && !remapIds && !knownLinkIds.has(link.id)) {
      throw notFound('Page link')
    }
    const id = remapIds || !link.id ? ulid() : link.id
    linkIds.add(id)
    const groupId = link.groupId == null
      ? null
      : (groupRemap.get(link.groupId) ?? link.groupId)
    if (groupId !== null && !groupIds.has(groupId)) throw notFound('Link group')
    const url = normalizeUrl(link.url)
    if (!url) throw badRequest('That URL is not a usable http(s) address.')
    const title = sanitizeSingleLine(link.title, 140)
    if (!title) throw badRequest('A link title is required.')
    const thumbnailKey = link.thumbnailKey ?? null
    if (thumbnailKey !== null && !PAGE_IMAGE_KEY_PATTERN.test(thumbnailKey)) {
      throw badRequest('That is not a page-image key.')
    }
    return {
      id,
      title,
      url,
      description: link.description == null ? null : sanitizeMultiline(link.description, 280) || null,
      icon: link.icon == null ? null : sanitizeSingleLine(link.icon, 80) || null,
      isVisible: link.isVisible,
      groupId,
      openInNewTab: link.openInNewTab,
      thumbnailKey,
      startsAt: link.startsAt,
      endsAt: link.endsAt,
    }
  })

  const thumbnailKeys = [...new Set(links.flatMap((link) => link.thumbnailKey ? [link.thumbnailKey] : []))]
  if (thumbnailKeys.length > 0) {
    const placeholders = thumbnailKeys.map(() => '?').join(', ')
    const { results } = await db.prepare(
      `SELECT r2_key FROM media_assets
        WHERE owner_user_id = ? AND kind = 'page_image' AND bucket = 'public'
          AND status = 'active' AND r2_key IN (${placeholders})`,
    ).bind(ownerId, ...thumbnailKeys).all<{ r2_key: string }>()
    const owned = new Set(results.map(({ r2_key }) => r2_key))
    if (thumbnailKeys.some((key) => !owned.has(key))) throw notFound('Page image')
  }

  const accentColor = input.page.accentColor
  return {
    v: 1,
    page: {
      title: input.page.title === null ? null : sanitizeSingleLine(input.page.title, 120) || null,
      bio: input.page.bio === null ? null : sanitizeMultiline(input.page.bio, 500) || null,
      theme: input.page.theme,
      layout: input.page.layout,
      accentColor,
      showBranding: input.page.showBranding,
    },
    groups,
    links,
  }
}

export async function savePageDraft(
  db: D1Database,
  actor: ActorInfo,
  page: PageRow,
  content: PageDraftContent,
  expectedUpdatedAt: number | null,
  auditor: Auditor,
): Promise<PageDraftState> {
  const existing = await db.prepare(
    'SELECT * FROM page_drafts WHERE page_id = ?',
  ).bind(page.id).first<PageDraftRow>()
  const previous = existing ? parseStoredContent(existing.content) : null
  const normalized = await canonicalizeContent(db, page, actor.id, content, previous, false)
  const timestamp = now()
  const draftId = existing?.id ?? ulid()
  const entry = auditor.claim({
    action: 'page.draft.save',
    targetType: 'page',
    targetId: page.id,
    targetLabel: page.slug,
    actorUserId: actor.id,
    actorRole: actor.role,
    actorLabel: actor.label,
    before: { updatedAt: expectedUpdatedAt },
    after: { updatedAt: timestamp },
  })
  const results = await db.batch([
    db.prepare(
      `INSERT INTO page_drafts (id, page_id, content, updated_by, created_at, updated_at)
       SELECT ?, ?, ?, ?, ?, ?
        WHERE ? IS NULL OR EXISTS (SELECT 1 FROM page_drafts WHERE page_id = ?)
       ON CONFLICT(page_id) DO UPDATE SET
         content = excluded.content, updated_by = excluded.updated_by,
         updated_at = MAX(
           ?, page_drafts.updated_at + 1,
           COALESCE((SELECT published_at + 1 FROM pages WHERE id = ?), ?)
         )
       WHERE page_drafts.updated_at = ?`,
    ).bind(
      draftId, page.id, JSON.stringify(normalized), actor.id, timestamp, timestamp,
      expectedUpdatedAt, page.id, timestamp, page.id, timestamp, expectedUpdatedAt,
    ),
    auditInsertStmt(db, entry, true),
  ])
  if (results[0]?.meta.changes !== 1) {
    throw preconditionFailed('This draft changed in another tab. Reload it before saving again.')
  }
  const saved = await db.prepare(
    'SELECT * FROM page_drafts WHERE page_id = ?',
  ).bind(page.id).first<PageDraftRow>()
  if (!saved) throw notFound('Page draft')
  return {
    content: parseStoredContent(saved.content),
    updatedAt: saved.updated_at,
    unpublishedChanges: hasUnpublishedChanges(page, saved),
  }
}

export async function discardPageDraft(
  db: D1Database,
  actor: ActorInfo,
  page: PageRow,
  auditor: Auditor,
): Promise<PageDraftState> {
  const existing = await db.prepare(
    'SELECT * FROM page_drafts WHERE page_id = ?',
  ).bind(page.id).first<PageDraftRow>()
  if (!existing) return readPageDraft(db, page)
  const entry = auditor.claim({
    action: 'page.draft.discard',
    targetType: 'page',
    targetId: page.id,
    targetLabel: page.slug,
    actorUserId: actor.id,
    actorRole: actor.role,
    actorLabel: actor.label,
    before: { updatedAt: existing.updated_at },
  })
  const results = await db.batch([
    db.prepare('DELETE FROM page_drafts WHERE page_id = ?').bind(page.id),
    auditInsertStmt(db, entry, true),
  ])
  if (results[0]?.meta.changes !== 1) throw conflict('The draft could not be discarded.')
  return readPageDraft(db, page)
}

function legacySnapshotContent(raw: string): PageDraftContent {
  const snapshot: unknown = JSON.parse(raw)
  if (!snapshot || typeof snapshot !== 'object') throw new Error('Invalid page revision snapshot.')
  const value = snapshot as {
    v?: unknown
    page?: Record<string, unknown>
    links?: Array<Record<string, unknown>>
    groups?: Array<Record<string, unknown>>
  }
  if (value.v === 1) {
    const validated = pageDraftContentSchema.safeParse(value)
    if (!validated.success) throw new Error('Stored page revision has an invalid content envelope.')
    return validated.data
  }
  const page = value.page ?? {}
  return {
    v: 1,
    page: {
      title: typeof page.title === 'string' ? page.title : null,
      bio: typeof page.bio === 'string' ? page.bio : null,
      theme: page.theme === 'dark' ? 'dark' : 'light',
      layout: page.layout === 'grid' ? 'grid' : 'list',
      accentColor: typeof page.accentColor === 'string' ? page.accentColor : null,
      showBranding: page.showBranding !== false,
    },
    groups: (value.groups ?? []).flatMap((group) =>
      typeof group.id === 'string' && typeof group.name === 'string'
        ? [{ id: group.id, name: group.name }]
        : [],
    ),
    links: (value.links ?? []).flatMap((link) => {
      if (typeof link.title !== 'string' || typeof link.url !== 'string') return []
      return [{
        ...(typeof link.id === 'string' ? { id: link.id } : {}),
        title: link.title,
        url: link.url,
        description: typeof link.description === 'string' ? link.description : null,
        icon: typeof link.icon === 'string' ? link.icon : null,
        isVisible: link.isVisible !== false,
        groupId: typeof link.groupId === 'string' ? link.groupId : null,
        openInNewTab: link.openInNewTab === true,
        thumbnailKey: typeof link.thumbnailKey === 'string' ? link.thumbnailKey : null,
        startsAt: typeof link.startsAt === 'number' ? link.startsAt : null,
        endsAt: typeof link.endsAt === 'number' ? link.endsAt : null,
      }]
    }),
  }
}

export async function listPageRevisions(db: D1Database, pageId: string) {
  const { results } = await db.prepare(
    `SELECT revision, reason, created_at
       FROM page_revisions WHERE page_id = ?
       ORDER BY revision DESC LIMIT 10`,
  ).bind(pageId).all<Pick<PageRevisionRow, 'revision' | 'reason' | 'created_at'>>()
  return results.map((row) => ({
    revision: row.revision,
    reason: row.reason,
    createdAt: row.created_at,
  }))
}

export async function getPageRevision(db: D1Database, pageId: string, revision: number) {
  const row = await db.prepare(
    'SELECT * FROM page_revisions WHERE page_id = ? AND revision = ? LIMIT 1',
  ).bind(pageId, revision).first<PageRevisionRow>()
  if (!row) throw notFound('Page revision')
  return {
    revision: { revision: row.revision, reason: row.reason, createdAt: row.created_at },
    content: legacySnapshotContent(row.snapshot),
  }
}

export async function restorePageRevision(
  db: D1Database,
  actor: ActorInfo,
  page: PageRow,
  revision: number,
  auditor: Auditor,
): Promise<PageDraftState> {
  const found = await getPageRevision(db, page.id, revision)
  const existing = await db.prepare(
    'SELECT * FROM page_drafts WHERE page_id = ?',
  ).bind(page.id).first<PageDraftRow>()
  const normalized = await canonicalizeContent(db, page, actor.id, found.content, null, true)
  const timestamp = Math.max(
    now(),
    (existing?.updated_at ?? 0) + 1,
    (page.published_at ?? 0) + 1,
  )
  const entry = auditor.claim({
    action: 'page.revision.restore',
    targetType: 'page',
    targetId: page.id,
    targetLabel: page.slug,
    actorUserId: actor.id,
    actorRole: actor.role,
    actorLabel: actor.label,
    metadata: { revision },
    before: existing ? { updatedAt: existing.updated_at } : undefined,
    after: { updatedAt: timestamp },
  })
  await db.batch([
    db.prepare(
      `INSERT INTO page_drafts (id, page_id, content, updated_by, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?)
       ON CONFLICT(page_id) DO UPDATE SET content = excluded.content,
         updated_by = excluded.updated_by, updated_at = excluded.updated_at`,
    ).bind(existing?.id ?? ulid(), page.id, JSON.stringify(normalized), actor.id, timestamp, timestamp),
    auditInsertStmt(db, entry),
  ])
  return {
    content: normalized,
    updatedAt: timestamp,
    unpublishedChanges: true,
  }
}

export async function publishDraft(
  db: D1Database,
  actor: ActorInfo,
  target: PageRow,
  auditor: Auditor,
): Promise<Record<string, unknown>> {
  if (target.moderation_status === 'removed') {
    throw forbidden('That page was removed by moderation and cannot be published.')
  }
  const state = await readPageDraft(db, target)
  const content = state.content
  const timestamp = now()
  const existing = await db.prepare(
    'SELECT revision FROM page_revisions WHERE page_id = ? ORDER BY revision DESC LIMIT 1',
  ).bind(target.id).first<{ revision: number }>()
  const revision = (existing?.revision ?? 0) + 1
  const snapshot = JSON.stringify(content)
  const draftGuard = `(
    (? IS NULL AND NOT EXISTS (SELECT 1 FROM page_drafts WHERE page_id = ?))
    OR EXISTS (SELECT 1 FROM page_drafts WHERE page_id = ? AND updated_at = ?)
  )`
  const draftGuardBinds = [state.updatedAt, target.id, target.id, state.updatedAt]
  const entry = auditor.claim({
    action: 'page.publish',
    targetType: 'page',
    targetId: target.id,
    targetLabel: target.slug,
    actorUserId: actor.id,
    actorRole: actor.role,
    actorLabel: actor.label,
    after: { revision, linkCount: content.links.length, groupCount: content.groups.length },
  })
  const groups = content.groups.map((group) => ({ ...group }))
  const links = content.links.map((link) => ({ ...link, domain: hostnameOf(link.url) }))

  const statements: D1PreparedStatement[] = [
    db.prepare(
      `UPDATE pages SET title = ?, bio = ?, theme = ?, layout = ?, accent_color = ?,
         show_branding = ?, status = 'published', published_at = ?,
         first_published_at = COALESCE(first_published_at, ?), content_revision = ?, updated_at = ?
       WHERE id = ? AND ${draftGuard}`,
    ).bind(
      content.page.title, content.page.bio, content.page.theme, content.page.layout,
      content.page.accentColor, content.page.showBranding ? 1 : 0,
      timestamp, timestamp, revision, timestamp, target.id, ...draftGuardBinds,
    ),
    db.prepare(
      `UPDATE page_links SET group_id = NULL WHERE page_id = ? AND ${draftGuard}`,
    ).bind(target.id, ...draftGuardBinds),
    db.prepare(
      `DELETE FROM link_groups WHERE page_id = ? AND ${draftGuard}`,
    ).bind(target.id, ...draftGuardBinds),
    db.prepare(
      `INSERT INTO link_groups (id, page_id, name, position, created_at, updated_at)
       SELECT json_extract(value, '$.id'), ?, json_extract(value, '$.name'),
              CAST(key AS INTEGER), ?, ?
         FROM json_each(?) WHERE ${draftGuard}`,
    ).bind(target.id, timestamp, timestamp, JSON.stringify(groups), ...draftGuardBinds),
    db.prepare(
      `UPDATE page_links SET deleted_at = ?, updated_at = ?
        WHERE page_id = ? AND deleted_at IS NULL AND ${draftGuard}`,
    ).bind(timestamp, timestamp, target.id, ...draftGuardBinds),
  ]

  if (content.links.length > 0) {
    statements.push(db.prepare(
      `INSERT INTO page_links (
         id, page_id, position, title, url, domain, icon, description, is_visible,
         starts_at, ends_at, group_id, open_in_new_tab, thumbnail_key, created_at, updated_at, deleted_at
       )
       SELECT json_extract(value, '$.id'), ?, CAST(key AS INTEGER),
              json_extract(value, '$.title'), json_extract(value, '$.url'),
              json_extract(value, '$.domain'), json_extract(value, '$.icon'),
              json_extract(value, '$.description'), json_extract(value, '$.isVisible'),
              json_extract(value, '$.startsAt'), json_extract(value, '$.endsAt'),
              json_extract(value, '$.groupId'), json_extract(value, '$.openInNewTab'),
              json_extract(value, '$.thumbnailKey'), ?, ?, NULL
         FROM json_each(?) WHERE ${draftGuard}
       ON CONFLICT(id) DO UPDATE SET
         position = excluded.position, title = excluded.title, url = excluded.url,
         domain = excluded.domain, icon = excluded.icon, description = excluded.description,
         is_visible = excluded.is_visible, starts_at = excluded.starts_at,
         ends_at = excluded.ends_at, group_id = excluded.group_id,
         open_in_new_tab = excluded.open_in_new_tab, thumbnail_key = excluded.thumbnail_key,
         updated_at = excluded.updated_at, deleted_at = NULL
       WHERE page_links.page_id = excluded.page_id`,
    ).bind(target.id, timestamp, timestamp, JSON.stringify(links), ...draftGuardBinds))
  }

  statements.push(
    db.prepare(
      `INSERT INTO page_revisions (id, page_id, revision, snapshot, reason, created_by, created_at)
       SELECT ?, ?, ?, ?, 'publish', ?, ? WHERE ${draftGuard}`,
    ).bind(ulid(), target.id, revision, snapshot, actor.id, timestamp, ...draftGuardBinds),
    db.prepare(
      `DELETE FROM page_revisions WHERE page_id = ?
        AND ${draftGuard}
        AND revision NOT IN (
          SELECT revision FROM page_revisions WHERE page_id = ?
          ORDER BY revision DESC LIMIT 10
        )`,
    ).bind(target.id, ...draftGuardBinds, target.id),
    db.prepare(
      `INSERT INTO page_drafts (id, page_id, content, updated_by, created_at, updated_at)
       SELECT ?, ?, ?, ?, ?, ? WHERE ${draftGuard}
       ON CONFLICT(page_id) DO UPDATE SET content = excluded.content,
         updated_by = excluded.updated_by, updated_at = excluded.updated_at`,
    ).bind(ulid(), target.id, snapshot, actor.id, timestamp, timestamp, ...draftGuardBinds),
    auditInsertStmt(db, entry),
  )
  const results = await db.batch(statements)
  if (results[0]?.meta.changes !== 1) {
    throw preconditionFailed('The page draft changed while publishing. Reload it and try again.')
  }

  const row = await db.prepare('SELECT * FROM pages WHERE id = ?').bind(target.id).first<PageRow>()
  if (!row) throw notFound('Page')
  return { ...toApiPage(row, revision), unpublishedChanges: false }
}
