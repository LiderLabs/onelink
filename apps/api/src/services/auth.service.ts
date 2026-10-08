import { addMs, humanizeDuration, isExpired, now } from '../lib/clock'
import {
  LOCKOUT_MS,
  MAX_FAILED_LOGINS,
  MIN_PASSWORD_LENGTH,
  PASSWORD_RESET_TTL_MS,
  SESSION_ABSOLUTE_TTL_MS,
  SESSION_TOUCH_AFTER_MS,
  SESSION_TTL_MS,
} from '../lib/constants'
import { hashPassword, hashToken, randomToken, verifyPassword } from '../lib/crypto'
import {
  accountDisabled,
  accountLocked,
  badRequest,
  notFound,
  unauthenticated,
} from '../lib/errors'
import { normalizeEmail, normalizeUsername } from '../lib/http'
import { ulid } from '../lib/ids'
import { actorLabelOf, auditInsertStmt } from './audit.service'
import { toAuthUser } from './mappers'
import { SETTING_KEYS, getStringSetting } from './settings.service'
import type { AppConfig } from '../lib/config'
import type { ActorInfo, Auditor, AuthUser, SessionRow, UserRow } from '../types'

// ============================================================================
// Sessions and credentials.
//
// Sessions are opaque random tokens in an httpOnly cookie, NOT JWTs. The
// database row is the authority, which is what makes "ban this user" and
// "revoke this device" take effect instantly instead of whenever a token
// happens to expire.
// ============================================================================

interface SessionJoinRow extends UserRow {
  s_id: string
  s_user_id: string
  s_token_hash: string
  s_token_prefix: string | null
  s_user_agent: string | null
  s_ip: string | null
  s_device_label: string | null
  s_impersonated_by: string | null
  s_created_at: number
  s_last_used_at: number | null
  s_expires_at: number
  s_revoked_at: number | null
  s_revoked_reason: string | null
}

/**
 * Every session column is aliased with an `s_` prefix because `u.*` also has
 * `id`, `created_at`, `ip` and `user_agent`; without the aliases one set would
 * silently shadow the other.
 */
const SESSION_SELECT = `
SELECT
  s.id              AS s_id,
  s.user_id         AS s_user_id,
  s.token_hash      AS s_token_hash,
  s.token_prefix    AS s_token_prefix,
  s.user_agent      AS s_user_agent,
  s.ip              AS s_ip,
  s.device_label    AS s_device_label,
  s.impersonated_by AS s_impersonated_by,
  s.created_at      AS s_created_at,
  s.last_used_at    AS s_last_used_at,
  s.expires_at      AS s_expires_at,
  s.revoked_at      AS s_revoked_at,
  s.revoked_reason  AS s_revoked_reason,
  u.*
FROM sessions s
JOIN users u ON u.id = s.user_id
`

function sessionFromJoin(row: SessionJoinRow): SessionRow {
  return {
    id: row.s_id,
    user_id: row.s_user_id,
    token_hash: row.s_token_hash,
    token_prefix: row.s_token_prefix,
    user_agent: row.s_user_agent,
    ip: row.s_ip,
    device_label: row.s_device_label,
    impersonated_by: row.s_impersonated_by,
    created_at: row.s_created_at,
    last_used_at: row.s_last_used_at,
    expires_at: row.s_expires_at,
    revoked_at: row.s_revoked_at,
    revoked_reason: row.s_revoked_reason,
  }
}

export interface ResolvedSession {
  session: SessionRow
  user: AuthUser
}

/**
 * Looks up a live session by its raw cookie token. Returns null for revoked,
 * expired or orphaned sessions — callers cannot tell the difference between
 * those cases, and should not be able to.
 */
export async function resolveSession(
  db: D1Database,
  config: AppConfig,
  token: string,
): Promise<ResolvedSession | null> {
  const tokenHash = await hashToken(token, config.sessionPepper)
  const row = await db
    .prepare(`${SESSION_SELECT} WHERE s.token_hash = ? LIMIT 1`)
    .bind(tokenHash)
    .first<SessionJoinRow>()

  if (!row) return null

  const session = sessionFromJoin(row)
  const current = now()
  if (session.revoked_at !== null) return null
  if (isExpired(session.expires_at, current)) return null
  // A soft-deleted user is hard-stopped even if a session somehow survives.
  if (row.deleted_at !== null || row.status === 'deleted') return null

  return { session, user: toAuthUser(row, session) }
}

