import { now } from '../lib/clock'
import { MAX_BIO_LENGTH, MAX_DISPLAY_NAME_LENGTH, MAX_LOCATION_LENGTH, MAX_NOTE_LENGTH, MAX_PRONOUNS_LENGTH, MAX_REASON_LENGTH, type Role, type UserStatus } from '../lib/constants'
import { badRequest, conflict, forbidden, notFound } from '../lib/errors'
import { normalizeEmail, normalizeUsername, sanitizeMultiline, sanitizeSingleLine } from '../lib/http'
import { hashPassword } from '../lib/crypto'
import { ulid } from '../lib/ids'
import { andWhere, asCount, likeContains } from '../lib/query'
import { assertCanEditUser, assertCanGrantRole, assertCanModerateUser } from '../lib/rbac'
import { actorLabelOf, auditInsertStmt } from './audit.service'
import { toApiUser, toNoteDto, toSanctionDto, toSessionDto } from './mappers'
import {
  assertPasswordAcceptable,
  mintSession,
  revokeSessionsStmt,
  type SessionResult,
} from './auth.service'
import { getSettingsMap, reservedUsernamesOf } from './settings.service'
import type { AppConfig } from '../lib/config'
import type {
  ActorInfo,
  ApiUser,
  Auditor,
  Pagination,
  SanctionRow,
  SanctionType,
  SessionRow,
  UserNoteRow,
  UserRow,
} from '../types'

// ============================================================================
// User administration.
//
// Two invariants this module exists to protect:
//
//   1. `users.status` / `suspended_until` / `suspended_permanently` /
//      `deleted_at` are DENORMALISED from `sanctions`. Every write here keeps
//      both sides in step, and the SQL CHECK constraints in 0001_init.sql make
//      a half-updated row impossible.
//
//   2. A destructive action always lands in the audit log atomically — the
//      audit INSERT is part of the same db.batch() as the change it describes.
// ============================================================================

// ------------------------------------------------------------------ reading --

const USER_SORTS: Record<string, string> = {
  newest: 'u.created_at DESC',
  oldest: 'u.created_at ASC',
  updated: 'u.updated_at DESC',
  name: 'u.username ASC',
  'last-login': '(u.last_login_at IS NULL), u.last_login_at DESC',
}

export interface UserListQuery {
  q?: string | undefined
  role?: Role | undefined
  status?: UserStatus | undefined
  sort?: string | undefined
  includeDeleted?: boolean
}

export interface UserListResult {
  rows: UserRow[]
  total: number
}

const LIKE_ESCAPE = "ESCAPE '\\'"

export function buildUserFilters(query: UserListQuery): { where: string; binds: unknown[] } {
  const clauses: string[] = []
  const binds: unknown[] = []

  if (!query.includeDeleted && query.status !== 'deleted') {
    clauses.push('u.status != ?')
    binds.push('deleted')
  }
  if (query.role) {
    clauses.push('u.role = ?')
    binds.push(query.role)
  }
  if (query.status) {
    clauses.push('u.status = ?')
    binds.push(query.status)
  }
  if (query.q) {
    const pattern = likeContains(query.q)
    clauses.push(
      `(lower(u.email) LIKE lower(?) ${LIKE_ESCAPE}` +
        ` OR lower(u.username) LIKE lower(?) ${LIKE_ESCAPE}` +
        ` OR lower(coalesce(u.display_name, '')) LIKE lower(?) ${LIKE_ESCAPE})`,
    )
    binds.push(pattern, pattern, pattern)
  }

  return { where: andWhere(clauses), binds }
}

export function sortForUsers(raw: string | undefined): string {
  const fragment = raw === undefined ? undefined : USER_SORTS[raw]
  return fragment ?? 'u.created_at DESC'
}

export async function listUsers(
  db: D1Database,
  query: UserListQuery,
  pagination: Pagination,
): Promise<UserListResult> {
  const { where, binds } = buildUserFilters(query)
  const orderBy = sortForUsers(query.sort)

  const [rowsResult, countResult] = await db.batch([
    db
      .prepare(`SELECT u.* FROM users u ${where} ORDER BY ${orderBy} LIMIT ? OFFSET ?`)
      .bind(...binds, pagination.limit, pagination.offset),
    db.prepare(`SELECT count(*) AS total FROM users u ${where}`).bind(...binds),
  ])

  return {
    rows: (rowsResult?.results ?? []) as unknown as UserRow[],
    total: asCount((countResult?.results?.[0] ?? null) as { total?: unknown } | null),
  }
}

