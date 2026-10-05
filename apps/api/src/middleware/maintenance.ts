import { createMiddleware } from 'hono/factory'
import { maintenance } from '../lib/errors'
import { SETTING_KEYS, getBooleanSetting, getStringSetting } from '../services/settings.service'
import { isMutationMethod } from './audit'
import type { AppEnv } from '../types'

// ============================================================================
// Maintenance mode.
//
// Blocks WRITES only — reads keep working, so the admin UI can still load and
// explain what is happening.
//
// Two deliberate exemptions:
//
//   1. `/api/v1/auth/*` is always allowed. Admins need to log in to turn
//      maintenance mode back off; blocking login would be a self-lockout.
//   2. Users holding `settings.update` (i.e. owners) bypass the block entirely,
//      so they can operate the platform during a maintenance window.
// ============================================================================

const EXEMPT_PREFIXES = ['/api/v1/auth']

function isExempt(path: string): boolean {
  return EXEMPT_PREFIXES.some((prefix) => path === prefix || path.startsWith(`${prefix}/`))
}

export const maintenanceGuard = createMiddleware<AppEnv>(async (c, next) => {
  if (!isMutationMethod(c.req.method)) return next()
  if (isExempt(c.req.path)) return next()

  const user = c.get('user')
  if (user && (user.role === 'owner' || user.role === 'admin')) return next()

  const enabled = await getBooleanSetting(c.env.DB, SETTING_KEYS.maintenanceMode, false)
  if (!enabled) return next()

  const message = await getStringSetting(
    c.env.DB,
    SETTING_KEYS.maintenanceMessage,
    'We are performing scheduled maintenance. Please check back shortly.',
  )
  throw maintenance(message)
})