/**
 * A sanction revokes every session, but the affected person still needs a way
 * to appeal without re-enabling their normal account access. This accepts only
 * the prior, unexpired cookie for this user's suspension/ban appeal endpoints.
 */
export async function resolveSanctionAppealSession(
  db: D1Database,
  config: AppConfig,
  token: string,
): Promise<ResolvedSession | null> {
  const tokenHash = await hashToken(token, config.sessionPepper)
  const row = await db.prepare(`${SESSION_SELECT}
    WHERE s.token_hash=? AND s.revoked_at IS NOT NULL LIMIT 1`).bind(tokenHash).first<SessionJoinRow>()
  if (!row) return null

  const session = sessionFromJoin(row)
  const current = now()
  if (session.expires_at <= current || session.impersonated_by !== null || row.deleted_at !== null || row.status === 'deleted') {
    return null
  }
  if (session.revoked_reason !== 'user.suspend' && session.revoked_reason !== 'user.ban') return null
  if (row.status !== 'suspended' && row.status !== 'banned') return null
  const activeSanction = await db.prepare(`SELECT id FROM sanctions WHERE user_id=? AND status='active'
    AND type IN ('suspend','ban') AND reason=? LIMIT 1`).bind(row.id, row.status_reason).first()
  if (!activeSanction) return null
  return { session, user: toAuthUser(row, session) }
}

/**
 * Slides an active session forward, at most once every SESSION_TOUCH_AFTER_MS
 * so a busy client does not cause a database write per request. The extension
 * is capped by SESSION_ABSOLUTE_TTL_MS.
 *
 * Returns true when a write actually happened.
 */
export async function touchSession(
  db: D1Database,
  session: SessionRow,
  current = now(),
): Promise<boolean> {
  const lastSeen = session.last_used_at ?? session.created_at
  if (current - lastSeen < SESSION_TOUCH_AFTER_MS) return false

  const ceiling = session.created_at + SESSION_ABSOLUTE_TTL_MS
  const expiresAt = Math.min(addMs(current, SESSION_TTL_MS), ceiling)

  const result = await db
    .prepare(
      'UPDATE sessions SET last_used_at = ?, expires_at = ? WHERE id = ? AND revoked_at IS NULL',
    )
    .bind(current, expiresAt, session.id)
    .run()

  if ((result.meta.changes ?? 0) > 0) {
    session.last_used_at = current
    session.expires_at = expiresAt
    return true
  }
  return false
}

export function sessionPrefixOf(token: string): string {
  return token.slice(0, 8)
}

/** Prepared statement that revokes every live session for a user. */
export function revokeSessionsStmt(
  db: D1Database,
  userId: string,
  reason: string,
  exceptSessionId: string | null = null,
  timestamp = now(),
): D1PreparedStatement {
  if (exceptSessionId) {
    return db
      .prepare(
        'UPDATE sessions SET revoked_at = ?, revoked_reason = ? WHERE user_id = ? AND revoked_at IS NULL AND id != ?',
      )
      .bind(timestamp, reason, userId, exceptSessionId)
  }
  return db
    .prepare(
      'UPDATE sessions SET revoked_at = ?, revoked_reason = ? WHERE user_id = ? AND revoked_at IS NULL',
    )
    .bind(timestamp, reason, userId)
}

export async function revokeAllSessions(
  db: D1Database,
  userId: string,
  reason: string,
  exceptSessionId: string | null = null,
): Promise<number> {
  const result = await revokeSessionsStmt(db, userId, reason, exceptSessionId).run()
  return result.meta.changes ?? 0
}

export async function countActiveSessions(
  db: D1Database,
  userId: string,
  current = now(),
): Promise<number> {
  const row = await db
    .prepare(
      'SELECT count(*) AS total FROM sessions WHERE user_id = ? AND revoked_at IS NULL AND expires_at > ?',
    )
    .bind(userId, current)
    .first<{ total: number }>()
  return row?.total ?? 0
}