export async function findUserById(db: D1Database, id: string): Promise<UserRow | null> {
  const row = await db.prepare('SELECT * FROM users WHERE id = ? LIMIT 1').bind(id).first<UserRow>()
  return row ?? null
}

export async function requireUserById(db: D1Database, id: string): Promise<UserRow> {
  const row = await findUserById(db, id)
  if (!row) throw notFound('User')
  return row
}

export interface UserDetail {
  user: ApiUser
  counts: {
    pages: number
    sessions: number
    sanctions: number
    notes: number
    reportsAgainst: number
    reportsFiled: number
  }
  sanctions: ReturnType<typeof toSanctionDto>[]
}

/** Everything the user-detail view needs, in one round trip. */
export async function getUserDetail(db: D1Database, id: string): Promise<UserDetail> {
  const user = await requireUserById(db, id)
  const current = now()

  const results = await db.batch([
    db
      .prepare('SELECT count(*) AS total FROM pages WHERE user_id = ? AND deleted_at IS NULL')
      .bind(id),
    db
      .prepare(
        'SELECT count(*) AS total FROM sessions WHERE user_id = ? AND revoked_at IS NULL AND expires_at > ?',
      )
      .bind(id, current),
    db.prepare('SELECT count(*) AS total FROM sanctions WHERE user_id = ?').bind(id),
    db.prepare('SELECT count(*) AS total FROM user_notes WHERE user_id = ?').bind(id),
    db
      .prepare(
        'SELECT count(*) AS total FROM reports WHERE page_id IN (SELECT id FROM pages WHERE user_id = ?)',
      )
      .bind(id),
    db.prepare('SELECT count(*) AS total FROM reports WHERE reporter_user_id = ?').bind(id),
    db
      .prepare('SELECT * FROM sanctions WHERE user_id = ? ORDER BY created_at DESC LIMIT 20')
      .bind(id),
  ])

  const at = (index: number): number =>
    asCount((results[index]?.results?.[0] ?? null) as { total?: unknown } | null)

  return {
    user: toApiUser(user),
    counts: {
      pages: at(0),
      sessions: at(1),
      sanctions: at(2),
      notes: at(3),
      reportsAgainst: at(4),
      reportsFiled: at(5),
    },
    sanctions: ((results[6]?.results ?? []) as unknown as SanctionRow[]).map(toSanctionDto),
  }
}

// ------------------------------------------------------------------ writes ---

/**
 * Refuses any change that would leave the platform with no usable owner.
 *
 * Without this, an owner could demote or delete the last owner — including
 * themselves — leaving the installation administratively unrecoverable short
 * of editing the database by hand.
 */
async function assertNotLastOwner(db: D1Database, target: UserRow): Promise<void> {
  if (target.role !== 'owner') return
  const row = await db
    .prepare(
      "SELECT count(*) AS total FROM users WHERE role = 'owner' AND status = 'active' AND deleted_at IS NULL",
    )
    .first<{ total: number }>()
  if ((row?.total ?? 0) <= 1) {
    throw forbidden('This is the last active owner; promote another owner first.')
  }
}

async function assertEmailAndUsernameFree(
  db: D1Database,
  email: string,
  username: string,
  exceptUserId: string | null,
): Promise<void> {
  const row = await db
    .prepare(
      'SELECT id, email, username FROM users WHERE (email = ? OR username = ?) AND id != ? LIMIT 1',
    )
    .bind(email, username, exceptUserId ?? '')
    .first<{ id: string; email: string; username: string }>()

  if (!row) return
  if (row.email === email) throw conflict('That email address is already registered.')
  throw conflict('That username is already taken.')
}

/**
 * Refuses usernames on the reserved list.
 *
 * The list lives in `content.reserved_usernames` because it is policy an owner
 * may extend, so it cannot be expressed in the request schema. Applied to every
 * path where a caller picks a username (public sign-up, staff provisioning and
 * profile edits) — a name that is reserved is reserved, whichever door it comes
 * through, otherwise `owner` could be squatted through the one route that forgot
 * to check.
 */
async function assertUsernameNotReserved(db: D1Database, username: string): Promise<void> {
  const settings = await getSettingsMap(db)
  if (reservedUsernamesOf(settings).includes(normalizeUsername(username))) {
    throw badRequest('That username is reserved.')
  }
}

export interface CreateUserInput {
  email: string
  username?: string | undefined
  displayName?: string | undefined
  role: Role
  password: string
  requirePasswordChange?: boolean | undefined
  emailVerified?: boolean | undefined
}

/**
 * Staff-created account, used when an owner/admin provisions a moderator or
 * support account directly rather than through the invitation flow.
 */
