import type { Role, UserStatus } from './lib/constants'

// ============================================================================
// Shared type surface: DB row shapes (snake_case, exactly as D1 returns them)
// and API/context shapes (camelCase). Keeping them distinct makes the mapping
// step explicit and greppable.
// ============================================================================

// --------------------------------------------------------------- DB rows ----

export interface UserRow {
  id: string
  email: string
  email_original: string | null
  email_verified: number
  email_verified_at: number | null
  username: string
  display_name: string | null
  bio: string | null
  /** R1.2: single-line identity fields, both nullable and both optional on write. */
  location: string | null
  pronouns: string | null
  avatar_key: string | null
  password_hash: string | null
  password_changed_at: number | null
  require_password_change: number
  role: Role
  status: UserStatus
  status_reason: string | null
  status_changed_at: number | null
  suspended_until: number | null
  suspended_permanently: number
  last_login_at: number | null
  last_login_ip: string | null
  login_count: number
  failed_login_count: number
  locked_until: number | null
  created_at: number
  created_at_iso?: string
  updated_at: number
  deleted_at: number | null
  deleted_by: string | null
}

export interface SessionRow {
  id: string
  user_id: string
  token_hash: string
  token_prefix: string | null
  user_agent: string | null
  ip: string | null
  device_label: string | null
  impersonated_by: string | null
  created_at: number
  last_used_at: number | null
  expires_at: number
  revoked_at: number | null
  revoked_reason: string | null
}

export interface SettingRow {
  key: string
  value: string
  type: 'string' | 'boolean' | 'number' | 'json'
  label: string | null
  grp: string | null
  description: string | null
  is_public: number
  updated_by: string | null
  updated_at: number
}

export interface AuditLogRow {
  id: string
  actor_user_id: string | null
  actor_label: string | null
  actor_role: string | null
  impersonated_by: string | null
  action: string
  target_type: string | null
  target_id: string | null
  target_label: string | null
  status: AuditStatus
  before: string | null
  after: string | null
  metadata: string | null
  ip: string | null
  user_agent: string | null
  request_id: string | null
  created_at: number
  created_at_iso?: string
}

export type SanctionType = 'warn' | 'suspend' | 'ban' | 'content_removal' | 'delete'

export interface SanctionRow {
  id: string
  user_id: string
  type: SanctionType
  reason: string
  category: string | null
  issued_by: string | null
  issued_by_label: string | null
  report_id: string | null
  duration_hours: number | null
  expires_at: number | null
  status: 'active' | 'expired' | 'lifted' | 'overturned'
  lifted_by: string | null
  lifted_at: number | null
  lift_reason: string | null
  created_at: number
}

export interface UserNoteRow {
  id: string
  user_id: string
  author_id: string | null
  author_label: string | null
  body: string
  created_at: number
}

/**
 * `user_social_links` as stored (0003). Column names are the migration's, as
 * everywhere else: the service reads and writes them directly, so a rename here
 * would silently diverge from the SQL.
 *
 * No `deleted_at` — a social row is hard-deleted (see the 0003 header), which is
 * why there is nothing to filter on the read path.
 */
export interface UserSocialLinkRow {
  id: string
  user_id: string
  /** One of `SOCIAL_PLATFORMS`. Read leniently: a value that left the list still reads back. */
  platform: string
  url: string
  position: number
  is_visible: number
  created_at: number
  updated_at: number
}

/**
 * `media_assets` as stored (0001). Column names are the migration's, as everywhere
 * else: the service reads and writes them directly, so a rename here would silently
 * diverge from the SQL.
 *
 * `owner_user_id` is nullable because 0001 declares that FK `ON DELETE SET NULL`: a
 * hard-deleted user leaves rows behind with no owner. Every ownership check therefore
 * compares against the caller's id rather than trusting a non-null column.
 * `width`/`height`/`checksum`/`deleted_at` are nullable because the table is shared
 * with the private evidence kinds; R1.3 always fills the first three — it refuses
 * bytes it cannot measure — and only ever reads rows with `status = 'active'`.
 */
export interface MediaAssetRow {
  id: string
  owner_user_id: string | null
  page_id: string | null
  r2_key: string
  bucket: 'public' | 'private'
  /** `avatar` | `page_image`, or a report/appeal evidence kind. The CHECK lists all four. */
  kind: string
  original_filename: string | null
  mime: string
  size_bytes: number
  width: number | null
  height: number | null
  checksum: string | null
  uploaded_by: string | null
  status: 'active' | 'deleted'
  created_at: number
  deleted_at: number | null
}

export type PageStatus = 'draft' | 'published' | 'archived'
/** Mirrors the CHECK in migrations/0001_init.sql — note there is no `flagged`. */
export type PageModerationStatus = 'visible' | 'under_review' | 'removed'
export type PageVisibility = 'public' | 'unlisted'
/** Only ever written as these two by the API; the 0001 column has no CHECK. */
export type PageTheme = 'light' | 'dark'
/** Enforced by the zod schema: 0002 could not add a CHECK via ALTER TABLE. */
export type PageLayout = 'list' | 'grid'

/**
 * `pages` as stored. Column names are the migration's, deliberately: the service
 * reads and writes them directly, so a rename here silently diverges from the
 * SQL. `layout`, `accent_color` and `show_branding` arrive in 0002.
 */