export async function listUserSessions(db: D1Database, userId: string): Promise<SessionRow[]> {
  const { results } = await db
    .prepare(
      'SELECT * FROM sessions WHERE user_id = ? AND revoked_at IS NULL AND expires_at > ? ORDER BY created_at DESC LIMIT 50',
    )
    .bind(userId, now())
    .all<SessionRow>()
  return results
}

/**
 * Link a user clicks to choose a new password.
 *
 * Prefers APP_ORIGIN (the admin SPA) and falls back to the platform's public
 * base URL, so a deployment that never sets APP_ORIGIN still produces a
 * usable — if less pretty — link rather than a broken one.
 */
export async function buildPasswordResetUrl(
  env: Cloudflare.Env,
  token: string,
): Promise<string> {
  const base =
    env.APP_ORIGIN.length > 0
      ? env.APP_ORIGIN
      : await getStringSetting(env.DB, SETTING_KEYS.pagesBaseUrl, 'https://onelink.local/')
  return `${base.replace(/\/+$/, '')}/reset-password?token=${encodeURIComponent(token)}`
}

// ------------------------------------------------------------------ login ---

/**
 * A real PBKDF2 hash computed once per isolate and verified against when the
 * email does not exist. Without it, a missing account would skip the expensive
 * derivation entirely and login latency would leak which emails are registered.
 */
let timingEqualizer: Promise<string> | null = null
function equalizerHash(iterations: number): Promise<string> {
  timingEqualizer ??= hashPassword(randomToken(24), iterations)
  return timingEqualizer
}

/** Rough "Chrome on Windows" label from a User-Agent string. */
export function describeUserAgent(userAgent: string | null): string | null {
  if (!userAgent) return null
  const browser = /Edg\//.test(userAgent)
    ? 'Edge'
    : /OPR\//.test(userAgent)
      ? 'Opera'
      : /Firefox\//.test(userAgent)
        ? 'Firefox'
        : /Chrome\//.test(userAgent)
          ? 'Chrome'
          : /Safari\//.test(userAgent)
            ? 'Safari'
            : 'Unknown browser'
  const os = /Windows/.test(userAgent)
    ? 'Windows'
    : /Mac OS X|Macintosh/.test(userAgent)
      ? 'macOS'
      : /Android/.test(userAgent)
        ? 'Android'
        : /iPhone|iPad/.test(userAgent)
          ? 'iOS'
          : /Linux/.test(userAgent)
            ? 'Linux'
            : 'Unknown OS'
  return `${browser} on ${os}`
}

export interface LoginInput {
  /** A username or an email address — see `authSchema.loginSchema`. */
  identifier: string
  password: string
  ip: string | null
  userAgent: string | null
}

export interface SessionResult {
  token: string
  user: AuthUser
  session: SessionRow
}

/** A successful credential exchange: what `login()` (and sign-up) hand back. */
export type LoginResult = SessionResult

/**
 * Everyone who can check a password shares this policy.
 *
 * It lives here because there are now three callers — self-service change,
 * reset redemption and public sign-up — and a policy that only two of them
 * apply is not a policy.
 */
export function assertPasswordAcceptable(
  password: string,
  identifiers: readonly (string | null | undefined)[] = [],
): void {
  if (password.length < MIN_PASSWORD_LENGTH) {
    throw badRequest(`Passwords must be at least ${MIN_PASSWORD_LENGTH} characters.`)
  }

  const haystack = password.toLowerCase()
  for (const identifier of identifiers) {
    // A 1-2 character local part would match too much; the schema already
    // enforces a 3-character floor everywhere an identifier can come from.
    if (typeof identifier !== 'string' || identifier.length < 3) continue
    if (haystack.includes(identifier.toLowerCase())) {
      throw badRequest('The password must not contain your email address or username.')
    }
  }
}