export async function createUser(
  db: D1Database,
  config: { pbkdf2Iterations: number },
  actor: ActorInfo,
  input: CreateUserInput,
  auditor: Auditor,
): Promise<ApiUser> {
  const email = normalizeEmail(input.email)
  if (!email.includes('@')) throw badRequest('A valid email address is required.')
  const username = normalizeUsername(input.username ?? email.split('@')[0] ?? email)
  if (username.length < 3) throw badRequest('Usernames must be at least 3 characters.')

  assertCanGrantRole(actor, input.role)
  await assertUsernameNotReserved(db, username)
  await assertEmailAndUsernameFree(db, email, username, null)

  const timestamp = now()
  const userId = ulid()
  const passwordHash = await hashPassword(input.password, config.pbkdf2Iterations)
  const displayName = input.displayName ? sanitizeSingleLine(input.displayName, 80) : null
  const verified = input.emailVerified !== false

  const entry = auditor.claim({
    action: 'user.create',
    targetType: 'user',
    targetId: userId,
    targetLabel: email,
    actorUserId: actor.id,
    actorRole: actor.role,
    actorLabel: actor.label,
    after: { email, username, role: input.role, status: 'active' },
  })

  await db.batch([
    db
      .prepare(
        `INSERT INTO users (
           id, email, username, display_name, email_verified, email_verified_at,
           password_hash, password_changed_at, require_password_change,
           role, status, status_changed_at, created_at, updated_at
         ) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
      )
      .bind(
        userId,
        email,
        username,
        displayName,
        verified ? 1 : 0,
        verified ? timestamp : null,
        passwordHash,
        timestamp,
        input.requirePasswordChange === false ? 0 : 1,
        input.role,
        'active',
        timestamp,
        timestamp,
        timestamp,
      ),
    auditInsertStmt(db, entry),
  ])

  return toApiUser(await requireUserById(db, userId))
}

export interface RegisterInput {
  username: string
  email: string
  password: string
  displayName?: string | undefined
  ip: string | null
  userAgent: string | null
}

/**
 * Public sign-up: creates an ordinary `user` and signs them straight in.
 *
 * Two batches, in this order:
 *
 *   1. the account, with its own audit row (`user.register`), then
 *   2. the session, audited by `mintSession` as `auth.register`.
 *
 * If the second batch failed the account would still exist with nobody holding
 * a session for it — the benign half of the failure, since the new owner can
 * simply log in. The reverse order is impossible: a session cannot reference a
 * user row that does not exist yet.
 *
 * Sign-up IS an account-enumeration oracle, deliberately: it answers 409 and
 * names the field that clashed, because the alternative ("we sent you an email")
 * requires a mail provider this deployment does not have. The mitigations are
 * the `register_ip` rate limit and the `platform.registration_open` switch, not
 * secrecy — so neither of those is optional decoration.
 *
 * Everything a client could try to smuggle in is decided here rather than taken
 * from the request: role is `user`, status is `active` (a `pending` account
 * could not use the API at all — see `assertAccountUsable`), and
 * `require_password_change` is 0 because the caller just chose the password.
 */
export async function registerUser(
  db: D1Database,
  config: AppConfig,
  input: RegisterInput,
  auditor: Auditor,
): Promise<SessionResult> {
  const email = normalizeEmail(input.email)
  const username = normalizeUsername(input.username)

  await assertUsernameNotReserved(db, username)
  await assertEmailAndUsernameFree(db, email, username, null)
  assertPasswordAcceptable(input.password, [email, username])

  const timestamp = now()
  const userId = ulid()
  const passwordHash = await hashPassword(input.password, config.pbkdf2Iterations)
  const displayName = input.displayName ? sanitizeSingleLine(input.displayName, 80) : null

  const entry = auditor.claim({
    action: 'user.register',
    targetType: 'user',
    targetId: userId,
    targetLabel: email,
    actorUserId: userId,
    actorLabel: username,
    actorRole: 'user',
    after: { email, username, role: 'user', status: 'active' },
  })

  await db.batch([
    db
      .prepare(
        `INSERT INTO users (
           id, email, username, display_name, email_verified, email_verified_at,
           password_hash, password_changed_at, require_password_change,
           role, status, status_changed_at, created_at, updated_at
         ) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
      )
      .bind(
        userId,
        email,
        username,
        displayName,
        // No provider is wired up, so nothing can prove this address. The flag
        // records the truth instead of assuming the convenience.
        0,
        null,
        passwordHash,
        timestamp,
        0,
        'user',
        'active',
        timestamp,
        timestamp,
        timestamp,
      ),
    auditInsertStmt(db, entry),
  ])

  // Auto-login: one post-auth code path for the SPA, and one PBKDF2 derivation
  // per sign-up instead of two.
  return mintSession(
    db,
    config,
    {
      user: await requireUserById(db, userId),
      ip: input.ip,
      userAgent: input.userAgent,
      action: 'auth.register',
      metadata: { username },
    },
    auditor,
  )
}

