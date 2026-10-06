import { createMiddleware } from 'hono/factory'
import { appConfig } from '../lib/config'
import { accountDisabled, forbidden, passwordChangeRequired, unauthenticated } from '../lib/errors'
import { readSessionToken } from '../lib/http'
import { isMutationMethod } from './audit'
import { authorize, type Capability } from '../lib/rbac'
import { resolveSession, touchSession } from '../services/auth.service'
import type { AppEnv, AuthUser } from '../types'

// ============================================================================
// Authentication / authorisation middleware.
//
//   loadSession           -> populates c.user from the cookie, never rejects
//   requireSession        -> any authenticated identity, however damaged
//   requireActiveAccount  -> status must be usable
//   requirePasswordSettled-> no forced password change outstanding
//   requireUnimpersonated -> an impersonation session may not mutate
//   requireCapability(c)  -> all of the above + the role grant
//
// NOTE ON SHAPE: middleware that takes no arguments is exported as a READY
// HANDLER (a value), not as a factory. A factory is easy to pass uncalled —
// `app.get('/x', requireSession, handler)` compiles fine, then Hono invokes the
// factory as the handler, which never calls `next()` and silently returns an
// empty 200. Values make that mistake impossible. Only `requireCapability`
// remains a factory, because it genuinely needs an argument.
// ============================================================================

export const loadSession = createMiddleware<AppEnv>(async (c, next) => {
  const token = readSessionToken(c)
  if (token) {
    const resolved = await resolveSession(c.env.DB, appConfig(c.env), token)
    if (resolved) {
      c.set('user', resolved.user)
      c.set('session', resolved.session)
      // Sliding expiry, throttled internally. Awaited rather than deferred to
      // waitUntil so behaviour is identical in tests and in production.
      await touchSession(c.env.DB, resolved.session)
    }
  }
  await next()
})

export const requireSession = createMiddleware<AppEnv>(async (c, next) => {
  if (!c.get('user')) throw unauthenticated()
  await next()
})

/** Throws unless the account is in a state that permits normal use. */
export function assertAccountUsable(user: AuthUser): void {
  if (user.status === 'suspended' || user.status === 'banned' || user.status === 'deleted') {
    throw accountDisabled(user.statusReason ?? 'This account is not currently available.')
  }
  if (user.status === 'pending') {
    throw accountDisabled('This account has not been activated yet.')
  }
}

export const requireActiveAccount = createMiddleware<AppEnv>(async (c, next) => {
  const user = c.get('user')
  if (!user) throw unauthenticated()
  assertAccountUsable(user)
  await next()
})

export const requirePasswordSettled = createMiddleware<AppEnv>(async (c, next) => {
  const user = c.get('user')
  if (!user) throw unauthenticated()
  if (user.requirePasswordChange) throw passwordChangeRequired()
  await next()
})

/**
 * Impersonated sessions are READ-ONLY (R1.1).
 *
 * Lifted out of `routes/pages.ts`, where it was called `requireOwnerSelf`: owner
 * routes do NOT go through `requireCapability`, which is where this rule
 * otherwise lives, so without it an admin acting as a user could publish, delete
 * or — now that the surface exists — rewrite that user's profile, and the audit
 * trail would name the wrong actor. Two surfaces need the rule, so it lives here
 * and both of them get the same implementation.
 *
 * Reads are deliberately NOT blocked: a support session must still be able to
 * see the account it is acting as, and `middleware/audit.ts` records who really
 * made a change (the session's `impersonated_by` is on every audit row).
 */
export const requireUnimpersonated = createMiddleware<AppEnv>(async (c, next) => {
  const user = c.get('user')
  if (!user) throw unauthenticated()
  if (user.impersonatedBy !== null && isMutationMethod(c.req.method)) {
    throw forbidden('Impersonation sessions are read-only.')
  }
  await next()
})

/**
 * The guard every /admin route uses. Composed deliberately:
 *
 *   1. identity present
 *   2. account usable (not suspended/banned/deleted/pending)
 *   3. no outstanding forced password change
 *   4. role holds the capability
 *   5. impersonation sessions are READ-ONLY
 *
 * Step 5 is the one people forget: an admin acting as a user must not be able
 * to take destructive actions *as* that user, or the audit trail becomes a lie.
 */
export const requireCapability = (capability: Capability) =>
  createMiddleware<AppEnv>(async (c, next) => {
    const user = c.get('user')
    if (!user) throw unauthenticated()
    assertAccountUsable(user)
    if (user.requirePasswordChange) throw passwordChangeRequired()
    authorize(user.role, capability)

    if (user.impersonatedBy !== null && isMutationMethod(c.req.method)) {
      throw forbidden('Impersonation sessions are read-only.')
    }

    await next()
  })