async function registerFailedLogin(
  db: D1Database,
  user: UserRow,
  timestamp: number,
  auditor: Auditor,
): Promise<void> {
  const entry = auditor.claim({
    action: 'auth.login.failed',
    status: 'denied',
    targetType: 'user',
    targetId: user.id,
    targetLabel: user.email,
    actorUserId: user.id,
    actorLabel: user.email,
    actorRole: user.role,
  })

  await db.batch([
    db
      .prepare(
        `UPDATE users
            SET failed_login_count = CASE
                  WHEN failed_login_count + 1 >= ? THEN 0
                  ELSE failed_login_count + 1
                END,
                locked_until = CASE
                  WHEN failed_login_count + 1 >= ? THEN ?
                  ELSE NULL
                END,
                updated_at = ?
          WHERE id = ? AND (locked_until IS NULL OR locked_until <= ?)`,
      )
      // Increment from the database's current value, not the potentially stale
      // row read before password verification; concurrent failures must all count.
      .bind(
        MAX_FAILED_LOGINS,
        MAX_FAILED_LOGINS,
        addMs(timestamp, LOCKOUT_MS),
        timestamp,
        user.id,
        timestamp,
      ),
    auditInsertStmt(db, entry),
  ])
}

export interface MintSessionInput {
  user: UserRow
  ip: string | null
  userAgent: string | null
  /** Audit action. Sign-up records `auth.register`; everything else logs in. */
  action?: string
  /** Extra audit metadata merged into the session entry. */
  metadata?: Record<string, unknown>
  /**
   * Plaintext to re-hash into `password_hash` when the stored hash used fewer
   * iterations than we now demand (a transparent upgrade). The caller decides:
   * only the login path knows whether verification reported `needsRehash`.
   */
  rehashPassword?: string | undefined
}

/**
 * Mints a session for `user`, stamps the login counters and audits it.
 *
 * Extracted from `login()` so sign-up can hand a brand-new account exactly the
 * session it would have obtained by logging in. One place builds the token, the
 * expiry and the `login_count` / `last_login_*` bookkeeping, so the two flows
 * cannot drift apart.
 */
export async function mintSession(
  db: D1Database,
  config: AppConfig,
  input: MintSessionInput,
  auditor: Auditor,
): Promise<SessionResult> {
  const { user } = input
  const timestamp = now()
  const token = randomToken(32)
  const tokenHash = await hashToken(token, config.sessionPepper)

  const session: SessionRow = {
    id: ulid(),
    user_id: user.id,
    token_hash: tokenHash,
    token_prefix: sessionPrefixOf(token),
    user_agent: input.userAgent,
    ip: input.ip,
    device_label: describeUserAgent(input.userAgent),
    impersonated_by: null,
    created_at: timestamp,
    last_used_at: timestamp,
    expires_at: addMs(timestamp, SESSION_TTL_MS),
    revoked_at: null,
    revoked_reason: null,
  }

  const entry = auditor.claim({
    action: input.action ?? 'auth.login',
    targetType: 'user',
    targetId: user.id,
    targetLabel: user.email,
    actorUserId: user.id,
    actorLabel: actorLabelOf(user),
    actorRole: user.role,
    metadata: { device: session.device_label, ...input.metadata },
  })

  const statements: D1PreparedStatement[] = [
    db
      .prepare(
        `INSERT INTO sessions (
           id, user_id, token_hash, token_prefix, user_agent, ip, device_label,
           impersonated_by, created_at, last_used_at, expires_at
         ) VALUES (?,?,?,?,?,?,?,?,?,?,?)`,
      )
      .bind(
        session.id,
        session.user_id,
        session.token_hash,
        session.token_prefix,
        session.user_agent,
        session.ip,
        session.device_label,
        session.impersonated_by,
        session.created_at,
        session.last_used_at,
        session.expires_at,
      ),
    db
      .prepare(
        `UPDATE users
            SET last_login_at = ?, last_login_ip = ?, login_count = login_count + 1,
                failed_login_count = 0, locked_until = NULL, updated_at = ?
          WHERE id = ?`,
      )
      .bind(timestamp, input.ip, timestamp, user.id),
  ]

  if (input.rehashPassword !== undefined) {
    statements.push(
      db
        .prepare('UPDATE users SET password_hash = ? WHERE id = ?')
        .bind(await hashPassword(input.rehashPassword, config.pbkdf2Iterations), user.id),
    )
  }

  statements.push(auditInsertStmt(db, entry))
  await db.batch(statements)

  const authenticated: AuthUser = {
    ...toAuthUser(user, session),
    lastLoginAt: timestamp,
    loginCount: user.login_count + 1,
  }

  return { token, user: authenticated, session }
}

