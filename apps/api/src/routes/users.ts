import { Hono } from 'hono'
import { getClientIp, list, ok } from '../lib/http'
import { PASSWORD_RESET_TTL_MS, ROLES, USER_STATUSES } from '../lib/constants'
import { appConfig } from '../lib/config'
import { humanizeDuration } from '../lib/clock'
import { badRequest } from '../lib/errors'
import { assertCanEditUser, assertCanModerateUser, authorize } from '../lib/rbac'
import { readBoolean, readEnum, readInt, readSearch, readString } from '../lib/params'
import { parsePagination } from '../lib/query'
import { requireCapability } from '../middleware/auth'
import { rateLimit } from '../middleware/rate-limit'
import { toApiUser } from '../services/mappers'
import {
  addUserNote,
  actorInfoOf,
  banUser,
  createUser,
  getUserDetail,
  listSessionsForUser,
  listUserNotes,
  listUsers,
  reactivateUser,
  requireUserById,
  revokeUserSessionsByAdmin,
  softDeleteUser,
  suspendUser,
  updateUser,
  warnUser,
  type SanctionOutcome,
  type UserListQuery,
} from '../services/user.service'
import { buildPasswordResetUrl, changePassword, createPasswordReset } from '../services/auth.service'
import { queueEmail } from '../services/email.service'
import { getSettingsMap, platformNameOf } from '../services/settings.service'
import { currentUser, readJson } from './helpers'
import {
  adminResetPasswordSchema,
  createNoteSchema,
  createUserSchema,
  reactivateBodySchema,
  revokeSessionsBodySchema,
  sanctionBodySchema,
  suspendBodySchema,
  updateUserSchema,
} from '../validation/user.schema'
import type { AppEnv } from '../types'

// ============================================================================
// /api/v1/admin/users
//
// Every route states the capability it needs. Capabilities are role grants, and
// they are NOT the whole story: the services additionally enforce rank rules
// (a moderator cannot sanction an admin, nobody can sanction themselves, and
// the last active owner is protected). Both layers are deliberate — the route
// guard is the coarse "can this role use this feature", the service is the
// fine "can this actor touch this row".
// ============================================================================

export const userRoutes = new Hono<AppEnv>()

// ------------------------------------------------------------------- read ---

userRoutes.get('/', requireCapability('users.read'), async (c) => {
  const query: UserListQuery = {
    q: readSearch(c),
    role: readEnum(c, 'role', ROLES),
    status: readEnum(c, 'status', USER_STATUSES),
    sort: readString(c, 'sort', 32),
    includeDeleted: readBoolean(c, 'includeDeleted') ?? false,
  }
  const pagination = parsePagination({ page: readInt(c, 'page'), limit: readInt(c, 'limit') })
  const { rows, total } = await listUsers(c.env.DB, query, pagination)

  return list(c, rows.map(toApiUser), total, pagination, { filters: query })
})

userRoutes.get('/:id', requireCapability('users.read'), async (c) => {
  const detail = await getUserDetail(c.env.DB, c.req.param('id'))
  return ok(c, detail)
})

// ------------------------------------------------------------------ write ---

userRoutes.post('/', requireCapability('users.create'), async (c) => {
  const body = await readJson(c, createUserSchema)
  const actor = currentUser(c)

  const user = await createUser(
    c.env.DB,
    appConfig(c.env),
    actorInfoOf(actor),
    body,
    c.get('auditor'),
  )
  return ok(c, user, { status: 201 })
})

userRoutes.patch('/:id', requireCapability('users.update'), async (c) => {
  const body = await readJson(c, updateUserSchema)
  const actor = currentUser(c)

  // Changing a role is a strictly bigger deal than editing a profile, so it
  // needs its own capability. Checking it here keeps the route guard narrow
  // instead of demanding `users.role.assign` for every display-name edit.
  if (body.role !== undefined) authorize(actor.role, 'users.role.assign')

  const user = await updateUser(
    c.env.DB,
    actorInfoOf(actor),
    c.req.param('id'),
    body,
    c.get('auditor'),
  )
  return ok(c, user)
})

