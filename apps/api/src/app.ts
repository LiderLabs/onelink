import { Hono } from 'hono'
import { cors } from 'hono/cors'
import { secureHeaders } from 'hono/secure-headers'
import { bodyLimit } from 'hono/body-limit'
import { logger } from 'hono/logger'

import { appConfig } from './lib/config'
import { allowedOrigin } from './lib/http'
import { isAppError } from './lib/errors'
import { notFoundHandler, onError } from './middleware/error'
import { requestIdMiddleware } from './middleware/request-id'
import { auditMiddleware } from './middleware/audit'
import { loadSession } from './middleware/auth'
import { maintenanceGuard } from './middleware/maintenance'

import { healthRoutes } from './routes/health'
import { publicRoutes } from './routes/public'
import { authRoutes } from './routes/auth'
import { userRoutes } from './routes/users'
import { settingsRoutes } from './routes/settings'
import { auditRoutes } from './routes/audit'
import type { AppEnv } from './types'

// ============================================================================
// Application assembly — the middleware ORDER is the design.
//
//   1. requestId          every later layer can correlate its logs
//   2. logger             (dev only)
//   3. secureHeaders      set before any handler can produce a body
//   4. cors               must answer preflight before auth touches it
//   5. bodyLimit          reject oversized payloads before parsing
//   6. audit              installs the Auditor; also the safety-net logger
//   7. loadSession        resolves the cookie into c.user (never rejects)
//   8. maintenanceGuard   needs c.user to know whether to exempt an owner
//   9. routes
//  10. onError / notFound
//
// audit sits ABOVE loadSession on purpose: it creates the Auditor object early
// (so any layer can claim an entry) but reads `c.get('user')` lazily at claim
// time, which is why the actor is correct despite being installed first.
// ============================================================================

export const MAX_BODY_BYTES = 256 * 1024

export function createApp() {
  const app = new Hono<AppEnv>()

  app.onError(onError)
  app.notFound(notFoundHandler)

  app.use('*', requestIdMiddleware)

  app.use('*', async (c, next) => {
    // Hono's logger is noisy in tests; keep it to local development only.
    if (appConfig(c.env).isProduction) return next()
    return logger()(c, next)
  })

  app.use(
    '*',
    secureHeaders({
      // The API returns JSON only, so a maximally restrictive policy is free.
      contentSecurityPolicy: { defaultSrc: ["'none'"], frameAncestors: ["'none'"] },
      crossOriginResourcePolicy: 'same-site',
      referrerPolicy: 'no-referrer',
      xFrameOptions: 'DENY',
      xContentTypeOptions: 'nosniff',
    }),
  )

  app.use('*', async (c, next) => {
    const env = c.env
    return cors({
      // A callback rather than a plain string, because `allowedOrigin` must be
      // able to answer "send no grant at all" (null) in production — see
      // lib/http.ts for why reflecting the caller is not an option.
      origin: (requestOrigin) => allowedOrigin(env, requestOrigin),
      credentials: true,
      allowMethods: ['GET', 'POST', 'PATCH', 'PUT', 'DELETE', 'OPTIONS'],
      allowHeaders: ['content-type', 'x-request-id'],
      exposeHeaders: ['x-request-id', 'x-ratelimit-limit', 'x-ratelimit-remaining', 'x-ratelimit-reset'],
      maxAge: 600,
    })(c, next)
  })

  app.use(
    '*',
    bodyLimit({
      maxSize: MAX_BODY_BYTES,
      onError: (c) =>
        c.json(
          {
            error: { code: 'BAD_REQUEST', message: 'That request body is too large.' },
            meta: { requestId: c.get('requestId') ?? 'unknown' },
          },
          413,
        ),
    }),
  )

  app.use('*', auditMiddleware)
  app.use('*', loadSession)
  app.use('*', maintenanceGuard)

  app.route('/health', healthRoutes)
  app.route('/api/v1/health', healthRoutes)
  app.route('/api/v1/public', publicRoutes)
  app.route('/api/v1/auth', authRoutes)
  app.route('/api/v1/admin/users', userRoutes)
  app.route('/api/v1/admin/settings', settingsRoutes)
  app.route('/api/v1/admin/audit-logs', auditRoutes)

  return app
}

export const app = createApp()

export type App = typeof app
export { isAppError }
