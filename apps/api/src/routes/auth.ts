import { Hono } from 'hono'
import { appConfig } from '../lib/config'
import {
  clearSessionCookie,
  getClientIp,
  getUserAgent,
  noContent,
  ok,
  setSessionCookie,
  SESSION_COOKIE_MAX_AGE_SECONDS,
} from '../lib/http'
import { PASSWORD_RESET_TTL_MS } from '../lib/constants'
import { humanizeDuration } from '../lib/clock'
import { forbidden } from '../lib/errors'
import { capabilitiesOf } from '../lib/rbac'
import { rateLimit } from '../middleware/rate-limit'
import { requireActiveAccount, requireSession } from '../middleware/auth'
import {
  buildPasswordResetUrl,
  changePassword,
  consumePasswordReset,
  createPasswordReset,
  login,
  logout,
} from '../services/auth.service'
import { queueEmail } from '../services/email.service'
import {
  getBooleanSetting,
  getSettingsMap,
  platformNameOf,
  SETTING_KEYS,
} from '../services/settings.service'
import { actorInfoOf, registerUser } from '../services/user.service'
import { currentUser, readJson } from './helpers'
import {
  changePasswordSchema,
  forgotPasswordSchema,
  loginSchema,
  registerSchema,
  resetPasswordSchema,
} from '../validation/auth.schema'
import type { AppEnv } from '../types'

// ============================================================================
// /api/v1/auth
//
// Session-based: login mints an opaque token and sets it as an httpOnly
// `__Host-` cookie. No token ever appears in a response body or in JavaScript,
// which is what makes the SPA safe against XSS token theft.
// ============================================================================

export const authRoutes = new Hono<AppEnv>()

/**
 * Public sign-up.
 *
 * Both halves of the guard sit in front of the body:
 *
 *   - `rateLimit('register_ip')` runs as middleware, before anything is parsed,
 *     which is what stops a script from turning this into a bulk
 *     name-availability lookup;
 *   - `platform.registration_open` is read from the (cached) settings snapshot
 *     and answers 403 when an owner has closed the door — the default when the
 *     row is missing is `false`, because "closed" is the safe direction for a
 *     switch whose whole purpose is to stop strangers creating accounts.
 *
 * The response is 201 with the session cookie already set (see `registerUser`):
 * the caller is signed in, so the SPA has one post-auth path rather than two.
 *
 * Maintenance mode does NOT block this: `/api/v1/auth` is exempt in
 * middleware/maintenance.ts, so sign-up stays available to visitors of a
 * read-only platform. That is intentional — the exemption exists so people can
 * still authenticate — and covered by a test.
 */
authRoutes.post('/register', rateLimit('register_ip'), async (c) => {
  const registrationOpen = await getBooleanSetting(
    c.env.DB,
    SETTING_KEYS.registrationOpen,
    false,
  )
  if (!registrationOpen) throw forbidden('Registration is currently closed.')

  const body = await readJson(c, registerSchema)

  const result = await registerUser(
    c.env.DB,
    appConfig(c.env),
    {
      username: body.username,
      email: body.email,
      password: body.password,
      displayName: body.displayName,
      ip: getClientIp(c),
      userAgent: getUserAgent(c),
    },
    c.get('auditor'),
  )

  setSessionCookie(c, result.token, SESSION_COOKIE_MAX_AGE_SECONDS)
  return ok(
    c,
    {
      user: result.user,
      capabilities: capabilitiesOf(result.user.role),
      expiresAt: result.session.expires_at,
    },
    { status: 201 },
  )
})

authRoutes.post('/login', rateLimit('login_ip'), async (c) => {
  const body = await readJson(c, loginSchema)

  const result = await login(
    c.env.DB,
    appConfig(c.env),
    {
      identifier: body.identifier,
      password: body.password,
      ip: getClientIp(c),
      userAgent: getUserAgent(c),
    },
    c.get('auditor'),
  )

  setSessionCookie(c, result.token, SESSION_COOKIE_MAX_AGE_SECONDS)
  return ok(c, {
    user: result.user,
    capabilities: capabilitiesOf(result.user.role),
    expiresAt: result.session.expires_at,
  })
})

