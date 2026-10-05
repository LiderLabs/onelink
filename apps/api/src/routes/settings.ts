import { Hono } from 'hono'
import { z } from 'zod'
import { list, ok } from '../lib/http'
import { parsePagination } from '../lib/query'
import { readInt } from '../lib/params'
import { requireCapability } from '../middleware/auth'
import { invalidateRateLimitCache } from '../middleware/rate-limit'
import { actorInfoOf } from '../services/user.service'
import { listSettings, updateSettings } from '../services/settings.service'
import { currentUser, readJson } from './helpers'
import type { AppEnv } from '../types'

// ============================================================================
// /api/v1/admin/settings
//
// `settings.read` for GET, `settings.update` for PATCH — and per the capability
// table, `admin` holds everything EXCEPT `settings.update`. Changing platform
// policy is the one thing only an owner can do.
// ============================================================================

const patchSchema = z.strictObject({
  settings: z
    .array(
      z.strictObject({
        key: z.string().trim().min(1).max(100),
        // Deliberately `unknown`: the `type` column on the settings row decides
        // what is acceptable, and that check happens in the service where the
        // row is already loaded. Duplicating the type map here would let the two
        // drift apart.
        value: z.unknown(),
      }),
    )
    .min(1, 'Supply at least one setting.')
    .max(100, 'Too many settings in one request.'),
})

export const settingsRoutes = new Hono<AppEnv>()

settingsRoutes.get('/', requireCapability('settings.read'), async (c) => {
  const records = await listSettings(c.env.DB)
  const pagination = parsePagination({
    page: readInt(c, 'page') ?? 1,
    limit: readInt(c, 'limit') ?? Math.max(records.length, 1),
  })
  const groups = [...new Set(records.map((record) => record.group ?? 'general'))].sort()
  return list(c, records, records.length, pagination, { groups })
})

settingsRoutes.patch('/', requireCapability('settings.update'), async (c) => {
  const body = await readJson(c, patchSchema)
  const result = await updateSettings(
    c.env.DB,
    actorInfoOf(currentUser(c)),
    body.settings,
    c.get('auditor'),
  )
  // Rules may have been enabled/disabled, so drop the rate-limit rule cache.
  invalidateRateLimitCache()
  return ok(c, { settings: result.updated, changed: result.changed })
})