/**
 * Verifies credentials and mints a session.
 *
 * Order matters: lockout is checked before the password derivation (so a locked
 * account cannot be used to burn CPU), and account status is only revealed
 * AFTER the password is proven correct — otherwise a 403 would tell an attacker
 * which accounts exist.
 */
export async function login(
  db: D1Database,
  config: AppConfig,
  input: LoginInput,
  auditor: Auditor,
): Promise<SessionResult> {
  // A username can never contain '@' and an email always does, so that single
  // character picks which column to probe: one unique-index lookup, no OR
  // across two indexes, and no ambiguity between the two namespaces.
  const identifier = input.identifier.trim()
  const byEmail = identifier.includes('@')
  const lookup = byEmail ? normalizeEmail(identifier) : normalizeUsername(identifier)
  const timestamp = now()

  const user = await db
    .prepare(
      byEmail
        ? 'SELECT * FROM users WHERE email = ? LIMIT 1'
        : 'SELECT * FROM users WHERE username = ? LIMIT 1',
    )
    .bind(lookup)
    .first<UserRow>()

  if (user && user.locked_until !== null && user.locked_until > timestamp) {
    throw accountLocked(
      `Too many failed attempts. Try again in ${humanizeDuration(user.locked_until - timestamp)}.`,
      (user.locked_until - timestamp) / 1000,
    )
  }

  const liveUser = user && user.deleted_at === null && user.status !== 'deleted' ? user : null
  const stored = liveUser?.password_hash ?? (await equalizerHash(config.pbkdf2Iterations))
  const verified = await verifyPassword(input.password, stored, config.pbkdf2Iterations)

  if (!liveUser || !verified.ok) {
    if (liveUser) await registerFailedLogin(db, liveUser, timestamp, auditor)
    throw unauthenticated('Incorrect username or password.')
  }

  if (liveUser.status === 'banned' || liveUser.status === 'suspended') {
    const entry = auditor.claim({
      action: 'auth.login.blocked',
      status: 'denied',
      targetType: 'user',
      targetId: liveUser.id,
      targetLabel: liveUser.email,
      actorUserId: liveUser.id,
      actorLabel: liveUser.email,
      actorRole: liveUser.role,
      metadata: { status: liveUser.status, reason: liveUser.status_reason },
    })
    await auditInsertStmt(db, entry).run()
    throw accountDisabled(liveUser.status_reason ?? 'This account is not currently available.')
  }

  return mintSession(
    db,
    config,
    {
      user: liveUser,
      ip: input.ip,
      userAgent: input.userAgent,
      // Settled by the verification above: only a stale hash is re-derived.
      rehashPassword: verified.needsRehash ? input.password : undefined,
    },
    auditor,
  )
}

// ----------------------------------------------------------------- logout ---

export interface LogoutInput {
  sessionId: string
  userId: string
  userLabel: string
  reason?: string
}

export async function logout(
  db: D1Database,
  input: LogoutInput,
  auditor: Auditor,
): Promise<void> {
  const reason = input.reason ?? 'user_logout'

  const entry = auditor.claim({
    action: 'auth.logout',
    targetType: 'user',
    targetId: input.userId,
    targetLabel: input.userLabel,
    metadata: { sessionId: input.sessionId, reason },
  })

  await db.batch([
    db
      .prepare(
        'UPDATE sessions SET revoked_at = ?, revoked_reason = ? WHERE id = ? AND revoked_at IS NULL',
      )
      .bind(now(), reason, input.sessionId),
    auditInsertStmt(db, entry),
  ])
}

// -------------------------------------------------------- changing secrets ---

export interface ChangePasswordInput {
  userId: string
  /** Required for self-service; null when an admin is forcing a reset. */
  currentPassword: string | null
  newPassword: string
  /** Session to keep alive (the caller's own), or null to revoke them all. */
  keepSessionId: string | null
  reason: string
  selfService: boolean
  /**
   * True when an admin set a temporary password: the user must choose their own
   * before they can do anything else. False clears any outstanding flag, which
   * is what a normal self-service change should do.
   */
  requirePasswordChange?: boolean
}