export interface UpdateUserInput {
  displayName?: string | undefined
  bio?: string | null | undefined
  email?: string | undefined
  username?: string | undefined
  role?: Role | undefined
}

/**
 * Edits an account's profile fields and/or role.
 *
 * Role changes need `users.role.assign` (enforced by the route) plus the rank
 * rules here; plain profile edits need only "not more senior than me". A
 * `before`/`after` pair is recorded so the audit trail shows the field deltas.
 */
export async function updateUser(
  db: D1Database,
  actor: ActorInfo,
  targetId: string,
  input: UpdateUserInput,
  auditor: Auditor,
): Promise<ApiUser> {
  const target = await requireUserById(db, targetId)
  assertCanEditUser(actor, { id: target.id, role: target.role })

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

  if (input.displayName !== undefined) {
    setField('display_name', sanitizeSingleLine(input.displayName, 80), 'displayName')
  }
  if (input.bio !== undefined) {
    setField(
      'bio',
      input.bio === null ? null : sanitizeMultiline(input.bio, 500) || null,
      'bio',
    )
  }
  if (input.email !== undefined) {
    const email = normalizeEmail(input.email)
    if (!email.includes('@')) throw badRequest('A valid email address is required.')
    if (email !== target.email) {
      setField('email', email, 'email')
      // Changing the address invalidates the previous verification.
      patch.push('email_verified = 0', 'email_verified_at = NULL')
      before.emailVerified = target.email_verified === 1
      after.emailVerified = false
    }
  }
  if (input.username !== undefined) {
    const username = normalizeUsername(input.username)
    if (username.length < 3) throw badRequest('Usernames must be at least 3 characters.')
    if (username !== target.username) {
      await assertUsernameNotReserved(db, username)
      setField('username', username, 'username')
    }
  }
  if (input.role !== undefined && input.role !== target.role) {
    assertCanGrantRole(actor, input.role)
    // Demoting the last owner is a lockout; refuse before touching anything.
    await assertNotLastOwner(db, target)
    setField('role', input.role, 'role')
  }

  if (patch.length === 0) return toApiUser(target)

  const timestamp = now()
  const nextEmail = typeof after.email === 'string' ? after.email : target.email
  const nextUsername = typeof after.username === 'string' ? after.username : target.username
  await assertEmailAndUsernameFree(db, nextEmail, nextUsername, target.id)

  const entry = auditor.claim({
    action: 'user.update',
    targetType: 'user',
    targetId: target.id,
    targetLabel: target.email,
    actorUserId: actor.id,
    actorRole: actor.role,
    actorLabel: actor.label,
    before,
    after,
  })

  await db.batch([
    db
      .prepare(`UPDATE users SET ${patch.join(', ')}, updated_at = ? WHERE id = ?`)
      .bind(...binds, timestamp, target.id),
    auditInsertStmt(db, entry),
  ])

  return toApiUser(await requireUserById(db, target.id))
}

export interface UpdateProfileInput {
  displayName?: string | undefined
  bio?: string | null | undefined
  location?: string | null | undefined
  pronouns?: string | null | undefined
  username?: string | undefined
}

/**
 * Self-service profile edit (R1.1) — the write path behind `PATCH /auth/me`.
 *
 * Deliberately NOT `updateUser`. That function is the STAFF edit path: it opens
 * with `assertCanEditUser` ("not more senior than me"), which is meaningless for
 * an actor editing themselves, and it accepts `role` and `email` — a role grant
 * needs a capability, and an address change has to reset `email_verified`.
 * Neither is a thing a signed-in user may do to themselves, so sharing one
 * function would leave every reader working out which half applies to them.
 *
 * What it DOES share is the parts that are policy rather than authorisation: the
 * same `setField` delta recording, the same `assertEmailAndUsernameFree`
 * uniqueness check, and the same single `db.batch()` write-then-audit, so the log
 * row commits with the change it describes.
 *
 * Caps are **D12** (50 / 160) and apply on save only. `updateUser` keeps the
 * pre-R1.1 80 / 500 so that a row which predates the caps stays editable.
 *
 * R1.2 extended this function rather than a second one: `location` and `pronouns`
 * are two more nullable columns on the same row, behind the same route, so they are
 * two more `setField` calls below — not a new service that would have to repeat the
 * same audit shape, the same `before`/`after` recording and the same guards.
 */
