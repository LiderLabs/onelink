import { now } from '../lib/clock'
import { MAX_SOCIAL_LINKS_PER_USER, SOCIAL_PLATFORMS } from '../lib/constants'
import { badRequest, notFound } from '../lib/errors'
import { normalizeUrl } from '../lib/http'
import { ulid } from '../lib/ids'
import { asCount } from '../lib/query'
import { auditInsertStmt } from './audit.service'
import { toSocialLinkDto } from './mappers'
import type { ActorInfo, Auditor, UserSocialLinkRow } from '../types'

// ============================================================================
// Profile social links (R1.2) — the resource half of the profile API.
//
// The identity half is not here on purpose. `location` and `pronouns` are two
// more columns on `users`, so they are written by `updateOwnProfile` in
// `user.service.ts`, beside `displayName` and `bio`, and read by `toApiUser`.
// Socials are their own table (**D9**), which is why they are their own file.
//
// Ownership is `user_social_links.user_id = actor.id`. Unlike a page there is no
// access seam to consult, because there is exactly one owner and no sharing:
// `requireOwnedSocialLink` below is the whole rule, and it answers `404 Social
// link` for a missing row and for a foreign one alike, so no status code tells a
// caller whether somebody else's row exists. It lives in this file rather than in
// `page-access.service.ts` because that file is the *page* seam R2.1 rewrites for
// teams; a user-owned child row never enters that model.
//
// Policy that could not be a CHECK lives here too: `user_social_links` is created
// by 0003 as a STRICT table, but the same migration ALTERs `users`, and an enum
// arriving with a migration is enforced in code (0002 set that precedent for
// `pages.layout`). The zod schema is the edge; `assertKnownPlatform` is the copy
// the service applies on its own terms.
//
// Every mutation claims its audit entry before the write and binds it into the
// SAME `db.batch()`, so the log row commits with the change it describes — the
// `user.service.ts` contract. Socials are hard-deleted (0003 has no `deleted_at`),
// which is why the delete entry carries the platform and URL it lost.
// ============================================================================

/**
 * The last copy of the platform policy (see `SOCIAL_PLATFORMS`).
 *
 * Returns the normalised value so a caller cannot store the raw string by
 * accident: `"GitHub"` in, `github` out. Zod has already lower-cased and checked
 * what arrived from the wire — this is what keeps that guarantee true for a caller
 * that reached the service another way (routes are not the only possible entry
 * point, and the import path a later migration adds will not necessarily run the
 * same schema).
 */
export function assertKnownPlatform(raw: string): string {
  const platform = raw.trim().toLowerCase()
  if (!(SOCIAL_PLATFORMS as readonly string[]).includes(platform)) {
    throw badRequest(`Unsupported platform "${platform}".`)
  }
  return platform
}

/** This user's socials in display order — the order the public page renders (R1.7). */
export async function listSocialLinks(
  db: D1Database,
  userId: string,
): Promise<UserSocialLinkRow[]> {
  const { results } = await db
    .prepare('SELECT * FROM user_social_links WHERE user_id = ? ORDER BY position ASC, id ASC')
    .bind(userId)
    .all<UserSocialLinkRow>()
  return results
}

/**
 * The DTO form of the listing — the only shape a route returns (never a row, per
 * §7.8, which is the lesson `GET /pages/mine` taught in R1.1).
 */
export async function listSocialLinkDtos(
  db: D1Database,
  userId: string,
): Promise<ReturnType<typeof toSocialLinkDto>[]> {
  return (await listSocialLinks(db, userId)).map(toSocialLinkDto)
}

/**
 * A social row the actor is allowed to act on, or `404 Social link`.
 *
 * The ownership test is part of the query rather than a check afterwards: the row
 * this returns is the authority, so a route cannot act on an id that belongs to
 * somebody else even if it forgets to compare `user_id` itself.
 */
export async function requireOwnedSocialLink(
  db: D1Database,
  userId: string,
  socialId: string,
): Promise<UserSocialLinkRow> {
  const row = await db
    .prepare('SELECT * FROM user_social_links WHERE id = ? AND user_id = ? LIMIT 1')
    .bind(socialId, userId)
    .first<UserSocialLinkRow>()
  if (!row) throw notFound('Social link')
  return row
}

