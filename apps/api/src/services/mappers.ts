import type {
  ApiUser,
  AuthUser,
  MediaAssetRow,
  PageLinkRow,
  PageRow,
  SanctionRow,
  SessionRow,
  UserNoteRow,
  UserRow,
  UserSocialLinkRow,
} from '../types'
import { mediaUrlFor } from '../lib/media'
import { now } from '../lib/clock'

// ============================================================================
// Row -> DTO mapping. Kept in one place so every endpoint exposes the same
// shape for the same concept, and so it is obvious that `password_hash` and
// `password_reset_tokens` never appear in any DTO.
// ============================================================================

export function toApiUser(row: UserRow): ApiUser {
  return {
    id: row.id,
    email: row.email,
    username: row.username,
    displayName: row.display_name ?? row.username,
    bio: row.bio,
    // `?? null` rather than a bare copy: `location`/`pronouns` arrive with 0003, so
    // a query that enumerates its columns from before that migration would hand
    // back `undefined` — and `JSON.stringify` deletes undefined keys, which would
    // ship a DTO missing a field its own type promises.
    location: row.location ?? null,
    pronouns: row.pronouns ?? null,
    avatarKey: row.avatar_key,
    // R1.3: derived from the key, never stored, so a client reads one field and never
    // has to know how a media URL is shaped. `null` when there is no avatar.
    avatarUrl: row.avatar_key ? mediaUrlFor(row.avatar_key) : null,
    role: row.role,
    status: row.status,
    statusReason: row.status_reason,
    suspendedUntil: row.suspended_until,
    suspendedPermanently: row.suspended_permanently === 1,
    emailVerified: row.email_verified === 1,
    requirePasswordChange: row.require_password_change === 1,
    lastLoginAt: row.last_login_at,
    loginCount: row.login_count,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    deletedAt: row.deleted_at,
  }
}

export function toAuthUser(row: UserRow, session: SessionRow): AuthUser {
  return {
    ...toApiUser(row),
    sessionId: session.id,
    sessionExpiresAt: session.expires_at,
    impersonatedBy: session.impersonated_by,
  }
}

export function toSessionDto(row: SessionRow): {
  id: string
  createdAt: number
  lastUsedAt: number | null
  expiresAt: number
  ip: string | null
  userAgent: string | null
  deviceLabel: string | null
  impersonatedBy: string | null
  revokedAt: number | null
  revokedReason: string | null
} {
  return {
    id: row.id,
    createdAt: row.created_at,
    lastUsedAt: row.last_used_at,
    expiresAt: row.expires_at,
    ip: row.ip,
    userAgent: row.user_agent,
    deviceLabel: row.device_label,
    impersonatedBy: row.impersonated_by,
    revokedAt: row.revoked_at,
    revokedReason: row.revoked_reason,
  }
}

export function toSanctionDto(row: SanctionRow): Record<string, unknown> {
  return {
    id: row.id,
    userId: row.user_id,
    type: row.type,
    reason: row.reason,
    category: row.category,
    issuedBy: row.issued_by,
    issuedByLabel: row.issued_by_label,
    reportId: row.report_id,
    durationHours: row.duration_hours,
    expiresAt: row.expires_at,
    status: row.status,
    liftedBy: row.lifted_by,
    liftedAt: row.lifted_at,
    liftReason: row.lift_reason,
    createdAt: row.created_at,
  }
}

export function toNoteDto(row: UserNoteRow): Record<string, unknown> {
  return {
    id: row.id,
    userId: row.user_id,
    authorId: row.author_id,
    authorLabel: row.author_label,
    body: row.body,
    createdAt: row.created_at,
  }
}

/** Narrow shape used inside list responses and nested references. */
export function toUserSummary(row: {
  id: string
  username: string
  display_name?: string | null
  role?: string | null
  status?: string | null
}): Record<string, unknown> {
  return {
    id: row.id,
    username: row.username,
    displayName: row.display_name ?? row.username,
    role: row.role ?? null,
    status: row.status ?? null,
  }
}

// ------------------------------------------------------------------- pages --

/**
 * Owner shape: the same page the owner sees everywhere.
 *
 * Publish state is `status` — the 0001 column — rather than a derived
 * `isPublished` boolean, so the owner can also see `archived` and can never see
 * a state the database cannot hold. `moderationStatus` is included because the
 * owner must know when their page stops being public; `revision` too, so the
 * editor can display "published as revision N".
 */