export async function updateOwnProfile(
  db: D1Database,
  actor: ActorInfo,
  input: UpdateProfileInput,
  auditor: Auditor,
): Promise<ApiUser> {
  const target = await requireUserById(db, actor.id)

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

  if (input.displayName !== undefined) {
    // Zod already bounded the length; this is the control-character pass, and it
    // can still empty the string, which would leave the account with no name.
    const displayName = sanitizeSingleLine(input.displayName, MAX_DISPLAY_NAME_LENGTH)
    if (displayName.length === 0) throw badRequest('A display name is required.')
    setField('display_name', displayName, 'displayName')
  }
  if (input.bio !== undefined) {
    // `""` and `null` both mean "clear it" — the column is nullable and that is
    // what an emptied textarea sends.
    const bio = input.bio === null ? null : sanitizeMultiline(input.bio, MAX_BIO_LENGTH) || null
    setField('bio', bio, 'bio')
  }
  if (input.location !== undefined) {
    // R1.2 put these two on this same path rather than in a service of their own:
    // they are columns on `users` like `bio`, so a second write path would be a
    // second place for the same row's rules to drift. Same `null`/`""` reading, and
    // `sanitizeSingleLine` can empty the string, which stores `null` rather than `""`
    // — "somewhere" and "unset" must not be two different values in one column.
    const location =
      input.location === null ? null : sanitizeSingleLine(input.location, MAX_LOCATION_LENGTH) || null
    setField('location', location, 'location')
  }
  if (input.pronouns !== undefined) {
    const pronouns =
      input.pronouns === null ? null : sanitizeSingleLine(input.pronouns, MAX_PRONOUNS_LENGTH) || null
    setField('pronouns', pronouns, 'pronouns')
  }
  if (input.username !== undefined) {
    const username = normalizeUsername(input.username)
    if (username.length < 3) throw badRequest('Usernames must be at least 3 characters.')
    if (username !== target.username) {
      // Only a real change is worth a settings read, and only a real change can
      // collide with another account.
      await assertUsernameNotReserved(db, username)
      setField('username', username, 'username')
    }
  }

  if (patch.length === 0) return toApiUser(target)

  const timestamp = now()
  const nextUsername = typeof after.username === 'string' ? after.username : target.username
  await assertEmailAndUsernameFree(db, target.email, nextUsername, target.id)

  const entry = auditor.claim({
    action: 'user.profile_update',
    targetType: 'user',
    targetId: target.id,
    targetLabel: target.email,
    actorUserId: actor.id,
    actorRole: actor.role,
    actorLabel: actor.label,
    before,
    after,
  })

  await db.batch([
    db
      .prepare(`UPDATE users SET ${patch.join(', ')}, updated_at = ? WHERE id = ?`)
      .bind(...binds, timestamp, target.id),
    auditInsertStmt(db, entry),
  ])

  return toApiUser(await requireUserById(db, target.id))
}

// -------------------------------------------------------------- sanctions ----

interface SanctionSpec {
  type: SanctionType
  reason: string
  category: string | null
  durationHours: number | null
  reportId: string | null
  /** Status after the action. `null` leaves the account status untouched. */
  nextStatus: 'active' | 'suspended' | 'banned' | 'deleted' | null
  revokeSessions: boolean
  auditAction: string
}

export interface SanctionOutcome {
  sanctionId: string
  expiresAt: number | null
  revokedSessions: number
  user: ApiUser
}

/**
 * The single write path for every moderation action.
 *
 * It keeps the denormalised account state and the `sanctions` ledger in step,
 * and it is written so the CHECK constraints in 0001_init.sql are satisfied by
 * construction:
 *
 *   - `suspended` REQUIRES an expiry or an explicit permanent flag
 *   - `active` / `banned` REQUIRE both suspension fields cleared
 *   - `deleted` REQUIRES `deleted_at`
 *
 * Getting this wrong is not a silent bug — the database rejects the row.
 */
function applySanction(
  db: D1Database,
  actor: ActorInfo,
  target: UserRow,
  spec: SanctionSpec,
  auditor: Auditor,
): Promise<SanctionOutcome> {
  assertCanModerateUser(actor, { id: target.id, role: target.role })
  return runSanction(db, actor, target, spec, auditor)
}

/**
 * The async half of `applySanction`.
 *
 * It is split out so the RBAC guard above is evaluated by a *synchronous*
 * function. Workerd reports a rejection raised before an `async` function
 * reaches its first `await` as an unhandled rejection even when the caller
 * handles it: the request still gets its 403 and the audit row is still
 * written, but the runtime additionally records an unhandled-rejection error
 * (which the workers test pool turns into a failing run). Nothing below may
 * throw before the first `await` either, so anything that has to fail fast
 * belongs in `applySanction` or in the caller.
 */
