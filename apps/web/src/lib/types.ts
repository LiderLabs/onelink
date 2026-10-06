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
  settings: Record<string, string>
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
  displayName?: string
  bio?: string | null
  location?: string | null
  pronouns?: string | null
  username?: string
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
