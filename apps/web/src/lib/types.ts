// ============================================================================
// Wire types for /api/v1.
//
// Hand-written mirrors of the API's public projections (`src/services/mappers.ts`
// on the server). They are deliberately a copy rather than a shared package:
// the server DTOs are the contract, and a shared type would let a server-side
// refactor silently change what the browser believes it is receiving.
//
// Everything the API sends is already in public/camelCase form, and nothing
// secret is ever included (no password hashes, no tokens: the session lives in
// an httpOnly cookie the browser never exposes to JavaScript).
// ============================================================================

export type Role = 'owner' | 'admin' | 'moderator' | 'support' | 'user'

export type UserStatus = 'active' | 'pending' | 'suspended' | 'banned' | 'deleted'

/**
 * A user as the API projects it. Shared by /auth/me and the admin endpoints.
 *
 * `displayName` is `string`, not `string | null`, because the server never sends
 * null: `toApiUser` falls back to the username. A nullable type here would invite
 * a `?? username` at every call site and hide that the fallback already happened.
 */
export interface PublicUser {
  id: string
  email: string
  username: string
  displayName: string
  bio: string | null
  /** R1.2. Plain text the owner writes; null when unset. */
  location: string | null
  pronouns: string | null
  avatarKey: string | null
  /**
   * R1.3: the public URL of the avatar, derived from `avatarKey` by the API
   * (`mediaUrlFor`) and `null` when the account has none. Read this instead of
   * building one — where a media object is served from is the server's business,
   * which is what lets the bucket move to a custom domain without a client release.
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

/** /auth/me additionally describes the current session. */
export interface SessionUser extends PublicUser {
  sessionId: string
  sessionExpiresAt: number
  impersonatedBy: string | null
}

export interface MeResponse {
  user: SessionUser
  capabilities: string[]
  platformName: string
  serverTime: number
}

/** POST /auth/login and /auth/register (register answers 201). */
export interface AuthResponse {
  user: SessionUser
  capabilities: string[]
  expiresAt: number
}

/** POST /auth/change-password. */
export interface ChangePasswordResponse {
  revokedSessions: number
}

/**
 * POST /auth/forgot-password.
 *
 * `accepted` is true whether or not the address exists — the endpoint is
 * deliberately not an account-existence oracle. `devToken` only appears outside
 * production, where there is no mail provider yet: the UI shows it as a
 * stand-in for the emailed link rather than pretending an email was sent.
 */
export interface ForgotPasswordResponse {
  accepted: boolean
  devToken?: string | null
}

/** POST /auth/reset-password. */
export interface ResetPasswordResponse {
  userId: string
  username: string
  revokedSessions: number
}

export interface RoleDescriptor {
  role: Role
  rank: number
  staff: boolean
}

/** GET /public/settings — the unauthenticated bootstrap surface. */
export interface PublicSettings {
  platformName: string
  settings: Record<string, unknown>
  roles: RoleDescriptor[]
}

// ------------------------------------------------------- profile identity ----

/**
 * The platforms a social link may claim — `SOCIAL_PLATFORMS` in
 * `apps/api/src/lib/constants.ts`, verbatim.
 *
 * A closed union rather than `string`, because the API rejects anything else with
 * a `422` and the platform *is* the icon the list renders. The runtime array in
 * `features/profile/social-platforms.ts` is asserted against this union, so the
 * two cannot drift without a compile error.
 */
export type SocialPlatform =
  | 'website'
  | 'x'
  | 'twitter'
  | 'bluesky'
  | 'threads'
  | 'mastodon'
  | 'instagram'
  | 'facebook'
  | 'linkedin'
  | 'github'
  | 'gitlab'
  | 'youtube'
  | 'tiktok'
  | 'twitch'
  | 'vimeo'
  | 'spotify'
  | 'soundcloud'
  | 'discord'
  | 'telegram'
  | 'whatsapp'
  | 'reddit'
  | 'pinterest'
  | 'dribbble'
  | 'behance'
  | 'medium'
  | 'substack'
  | 'patreon'
  | 'ko-fi'

/** One row of `GET /profile/socials`. `position` is the stored slot, 0-based. */
export interface SocialLink {
  id: string
  platform: SocialPlatform
  url: string
  position: number
  isVisible: boolean
  createdAt: number
  updatedAt: number
}

export interface SocialsResponse {
  socials: SocialLink[]
}

/**
 * The body of `PATCH /auth/me` (R1.1 + R1.2).
 *
 * Only the keys present are written — the service reads `undefined` as "not in
 * the body" — and `null` is how the nullable text columns are cleared. A `""` is
 * not the same thing on the wire: for `displayName` it is a `422`, so the editor
 * sends `null` for the clearable ones and never an empty string.
 */
export interface UpdateProfileInput {
  avatarKey?: string | null
  expectedAvatarKey?: string | null
  displayName?: string
  bio?: string | null
  location?: string | null
  pronouns?: string | null
  username?: string
  expected?: Partial<Pick<PublicUser, 'displayName' | 'bio' | 'location' | 'pronouns' | 'username'>>
}

/** `PATCH /auth/me` answers the identity half only — no session fields. */
export interface UpdateProfileResponse {
  user: PublicUser
}

export interface CreateSocialInput {
  platform: SocialPlatform
  url: string
  isVisible?: boolean
}

/** A delta edit; a social has nothing clearable, only replaceable. */
export interface UpdateSocialInput {
  platform?: SocialPlatform
  url?: string
  isVisible?: boolean
}

// -------------------------------------------------------------------- pages --

export type PageTheme = 'light' | 'dark'
export type PageLayout = 'list' | 'grid'
export type PageStatus = 'draft' | 'published' | 'archived'
export type ModerationStatus = 'visible' | 'under_review' | 'removed'

export interface OwnerPage {
  id: string
  /** Present on the API's page listing; creation responses are owner-only. */
  accessRole?: 'owner' | 'editor' | 'viewer'
  slug: string
  title: string | null
  bio: string | null
  theme: PageTheme
  layout: PageLayout
  accentColor: string | null
  showBranding: boolean
  status: PageStatus
  moderationStatus: ModerationStatus
  visibility: string
  revision: number | null
  unpublishedChanges: boolean
  publishedAt: number | null
  createdAt: number
  updatedAt: number
  deletedAt: number | null
}

export interface PageLink {
  id: string
  title: string
  url: string
  domain: string | null
  description: string | null
  icon: string | null
  position: number
  isVisible: boolean
  startsAt: number | null
  endsAt: number | null
  groupId: string | null
  openInNewTab: boolean
  thumbnailKey: string | null
  status: 'scheduled' | 'active' | 'expired'
  createdAt: number
  updatedAt: number
}

export interface OwnerPageDetail {
  page: OwnerPage
  links: PageLink[]
}

export interface PageListMeta {
  page: number
  limit: number
  total: number
  totalPages: number
}

export interface CreatePageInput {
  slug?: string
  title?: string
  bio?: string
  theme?: PageTheme
  layout?: PageLayout
  accentColor?: string | null
  showBranding?: boolean
}

export interface UpdatePageInput {
  slug?: string
  title?: string | null
  bio?: string | null
  theme?: PageTheme
  layout?: PageLayout
  accentColor?: string | null
  showBranding?: boolean
}

export interface PageLinkInput {
  title: string
  url: string
  description?: string | null
  icon?: string | null
  isVisible?: boolean
  startsAt?: number | null
  endsAt?: number | null
  groupId?: string | null
  openInNewTab?: boolean
  thumbnailKey?: string | null
}

export interface LinkGroup {
  id: string
  name: string
  position: number
}

export interface PageDraftContent {
  v: 1
  page: {
    title: string | null
    bio: string | null
    theme: PageTheme
    layout: PageLayout
    accentColor: string | null
    showBranding: boolean
  }
  groups: Array<{ id?: string; name: string }>
  links: Array<{
    id?: string
    title: string
    url: string
    description: string | null
    icon: string | null
    isVisible: boolean
    groupId: string | null
    openInNewTab: boolean
    thumbnailKey: string | null
    startsAt: number | null
    endsAt: number | null
  }>
}

export interface PageDraftState {
  content: PageDraftContent
  updatedAt: number | null
  unpublishedChanges: boolean
}

export interface PageRevision {
  revision: number
  reason: string
  createdAt: number
}

export interface PublicPageOwner {
  username: string
  displayName: string
  avatarUrl: string | null
  bio: string | null
  location: string | null
  pronouns: string | null
  socials: Array<{ platform: SocialPlatform; url: string; position: number }>
}

export interface PublicPageDto {
  slug: string
  title: string | null
  bio: string | null
  theme: PageTheme
  layout: PageLayout
  accentColor: string | null
  showBranding: boolean
  owner: PublicPageOwner
  links: PageLink[]
  groups: Array<{ id: string; name: string; position: number }>
}