export interface ChangePasswordResult {
  userId: string
  revokedSessions: number
}

/**
 * Changes a password, revoking every session except the one performing the
 * change. A password change is the standard "I think I'm compromised" action,
 * so leaving other sessions alive would defeat its purpose.
 */
export async function changePassword(
  db: D1Database,
  config: AppConfig,
  actor: ActorInfo,
  input: ChangePasswordInput,
  auditor: Auditor,
): Promise<ChangePasswordResult> {
  const user = await db
    .prepare('SELECT * FROM users WHERE id = ? LIMIT 1')
    .bind(input.userId)
    .first<UserRow>()

  if (!user || user.deleted_at !== null) throw notFound('User')

  if (input.currentPassword !== null) {
    const verified = await verifyPassword(
      input.currentPassword,
      user.password_hash,
      config.pbkdf2Iterations,
    )
    if (!verified.ok) throw badRequest('Your current password is incorrect.')
  }

  if (input.newPassword === input.currentPassword) {
    throw badRequest('The new password must be different from the current one.')
  }
  assertPasswordAcceptable(input.newPassword, [user.email, user.username])

  const timestamp = now()
  const passwordHash = await hashPassword(input.newPassword, config.pbkdf2Iterations)

  const entry = auditor.claim({
    action: 'auth.password.change',
    targetType: 'user',
    targetId: user.id,
    targetLabel: user.email,
    actorUserId: actor.id,
    actorRole: actor.role,
    actorLabel: actor.label,
    metadata: { selfService: input.selfService, reason: input.reason },
  })

  const results = await db.batch([
    db
      .prepare(
        `UPDATE users
            SET password_hash = ?, password_changed_at = ?, require_password_change = ?, updated_at = ?
          WHERE id = ?`,
      )
      .bind(
        passwordHash,
        timestamp,
        input.requirePasswordChange === true ? 1 : 0,
        timestamp,
        user.id,
      ),
    revokeSessionsStmt(db, user.id, input.reason, input.keepSessionId, timestamp),
    auditInsertStmt(db, entry),
  ])

  return { userId: user.id, revokedSessions: results[1]?.meta.changes ?? 0 }
}

// --------------------------------------------------------- password resets ---

export interface CreateResetInput {
  email: string
  requestIp: string | null
  requestedBy: ActorInfo | null
}

export interface PasswordResetTicket {
  userId: string
  email: string
  displayName: string
  token: string
  expiresAt: number
}

/**
 * Mints a single-use reset token.
 *
 * Returns null when the address is unknown so the route can respond identically
 * either way — this endpoint must never become an account-existence oracle.
 */
export async function createPasswordReset(
  db: D1Database,
  config: AppConfig,
  input: CreateResetInput,
  auditor: Auditor,
): Promise<PasswordResetTicket | null> {
  const email = normalizeEmail(input.email)

  const user = await db
    .prepare('SELECT * FROM users WHERE email = ? LIMIT 1')
    .bind(email)
    .first<UserRow>()

  if (!user || user.deleted_at !== null || user.status === 'deleted') return null

  const token = randomToken(32)
  const tokenHash = await hashToken(token, config.sessionPepper)
  const timestamp = now()
  const expiresAt = addMs(timestamp, PASSWORD_RESET_TTL_MS)

  const entry = auditor.claim({
    action: 'auth.password.reset_requested',
    targetType: 'user',
    targetId: user.id,
    targetLabel: user.email,
    actorUserId: input.requestedBy?.id ?? user.id,
    actorRole: input.requestedBy?.role ?? user.role,
    actorLabel: input.requestedBy?.label ?? user.email,
    metadata: { expiresAt, adminInitiated: input.requestedBy !== null },
  })

  await db.batch([
    // Any outstanding link for this user is burned, so only the newest works.
    db
      .prepare('UPDATE password_reset_tokens SET used_at = ? WHERE user_id = ? AND used_at IS NULL')
      .bind(timestamp, user.id),
    db
      .prepare(
        `INSERT INTO password_reset_tokens
           (id, user_id, token_hash, requested_by, requested_ip, created_at, expires_at)
         VALUES (?,?,?,?,?,?,?)`,
      )
      .bind(
        ulid(),
        user.id,
        tokenHash,
        input.requestedBy?.id ?? null,
        input.requestIp,
        timestamp,
        expiresAt,
      ),
    auditInsertStmt(db, entry),
  ])

  return {
    userId: user.id,
    email: user.email,
    displayName: user.display_name ?? user.username,
    token,
    expiresAt,
  }
}