export function toApiPage(row: PageRow, revision: number | null): Record<string, unknown> {
  return {
    id: row.id,
    slug: row.slug,
    title: row.title,
    bio: row.bio,
    theme: row.theme,
    layout: row.layout,
    accentColor: row.accent_color,
    showBranding: row.show_branding === 1,
    status: row.status,
    moderationStatus: row.moderation_status,
    visibility: row.visibility,
    revision,
    unpublishedChanges: false,
    publishedAt: row.published_at,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    deletedAt: row.deleted_at,
  }
}

/**
 * Public shape: exactly what an anonymous browser needs to render a link page,
 * and nothing it must not have. Internal moderation counters, revision history
 * and database-only fields are deliberately absent.
 */
export function toPublicPage(
  row: {
    slug: string
    title: string | null
    bio: string | null
    theme: string
    layout: string
    accentColor: string | null
    showBranding: boolean
  },
  owner: {
    username: string
    displayName: string
    avatarUrl: string | null
    bio: string | null
    location: string | null
    pronouns: string | null
    socials: Array<{ platform: string; url: string; position: number }>
  },
  links: ReturnType<typeof toPageLinkDto>[],
  groups: Array<{ id: string; name: string; position: number }>,
): Record<string, unknown> {
  return {
    slug: row.slug,
    title: row.title,
    bio: row.bio,
    theme: row.theme,
    layout: row.layout,
    accentColor: row.accentColor,
    showBranding: row.showBranding,
    owner,
    links,
    groups,
  }
}

/**
 * A link as the API exposes it. The display text is `title` and the icon is
 * `icon` because those are the 0001 column names — see the note in
 * migrations/0002_pages_theme_and_scheduling.sql for why the API follows the
 * database here instead of inventing `label` / `iconKey`.
 */
export function toPageLinkDto(row: PageLinkRow, timestamp = now()): Record<string, unknown> {
  return {
    id: row.id,
    title: row.title,
    url: row.url,
    domain: row.domain,
    description: row.description,
    icon: row.icon,
    position: row.position,
    isVisible: row.is_visible === 1,
    startsAt: row.starts_at,
    endsAt: row.ends_at,
    groupId: row.group_id ?? null,
    openInNewTab: row.open_in_new_tab === 1,
    thumbnailKey: row.thumbnail_key ?? null,
    status: row.ends_at !== null && row.ends_at < timestamp
      ? 'expired'
      : row.starts_at !== null && row.starts_at > timestamp
        ? 'scheduled'
        : 'active',
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  }
}

// ----------------------------------------------------------------- socials --

/**
 * A profile social link as the API exposes it (R1.2).
 *
 * `userId` is deliberately absent — this resource is only ever read by its owner
 * (the public render is R1.7, through `toPublicPage`), so an id that is always the
 * caller's own tells them nothing and invites the `/pages/mine` mistake of leaking a
 * column just because the row had it. `position` IS present, because the editor
 * needs the slot even when the array is the only thing it renders from.
 *
 * There is no derived `label` or `icon`: the platform IS the icon, and
 * `SOCIAL_PLATFORMS` in `lib/constants.ts` is the contract `apps/web` renders from.
 */
export function toSocialLinkDto(row: UserSocialLinkRow): Record<string, unknown> {
  return {
    id: row.id,
    platform: row.platform,
    url: row.url,
    position: row.position,
    isVisible: row.is_visible === 1,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  }
}

// ------------------------------------------------------------------- media --

/**
 * A stored media asset as `POST /api/v1/media` answers (R1.3).
 *
 * Exactly the six fields ROADMAP §R1.3 names. What is deliberately absent:
 *
 *   * `ownerUserId` and `uploadedBy` — this endpoint only ever returns the caller's
 *     own upload, so an id that is always the caller's tells them nothing (the
 *     `/pages/mine` lesson).
 *   * `mime` — the type is a property of the bytes, and the bytes are fetchable at
 *     `url` with that `content-type`; echoing it invites a client to store a second
 *     copy of a fact the response already carries in a header.
 *   * `status`, `pageId`, `deletedAt` — internal bookkeeping. A `deleted` asset is a
 *     row that no longer answers at all (`DELETE` removes it), so there is no state
 *     for a client to read here.
 *   * `checksum` — operational (it is how a future pass finds duplicate objects); no
 *     client has a use for it, and exposing it would look like a verification
 *     contract this API does not offer.
 *
 * `key` IS present, and is the same string `PATCH /auth/me { avatarKey }` takes and
 * `url` ends with: the client is trusted with the object's identity, not with its
 * construction.
 */
export function toMediaAssetDto(row: MediaAssetRow): Record<string, unknown> {
  return {
    id: row.id,
    key: row.r2_key,
    url: mediaUrlFor(row.r2_key),
    width: row.width,
    height: row.height,
    bytes: row.size_bytes,
  }
}