async function runSanction(
  db: D1Database,
  actor: ActorInfo,
  target: UserRow,
  spec: SanctionSpec,
  auditor: Auditor,
): Promise<SanctionOutcome> {
  if (spec.nextStatus !== null && spec.nextStatus !== 'active') {
    await assertNotLastOwner(db, target)
  }

  const timestamp = now()
  const sanctionId = ulid()
  const expiresAt =
    spec.durationHours !== null && spec.durationHours > 0
      ? timestamp + spec.durationHours * 60 * 60 * 1000
      : null

  let nextStatus: UserRow['status'] = target.status
  let suspendedUntil: number | null = target.suspended_until
  let suspendedPermanently = target.suspended_permanently
  let deletedAt: number | null = target.deleted_at
  let deletedBy: string | null = target.deleted_by
  let statusReason: string | null = target.status_reason
  let statusChangedAt: number | null = target.status_changed_at

  switch (spec.nextStatus) {
    case 'suspended':
      nextStatus = 'suspended'
      suspendedUntil = expiresAt
      suspendedPermanently = expiresAt === null ? 1 : 0
      deletedAt = null
      deletedBy = null
      statusReason = spec.reason
      statusChangedAt = timestamp
      break
    case 'banned':
      nextStatus = 'banned'
      suspendedUntil = null
      suspendedPermanently = 0
      deletedAt = null
      deletedBy = null
      statusReason = spec.reason
      statusChangedAt = timestamp
      break
    case 'deleted':
      nextStatus = 'deleted'
      suspendedUntil = null
      suspendedPermanently = 0
      deletedAt = timestamp
      deletedBy = actor.id
      statusReason = spec.reason
      statusChangedAt = timestamp
      break
    case 'active':
      nextStatus = 'active'
      suspendedUntil = null
      suspendedPermanently = 0
      deletedAt = null
      deletedBy = null
      statusReason = null
      statusChangedAt = timestamp
      break
    case null:
      // Warn only — account state is intentionally untouched, but the
      // suspension fields must be carried over verbatim or the CHECK fails.
      break
  }

  const entry = auditor.claim({
    action: spec.auditAction,
    targetType: 'user',
    targetId: target.id,
    targetLabel: target.email,
    actorUserId: actor.id,
    actorRole: actor.role,
    actorLabel: actor.label,
    before: { status: target.status, statusReason: target.status_reason },
    after: { status: nextStatus, statusReason, expiresAt, sanctionId },
    metadata: {
      sanctionType: spec.type,
      category: spec.category,
      durationHours: spec.durationHours,
      reportId: spec.reportId,
      reason: spec.reason,
    },
  })

  const statements: D1PreparedStatement[] = [
    db
      .prepare(
        `INSERT INTO sanctions (
           id, user_id, type, reason, category, issued_by, issued_by_label,
           report_id, duration_hours, expires_at, status, created_at
         ) VALUES (?,?,?,?,?,?,?,?,?,?,'active',?)`,
      )
      .bind(
        sanctionId,
        target.id,
        spec.type,
        spec.reason,
        spec.category,
        actor.id,
        actor.label,
        spec.reportId,
        spec.durationHours,
        expiresAt,
        timestamp,
      ),
    db
      .prepare(
        `UPDATE users
            SET status = ?, status_reason = ?, status_changed_at = ?,
                suspended_until = ?, suspended_permanently = ?,
                deleted_at = ?, deleted_by = ?, updated_at = ?
          WHERE id = ?`,
      )
      .bind(
        nextStatus,
        statusReason,
        statusChangedAt,
        suspendedUntil,
        suspendedPermanently,
        deletedAt,
        deletedBy,
        timestamp,
        target.id,
      ),
  ]

  if (spec.revokeSessions) {
    statements.push(revokeSessionsStmt(db, target.id, spec.auditAction, null, timestamp))
  }
  const auditIndex = statements.length
  statements.push(auditInsertStmt(db, entry))

  const results = await db.batch(statements)
  const revokedSessions = spec.revokeSessions
    ? (results[auditIndex - 1]?.meta.changes ?? 0)
    : 0

  return {
    sanctionId,
    expiresAt,
    revokedSessions,
    user: toApiUser(await requireUserById(db, target.id)),
  }
}

function cleanReason(reason: string): string {
  const value = sanitizeMultiline(reason, MAX_REASON_LENGTH)
  if (value.length < 3) throw badRequest('A reason of at least 3 characters is required.')
  return value
}