export interface PageRow {
  id: string
  user_id: string
  slug: string
  title: string | null
  bio: string | null
  theme: PageTheme | null
  layout: PageLayout
  accent_color: string | null
  show_branding: number
  status: PageStatus
  moderation_status: PageModerationStatus
  visibility: PageVisibility
  open_report_count: number
  flag_count: number
  view_count: number
  content_revision: number
  published_at: number | null
  first_published_at: number | null
  created_at: number
  updated_at: number
  deleted_at: number | null
}

/** `page_links` as stored: display text is `title`, the icon is `icon`. */
export interface PageLinkRow {
  id: string
  page_id: string
  title: string
  url: string
  domain: string | null
  icon: string | null
  description: string | null
  position: number
  is_visible: number
  starts_at: number | null
  ends_at: number | null
  clicks: number
  created_at: number
  updated_at: number
  deleted_at: number | null
}

/** `page_revisions.reason` is NOT NULL and CHECKed, so publishes must pass one. */
export type PageRevisionReason =
  | 'publish'
  | 'edit'
  | 'report'
  | 'moderation_removal'
  | 'moderation_restore'
  | 'daily'

export interface PageRevisionRow {
  id: string
  page_id: string
  revision: number
  snapshot: string
  reason: PageRevisionReason
  created_by: string | null
  created_at: number
}

export interface SlugReservationRow {
  id: string
  slug: string
  page_id: string | null
  reserved_by: string | null
  reason: string
  created_at: number
  released_at: number | null
}

export interface RateLimitRow {
  key: string
  scope: 'ip' | 'user' | 'global'
  max_requests: number
  window_seconds: number
  action: 'block' | 'throttle' | 'captcha'
  enabled: number
  updated_by: string | null
  updated_at: number
}

// ------------------------------------------------------------- API shapes ----

export interface ApiUser {
  id: string
  email: string
  username: string
  displayName: string
  bio: string | null
  /** R1.2. Both are plain text the owner writes; both are absent/`null` when unset. */
  location: string | null
  pronouns: string | null
  avatarKey: string | null
  /**
   * R1.3: the servable URL of `avatarKey`, or `null` when there is no avatar.
   *
   * Derived, not stored — `toApiUser` builds it from the key, so a client never has
   * to know how a media URL is shaped, and a future move to an R2 public domain is
   * one function in `lib/media.ts` rather than a client release. Root-relative, so it
   * is correct on any origin this API is served from.
   */
  avatarUrl: string | null
  role: Role
  status: UserStatus
  statusReason: string | null
  suspendedUntil: number | null
  suspendedPermanently: boolean
  emailVerified: boolean
  requirePasswordChange: boolean
  lastLoginAt: number | null
  loginCount: number
  createdAt: number
  updatedAt: number
  deletedAt: number | null
}

export interface AuthUser extends ApiUser {
  sessionId: string
  sessionExpiresAt: number
  /** Non-null when this session was minted by an admin acting as this user. */
  impersonatedBy: string | null
}

/** Identity of whoever caused a change, as services need it for audit rows. */
export interface ActorInfo {
  id: string
  role: Role
  label: string
}

// ------------------------------------------------------------------ audit ----

export type AuditStatus = 'success' | 'failure' | 'denied'

export interface AuditDraft {
  action: string
  targetType?: string | null
  targetId?: string | null
  targetLabel?: string | null
  status?: AuditStatus
  before?: unknown
  after?: unknown
  metadata?: unknown
  /** Overrides, for entries recorded outside a request (cron, seed). */
  actorUserId?: string | null
  actorLabel?: string | null
  actorRole?: string | null
  impersonatedBy?: string | null
}

/** A fully-resolved audit row, ready to bind into an INSERT. */
export interface AuditEntry {
  id: string
  createdAt: number
  action: string
  status: AuditStatus
  actorUserId: string | null
  actorLabel: string | null
  actorRole: string | null
  impersonatedBy: string | null
  targetType: string | null
  targetId: string | null
  targetLabel: string | null
  before: string | null
  after: string | null
  metadata: string | null
  ip: string | null
  userAgent: string | null
  requestId: string
}

/**
 * Request-scoped audit collector.
 *
 * Mutating services call `claim()` to obtain the entry, then include
 * `auditInsertStmt(db, entry)` in the SAME `db.batch()` as their writes, so the
 * log row commits atomically with the change it describes. Claiming also marks
 * the request as handled, which stops the fallback logger from writing a second
 * generic row for the same request.
 */
export interface Auditor {
  readonly handled: boolean
  readonly entries: readonly AuditEntry[]
  claim(draft: AuditDraft): AuditEntry
}

// ------------------------------------------------------------- pagination ----

export interface Pagination {
  page: number
  limit: number
  offset: number
}

export interface ListMeta extends Record<string, unknown> {
  requestId: string
  page: number
  limit: number
  total: number
  totalPages: number
}

// --------------------------------------------------- Hono context bindings --

export interface AppVariables {
  requestId: string
  user: AuthUser | null
  session: SessionRow | null
  auditor: Auditor
}

// `Cloudflare.Env` is generated by `wrangler types` (worker-configuration.d.ts)
// and augmented in src/env.d.ts. It is the single binding type for this project.
export type AppEnv = { Bindings: Cloudflare.Env; Variables: AppVariables }