export interface ConsumeResetInput {
  token: string
  newPassword: string
}

export interface ConsumeResetResult {
  userId: string
  email: string
  /**
   * Returned so a client that signed in with the email address can be reminded
   * which username to type next time — the two are interchangeable at login.
   */
  username: string
  revokedSessions: number
}

/**
 * Redeems a reset token.
 *
 * Replay protection lives in the database, not in JavaScript: the UPDATE that
 * marks the token used is conditional on `used_at IS NULL` and its `changes`
 * count is checked. Two concurrent requests therefore cannot both succeed — the
 * loser sees 0 rows changed and is rejected.
 */
export async function consumePasswordReset(
  db: D1Database,
  config: AppConfig,
  input: ConsumeResetInput,
  auditor: Auditor,
): Promise<ConsumeResetResult> {
  // The identity is only known once the token resolves, so the password policy
  // is applied further down: a password containing the account's own email or
  // username must be refused on this path too.
  const tokenHash = await hashToken(input.token, config.sessionPepper)
  const timestamp = now()

  const tokenRow = await db
    .prepare(
      `SELECT t.id AS token_id, t.user_id, t.expires_at, u.email, u.username
         FROM password_reset_tokens t
         JOIN users u ON u.id = t.user_id
        WHERE t.token_hash = ? AND t.used_at IS NULL
        LIMIT 1`,
    )
    .bind(tokenHash)
    .first<{
      token_id: string
      user_id: string
      expires_at: number
      email: string
      username: string
    }>()

  if (!tokenRow) throw badRequest('This reset link is invalid or has already been used.')
  if (isExpired(tokenRow.expires_at, timestamp)) {
    throw badRequest('This reset link has expired. Request a new one.')
  }

  assertPasswordAcceptable(input.newPassword, [tokenRow.email, tokenRow.username])

  const passwordHash = await hashPassword(input.newPassword, config.pbkdf2Iterations)

  const entry = auditor.claim({
    action: 'auth.password.reset_completed',
    targetType: 'user',
    targetId: tokenRow.user_id,
    targetLabel: tokenRow.email,
    actorUserId: tokenRow.user_id,
    actorRole: 'user',
    actorLabel: tokenRow.username,
  })

  const results = await db.batch([
    // [0] claim the token — conditional, so this is the concurrency gate.
    db
      .prepare('UPDATE password_reset_tokens SET used_at = ? WHERE id = ? AND used_at IS NULL')
      .bind(timestamp, tokenRow.token_id),
    // [1] new credential
    db
      .prepare(
        `UPDATE users
            SET password_hash = ?, password_changed_at = ?, require_password_change = 0,
                failed_login_count = 0, locked_until = NULL, updated_at = ?
          WHERE id = ?`,
      )
      .bind(passwordHash, timestamp, timestamp, tokenRow.user_id),
    // [2] burn any sibling tokens
    db
      .prepare('UPDATE password_reset_tokens SET used_at = ? WHERE user_id = ? AND used_at IS NULL')
      .bind(timestamp, tokenRow.user_id),
    // [3] every existing session dies
    revokeSessionsStmt(db, tokenRow.user_id, 'password_reset', null, timestamp),
    // [4] audit
    auditInsertStmt(db, entry),
  ])

  // The batch is transactional, so a lost race rolls back everything including
  // the token claim. Reporting failure here is therefore correct.
  if ((results[0]?.meta.changes ?? 0) === 0) {
    throw badRequest('This reset link is invalid or has already been used.')
  }

  return {
    userId: tokenRow.user_id,
    email: tokenRow.email,
    username: tokenRow.username,
    revokedSessions: results[3]?.meta.changes ?? 0,
  }
}