// ------------------------------------------------------------- moderation ---

interface SanctionNotifiable {
  email: string
  displayName: string
}

async function notifySanction(
  env: Cloudflare.Env,
  templateKey: 'warning_issued' | 'account_suspended' | 'account_banned',
  target: SanctionNotifiable,
  variables: Record<string, string>,
): Promise<void> {
  const settings = await getSettingsMap(env.DB)
  await queueEmail(env.DB, {
    to: target.email,
    templateKey,
    variables: {
      platform_name: platformNameOf(settings),
      display_name: target.displayName,
      ...variables,
    },
  })
}

userRoutes.post('/:id/warn', requireCapability('users.sanction'), async (c) => {
  const body = await readJson(c, sanctionBodySchema)
  const actor = currentUser(c)

  const outcome = await warnUser(
    c.env.DB,
    actorInfoOf(actor),
    c.req.param('id'),
    body,
    c.get('auditor'),
  )

  await notifySanction(c.env, 'warning_issued', outcome.user, {
    reason: body.reason,
    appeal_deadline: 'the deadline shown in your account',
  })

  return ok(c, { sanction: outcomeToJson(outcome) })
})

userRoutes.post('/:id/suspend', requireCapability('users.sanction'), async (c) => {
  const body = await readJson(c, suspendBodySchema)
  const actor = currentUser(c)

  const outcome = await suspendUser(
    c.env.DB,
    actorInfoOf(actor),
    c.req.param('id'),
    body,
    c.get('auditor'),
  )

  await notifySanction(c.env, 'account_suspended', outcome.user, {
    reason: body.reason,
    expires_at: outcome.expiresAt === null ? 'until further notice' : String(outcome.expiresAt),
  })

  return ok(c, { sanction: outcomeToJson(outcome) })
})

userRoutes.post('/:id/ban', requireCapability('users.sanction'), async (c) => {
  const body = await readJson(c, sanctionBodySchema)
  const actor = currentUser(c)

  const outcome = await banUser(
    c.env.DB,
    actorInfoOf(actor),
    c.req.param('id'),
    body,
    c.get('auditor'),
  )

  await notifySanction(c.env, 'account_banned', outcome.user, { reason: body.reason })

  return ok(c, { sanction: outcomeToJson(outcome) })
})

userRoutes.post('/:id/reactivate', requireCapability('users.sanction'), async (c) => {
  const body = await readJson(c, reactivateBodySchema)
  const actor = currentUser(c)

  const outcome = await reactivateUser(
    c.env.DB,
    actorInfoOf(actor),
    c.req.param('id'),
    body.reason,
    c.get('auditor'),
  )

  return ok(c, { liftedSanctions: outcome.revokedSessions, user: outcome.user })
})

userRoutes.delete('/:id', requireCapability('users.delete'), async (c) => {
  const actor = currentUser(c)

  // Deleting is destructive, so a reason is required even though the HTTP
  // DELETE verb has no body convention for it. `?reason=` keeps it in the URL
  // where any proxy in front of us will log it.
  const reason = readString(c, 'reason', 1000)
  if (!reason || reason.length < 3) {
    throw badRequest('A "reason" query parameter of at least 3 characters is required.')
  }

  const outcome = await softDeleteUser(
    c.env.DB,
    actorInfoOf(actor),
    c.req.param('id'),
    { reason },
    c.get('auditor'),
  )

  return ok(c, { sanction: outcomeToJson(outcome) })
})

// ------------------------------------------------------------------ notes ---

userRoutes.get('/:id/notes', requireCapability('users.notes.read'), async (c) => {
  const pagination = parsePagination({ page: readInt(c, 'page'), limit: readInt(c, 'limit') })
  const { rows, total } = await listUserNotes(c.env.DB, c.req.param('id'), pagination)
  return list(c, rows, total, pagination)
})