export interface SanctionRequest {
  reason: string
  category?: string | null | undefined
  durationHours?: number | null | undefined
  reportId?: string | null | undefined
}

export async function warnUser(
  db: D1Database,
  actor: ActorInfo,
  targetId: string,
  input: SanctionRequest,
  auditor: Auditor,
): Promise<SanctionOutcome> {
  const target = await requireUserById(db, targetId)
  return applySanction(
    db,
    actor,
    target,
    {
      type: 'warn',
      reason: cleanReason(input.reason),
      category: input.category ?? null,
      durationHours: null,
      reportId: input.reportId ?? null,
      nextStatus: null,
      revokeSessions: false,
      auditAction: 'user.warn',
    },
    auditor,
  )
}

export async function suspendUser(
  db: D1Database,
  actor: ActorInfo,
  targetId: string,
  input: SanctionRequest & { permanent?: boolean | undefined },
  auditor: Auditor,
): Promise<SanctionOutcome> {
  const target = await requireUserById(db, targetId)
  const permanent = input.permanent === true
  const durationHours = permanent ? null : (input.durationHours ?? 24)

  return applySanction(
    db,
    actor,
    target,
    {
      type: 'suspend',
      reason: cleanReason(input.reason),
      category: input.category ?? null,
      durationHours,
      reportId: input.reportId ?? null,
      nextStatus: 'suspended',
      revokeSessions: true,
      auditAction: 'user.suspend',
    },
    auditor,
  )
}

export async function banUser(
  db: D1Database,
  actor: ActorInfo,
  targetId: string,
  input: SanctionRequest,
  auditor: Auditor,
): Promise<SanctionOutcome> {
  const target = await requireUserById(db, targetId)
  return applySanction(
    db,
    actor,
    target,
    {
      type: 'ban',
      reason: cleanReason(input.reason),
      category: input.category ?? null,
      durationHours: null,
      reportId: input.reportId ?? null,
      nextStatus: 'banned',
      revokeSessions: true,
      auditAction: 'user.ban',
    },
    auditor,
  )
}

export async function softDeleteUser(
  db: D1Database,
  actor: ActorInfo,
  targetId: string,
  input: SanctionRequest,
  auditor: Auditor,
): Promise<SanctionOutcome> {
  const target = await requireUserById(db, targetId)
  if (target.deleted_at !== null) throw badRequest('That account is already deleted.')

  return applySanction(
    db,
    actor,
    target,
    {
      type: 'delete',
      reason: cleanReason(input.reason),
      category: input.category ?? null,
      durationHours: null,
      reportId: input.reportId ?? null,
      nextStatus: 'deleted',
      revokeSessions: true,
      auditAction: 'user.delete',
    },
    auditor,
  )
}

/**
 * Lifts every active suspension/ban and returns the account to `active`.
 *
 * Deliberately does NOT go through `applySanction`: reactivation is a
 * *reversal*, not a new sanction, so it must not append a fake row to the
 * ledger. The existing sanctions are marked `lifted` (never deleted), so the
 * history of "why was this account restricted" survives the reversal.
 */
export async function reactivateUser(
  db: D1Database,
  actor: ActorInfo,
  targetId: string,
  reason: string,
  auditor: Auditor,
): Promise<SanctionOutcome> {
  const target = await requireUserById(db, targetId)
  if (target.status === 'active') throw badRequest('That account is already active.')
  if (target.deleted_at !== null) {
    throw badRequest('Deleted accounts cannot be reactivated.')
  }
  assertCanModerateUser(actor, { id: target.id, role: target.role })

  const timestamp = now()
  const cleanLiftReason = cleanReason(reason)

  const entry = auditor.claim({
    action: 'user.reactivate',
    targetType: 'user',
    targetId: target.id,
    targetLabel: target.email,
    actorUserId: actor.id,
    actorRole: actor.role,
    actorLabel: actor.label,
    before: { status: target.status, statusReason: target.status_reason },
    after: { status: 'active' },
    metadata: { reason: cleanLiftReason },
  })

  const results = await db.batch([
    db
      .prepare(
        `UPDATE users
            SET status = 'active', status_reason = NULL, status_changed_at = ?,
                suspended_until = NULL, suspended_permanently = 0,
                deleted_at = NULL, deleted_by = NULL, updated_at = ?
          WHERE id = ?`,
      )
      .bind(timestamp, timestamp, target.id),
    db
      .prepare(
        `UPDATE sanctions
            SET status = 'lifted', lifted_by = ?, lifted_at = ?, lift_reason = ?
          WHERE user_id = ? AND status = 'active' AND type IN ('suspend', 'ban')`,
      )
      .bind(actor.id, timestamp, cleanLiftReason, target.id),
    auditInsertStmt(db, entry),
  ])

  return {
    sanctionId: '',
    expiresAt: null,
    revokedSessions: results[1]?.meta.changes ?? 0,
    user: toApiUser(await requireUserById(db, target.id)),
  }
}

