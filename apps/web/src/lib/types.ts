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

/** A user as the API projects it. Shared by /auth/me and the admin endpoints. */
export interface PublicUser {
  id: string
  email: string
  username: string
  displayName: string | null
  bio: string | null
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