export interface CreateSocialLinkInput {
  platform: string
  url: string
  isVisible?: boolean | undefined
}

/**
 * Appends a social link.
 *
 * Appended rather than placed: the body carries no `position` (see
 * `createSocialLinkSchema`), so a new social always lands last and the order route
 * is the only way to move one. Same shape as `createPageLink`.
 */
export async function createSocialLink(
  db: D1Database,
  actor: ActorInfo,
  input: CreateSocialLinkInput,
  auditor: Auditor,
): Promise<Record<string, unknown>> {
  const platform = assertKnownPlatform(input.platform)
  const url = normalizeUrl(input.url)
  if (!url) throw badRequest('That URL is not a usable http(s) address.')

  const countRow = await db
    .prepare('SELECT count(*) AS total FROM user_social_links WHERE user_id = ?')
    .bind(actor.id)
    .first<{ total?: unknown }>()
  if (asCount(countRow) >= MAX_SOCIAL_LINKS_PER_USER) {
    throw badRequest(`A profile may hold at most ${MAX_SOCIAL_LINKS_PER_USER} social links.`)
  }

  const top = await db
    .prepare('SELECT COALESCE(MAX(position), -1) AS top FROM user_social_links WHERE user_id = ?')
    .bind(actor.id)
    .first<{ top: number }>()
  const position = (top?.top ?? -1) + 1

  const isVisible = input.isVisible !== false
  const timestamp = now()
  const socialId = ulid()

  const entry = auditor.claim({
    action: 'profile.social.create',
    targetType: 'user',
    targetId: actor.id,
    targetLabel: actor.label,
    actorUserId: actor.id,
    actorRole: actor.role,
    actorLabel: actor.label,
    metadata: { socialId, position },
    after: { platform, url, isVisible },
  })

  await db.batch([
    db
      .prepare(
        `INSERT INTO user_social_links (
           id, user_id, platform, url, position, is_visible, created_at, updated_at
         ) VALUES (?,?,?,?,?,?,?,?)`,
      )
      .bind(socialId, actor.id, platform, url, position, isVisible ? 1 : 0, timestamp, timestamp),
    auditInsertStmt(db, entry),
  ])

  const row = await db
    .prepare('SELECT * FROM user_social_links WHERE id = ?')
    .bind(socialId)
    .first<UserSocialLinkRow>()
  if (!row) throw notFound('Social link')
  return toSocialLinkDto(row)
}

export interface UpdateSocialLinkInput {
  platform?: string | undefined
  url?: string | undefined
  isVisible?: boolean | undefined
}

/**
 * A delta edit — the same `setField` recording `updatePageLink` uses, so the audit
 * row names exactly which fields moved rather than restating the whole resource.
 * `undefined` means "not in the body" and is the only reading of absence; nothing
 * here can be cleared, because a social either has a platform and a URL (edited, or
 * hidden through `isVisible`) or it is deleted.
 */
export async function updateSocialLink(
  db: D1Database,
  actor: ActorInfo,
  link: UserSocialLinkRow,
  input: UpdateSocialLinkInput,
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

  if (input.platform !== undefined) {
    setField('platform', assertKnownPlatform(input.platform), 'platform')
  }
  if (input.url !== undefined) {
    const url = normalizeUrl(input.url)
    if (!url) throw badRequest('That URL is not a usable http(s) address.')
    setField('url', url, 'url')
  }
  if (input.isVisible !== undefined) setField('is_visible', input.isVisible ? 1 : 0, 'isVisible')

  // An empty body is refused by the schema, so this is only reachable from a caller
  // that handed the service `{}` directly. Answer with the row it asked about rather
  // than pretending a write happened.
  if (patch.length === 0) return toSocialLinkDto(link)

  const timestamp = now()
  const entry = auditor.claim({
    action: 'profile.social.update',
    targetType: 'user',
    targetId: actor.id,
    targetLabel: actor.label,
    actorUserId: actor.id,
    actorRole: actor.role,
    actorLabel: actor.label,
    metadata: { socialId: link.id },
    before,
    after,
  })

  await db.batch([
    db
      .prepare(`UPDATE user_social_links SET ${patch.join(', ')}, updated_at = ? WHERE id = ?`)
      .bind(...binds, timestamp, link.id),
    auditInsertStmt(db, entry),
  ])

  const updated = await db
    .prepare('SELECT * FROM user_social_links WHERE id = ?')
    .bind(link.id)
    .first<UserSocialLinkRow>()
  if (!updated) throw notFound('Social link')
  return toSocialLinkDto(updated)
}