userRoutes.post('/:id/notes', requireCapability('users.notes.write'), async (c) => {
  const body = await readJson(c, createNoteSchema)
  const note = await addUserNote(
    c.env.DB,
    actorInfoOf(currentUser(c)),
    c.req.param('id'),
    body.body,
    c.get('auditor'),
  )
  return ok(c, note, { status: 201 })
})

// --------------------------------------------------------------- sessions ---

userRoutes.get('/:id/sessions', requireCapability('users.read'), async (c) => {
  const sessions = await listSessionsForUser(c.env.DB, c.req.param('id'))
  return ok(c, { sessions })
})

userRoutes.delete('/:id/sessions', requireCapability('users.sessions.revoke'), async (c) => {
  const body = await readJson(c, revokeSessionsBodySchema)
  const revoked = await revokeUserSessionsByAdmin(
    c.env.DB,
    actorInfoOf(currentUser(c)),
    c.req.param('id'),
    body.reason,
    c.get('auditor'),
  )
  return ok(c, { revoked })
})

// --------------------------------------------------------- password resets ---

/**
 * Admin-initiated password reset.
 *
 * The two modes carry DIFFERENT privilege requirements, which is why this is
 * one route rather than two:
 *
 *   email -> the target receives a link and chooses their own password, so the
 *            admin only needs to be able to edit the account at all.
 *   temp  -> the admin LEARNS the new password, i.e. it is an account-takeover
 *            primitive, so it requires strictly outranking the target. Without
 *            this check a moderator could reset an admin's password and log in
 *            as them.
 */
userRoutes.post(
  '/:id/reset-password',
  requireCapability('users.password.reset'),
  rateLimit('password_reset_ip'),
  async (c) => {
    const body = await readJson(c, adminResetPasswordSchema)
    const actor = currentUser(c)
    const config = appConfig(c.env)
    const target = await requireUserById(c.env.DB, c.req.param('id'))
    const actorInfo = actorInfoOf(actor)

    if (body.mode === 'temp') {
      assertCanModerateUser(actorInfo, { id: target.id, role: target.role })

      const result = await changePassword(
        c.env.DB,
        config,
        actorInfo,
        {
          userId: target.id,
          currentPassword: null,
          newPassword: body.tempPassword ?? '',
          keepSessionId: null,
          reason: 'admin_temp_password',
          selfService: false,
          requirePasswordChange: true,
        },
        c.get('auditor'),
      )

      return ok(c, { mode: 'temp', revokedSessions: result.revokedSessions })
    }

    assertCanEditUser(actorInfo, { id: target.id, role: target.role })

    const ticket = await createPasswordReset(
      c.env.DB,
      config,
      { email: target.email, requestIp: getClientIp(c), requestedBy: actorInfo },
      c.get('auditor'),
    )

    let delivered = false
    if (ticket) {
      const settings = await getSettingsMap(c.env.DB)
      const message = await queueEmail(c.env.DB, {
        to: ticket.email,
        templateKey: 'password_reset',
        variables: {
          platform_name: platformNameOf(settings),
          display_name: ticket.displayName,
          reset_url: await buildPasswordResetUrl(c.env, ticket.token),
          expires_in: humanizeDuration(PASSWORD_RESET_TTL_MS),
        },
      })
      delivered = message !== null
    }

    return ok(c, {
      mode: 'email',
      delivered,
      expiresAt: ticket?.expiresAt ?? null,
      // Without a mail provider the flow cannot be completed by hand, so the
      // token is returned to make it testable. Gated on `allowDevTokens`, which
      // is false in production (see lib/config.ts).
      ...(config.allowDevTokens ? { devToken: ticket?.token ?? null } : {}),
    })
  },
)

function outcomeToJson(outcome: SanctionOutcome): Record<string, unknown> {
  return {
    id: outcome.sanctionId === '' ? null : outcome.sanctionId,
    expiresAt: outcome.expiresAt,
    revokedSessions: outcome.revokedSessions,
    user: outcome.user,
  }
}