authRoutes.post('/logout', requireSession, async (c) => {
  const user = currentUser(c)
  const session = c.get('session')

  if (session) {
    await logout(
      c.env.DB,
      { sessionId: session.id, userId: user.id, userLabel: user.email },
      c.get('auditor'),
    )
  }

  clearSessionCookie(c)
  return noContent(c)
})

/**
 * Uses `requireSession`, not `requireAuth`: a suspended user must still be able
 * to call this so the SPA can render "your account is suspended, here is why"
 * instead of a bare 403.
 */
authRoutes.get('/me', requireSession, async (c) => {
  const user = currentUser(c)
  const settings = await getSettingsMap(c.env.DB)
  return ok(c, {
    user,
    capabilities: capabilitiesOf(user.role),
    platformName: platformNameOf(settings),
    serverTime: Date.now(),
  })
})

/**
 * `requireActiveAccount` rather than full auth: this is the ONE route a user
 * with a forced password change must still be able to reach, otherwise they are
 * locked out permanently.
 */
authRoutes.post('/change-password', requireActiveAccount, async (c) => {
  const body = await readJson(c, changePasswordSchema)
  const user = currentUser(c)
  const session = c.get('session')

  const result = await changePassword(
    c.env.DB,
    appConfig(c.env),
    actorInfoOf(user),
    {
      userId: user.id,
      currentPassword: body.currentPassword,
      newPassword: body.newPassword,
      // Keep the caller's own session so the SPA is not logged out mid-flow.
      keepSessionId: session?.id ?? null,
      reason: 'user_password_change',
      selfService: true,
    },
    c.get('auditor'),
  )

  return ok(c, { revokedSessions: result.revokedSessions })
})

/**
 * Always responds 200 with the same shape, whether or not the address exists.
 * Differing responses here would turn this endpoint into an account-existence
 * oracle for anyone with a word list.
 */
authRoutes.post('/forgot-password', rateLimit('password_reset_ip'), async (c) => {
  const body = await readJson(c, forgotPasswordSchema)
  const config = appConfig(c.env)

  const ticket = await createPasswordReset(
    c.env.DB,
    config,
    { email: body.email, requestIp: getClientIp(c), requestedBy: null },
    c.get('auditor'),
  )

  if (ticket) {
    const settings = await getSettingsMap(c.env.DB)
    await queueEmail(c.env.DB, {
      to: ticket.email,
      templateKey: 'password_reset',
      variables: {
        platform_name: platformNameOf(settings),
        display_name: ticket.displayName,
        reset_url: await buildPasswordResetUrl(c.env, ticket.token),
        expires_in: humanizeDuration(PASSWORD_RESET_TTL_MS),
      },
    })
  }

  return ok(c, {
    accepted: true,
    // Without a mail provider the flow cannot be completed by hand, so the
    // token is returned to make it testable. Gated on `allowDevTokens`, which is
    // false in production (see lib/config.ts).
    ...(config.allowDevTokens ? { devToken: ticket?.token ?? null } : {}),
  })
})

authRoutes.post('/reset-password', async (c) => {
  const body = await readJson(c, resetPasswordSchema)

  const result = await consumePasswordReset(
    c.env.DB,
    appConfig(c.env),
    { token: body.token, newPassword: body.newPassword },
    c.get('auditor'),
  )

  // Every session was revoked by the reset; make the browser agree.
  clearSessionCookie(c)
  return ok(c, {
    userId: result.userId,
    // Echoed because login accepts either name, so this is the one place a user
    // who only ever typed their email address is reminded what the other is.
    username: result.username,
    revokedSessions: result.revokedSessions,
  })
})