/**
 * Removes a social link.
 *
 * A hard DELETE, and the one place this file departs from `page_links`: a page and
 * a link are soft-deleted because inbound URLs and moderation history outlive them,
 * whereas a social row has neither and nothing references it (0003 says the same).
 * The audit entry — whose `before` carries the platform and URL it held — is the
 * record that survives.
 *
 * Nothing renumbers the survivors, so positions may hold a gap until the next
 * reorder: the public render and `listSocialLinks` both order BY `position`, and
 * `UNIQUE(user_id, position)` only ever asked for distinct slots, so a hole is
 * invisible to every reader. `reorderSocialLinks` is what closes it, and `create`
 * appends above the highest slot there is (never into the hole), which keeps
 * "new social is last" true regardless of what has been deleted.
 *
 * No `updated_at` to write, so no timestamp is taken: the row is gone.
 */
export async function deleteSocialLink(
  db: D1Database,
  actor: ActorInfo,
  link: UserSocialLinkRow,
  auditor: Auditor,
): Promise<void> {
  const entry = auditor.claim({
    action: 'profile.social.delete',
    targetType: 'user',
    targetId: actor.id,
    targetLabel: actor.label,
    actorUserId: actor.id,
    actorRole: actor.role,
    actorLabel: actor.label,
    metadata: { socialId: link.id },
    before: { platform: link.platform, url: link.url },
  })

  await db.batch([
    db.prepare('DELETE FROM user_social_links WHERE id = ?').bind(link.id),
    auditInsertStmt(db, entry),
  ])
}

/**
 * Replaces social ordering explicitly, mirroring `reorderPageLinks`: the body must
 * name every row exactly once, because positions are dense by construction and a
 * partial list would silently drop the unmentioned rows out of the ordering.
 *
 * Two phases, and they are not optional. `UNIQUE(user_id, position)` is checked per
 * statement, so assigning the new order directly collides the moment a row moves
 * into a slot another row still occupies. Phase one pushes every row of this user
 * into the negative range — positions are only ever assigned from 0 upwards, so no
 * negative value can already exist — and phase two assigns the requested order. Both
 * phases and the audit INSERT travel in ONE `db.batch()`, which D1 runs as a
 * transaction: the intermediate negative state is never visible to another reader,
 * and a failure anywhere leaves the previous order intact.
 */
export async function reorderSocialLinks(
  db: D1Database,
  actor: ActorInfo,
  socialIds: readonly string[],
  auditor: Auditor,
): Promise<ReturnType<typeof toSocialLinkDto>[]> {
  if (new Set(socialIds).size !== socialIds.length) {
    throw badRequest('Social link ids must not repeat.')
  }

  const live = new Set((await listSocialLinks(db, actor.id)).map((row) => row.id))
  if (socialIds.length !== live.size || !socialIds.every((id) => live.has(id))) {
    throw badRequest('The ordering must name every social link on this profile exactly once.')
  }

  const timestamp = now()
  const entry = auditor.claim({
    action: 'profile.socials.reorder',
    targetType: 'user',
    targetId: actor.id,
    targetLabel: actor.label,
    actorUserId: actor.id,
    actorRole: actor.role,
    actorLabel: actor.label,
    after: { order: [...socialIds] },
  })

  const statements: D1PreparedStatement[] = [
    db
      .prepare('UPDATE user_social_links SET position = -1 - position WHERE user_id = ?')
      .bind(actor.id),
    ...socialIds.map((id, index) =>
      db
        .prepare(
          'UPDATE user_social_links SET position = ?, updated_at = ? WHERE id = ? AND user_id = ?',
        )
        .bind(index, timestamp, id, actor.id),
    ),
    auditInsertStmt(db, entry),
  ]
  await db.batch(statements)

  return listSocialLinkDtos(db, actor.id)
}