// ------------------------------------------------------------------- notes ---

export async function addUserNote(
  db: D1Database,
  actor: ActorInfo,
  targetId: string,
  body: string,
  auditor: Auditor,
): Promise<ReturnType<typeof toNoteDto>> {
  const target = await requireUserById(db, targetId)
  const text = sanitizeMultiline(body, MAX_NOTE_LENGTH)
  if (text.length < 1) throw badRequest('A note body is required.')

  const timestamp = now()
  const noteId = ulid()

  const entry = auditor.claim({
    action: 'user.note.create',
    targetType: 'user',
    targetId: target.id,
    targetLabel: target.email,
    actorUserId: actor.id,
    actorRole: actor.role,
    actorLabel: actor.label,
    metadata: { noteId, length: text.length },
  })

  await db.batch([
    db
      .prepare(
        'INSERT INTO user_notes (id, user_id, author_id, author_label, body, created_at) VALUES (?,?,?,?,?,?)',
      )
      .bind(noteId, target.id, actor.id, actor.label, text, timestamp),
    auditInsertStmt(db, entry),
  ])

  return toNoteDto({
    id: noteId,
    user_id: target.id,
    author_id: actor.id,
    author_label: actor.label,
    body: text,
    created_at: timestamp,
  })
}

export async function listUserNotes(
  db: D1Database,
  targetId: string,
  pagination: Pagination,
): Promise<{ rows: ReturnType<typeof toNoteDto>[]; total: number }> {
  await requireUserById(db, targetId)

  const [rowsResult, countResult] = await db.batch([
    db
      .prepare(
        'SELECT * FROM user_notes WHERE user_id = ? ORDER BY created_at DESC, id DESC LIMIT ? OFFSET ?',
      )
      .bind(targetId, pagination.limit, pagination.offset),
    db.prepare('SELECT count(*) AS total FROM user_notes WHERE user_id = ?').bind(targetId),
  ])

  const rows = (rowsResult?.results ?? []) as unknown as UserNoteRow[]
  return {
    rows: rows.map(toNoteDto),
    total: asCount((countResult?.results?.[0] ?? null) as { total?: unknown } | null),
  }
}

// ------------------------------------------------------------------ sessions --

/**
 * Admin-initiated "sign this user out everywhere".
 *
 * This is the non-destructive counterpart to a ban, and it is the reason
 * sessions are opaque database rows rather than self-contained JWTs: revocation
 * is a single UPDATE and takes effect on the very next request.
 */
export async function revokeUserSessionsByAdmin(
  db: D1Database,
  actor: ActorInfo,
  targetId: string,
  reason: string,
  auditor: Auditor,
): Promise<number> {
  const target = await requireUserById(db, targetId)
  assertCanModerateUser(actor, { id: target.id, role: target.role })

  const timestamp = now()
  const cleanLiftReason = sanitizeSingleLine(reason, 200) || 'admin_revoked'

  const entry = auditor.claim({
    action: 'user.sessions.revoke',
    targetType: 'user',
    targetId: target.id,
    targetLabel: target.email,
    actorUserId: actor.id,
    actorRole: actor.role,
    actorLabel: actor.label,
    metadata: { reason: cleanLiftReason },
  })

  const results = await db.batch([
    revokeSessionsStmt(db, target.id, 'admin_revoked', null, timestamp),
    auditInsertStmt(db, entry),
  ])

  return results[0]?.meta.changes ?? 0
}

export async function listSessionsForUser(
  db: D1Database,
  targetId: string,
): Promise<ReturnType<typeof toSessionDto>[]> {
  await requireUserById(db, targetId)
  const { results } = await db
    .prepare(
      'SELECT * FROM sessions WHERE revoked_at IS NULL AND expires_at > ? AND user_id = ? ORDER BY created_at DESC LIMIT 100',
    )
    .bind(now(), targetId)
    .all<SessionRow>()
  return results.map(toSessionDto)
}

/** Baseline actor label used by routes when building an ActorInfo. */
export function actorInfoOf(user: {
  id: string
  role: Role
  username: string
  displayName?: string | null
  display_name?: string | null
}): ActorInfo {
  return { id: user.id, role: user.role, label: actorLabelOf(user) }
}
