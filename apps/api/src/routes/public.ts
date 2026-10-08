import { Hono } from 'hono'
import { noContent, normalizeSlug, ok } from '../lib/http'
import { capabilitiesOf, CAPABILITIES } from '../lib/rbac'
import { ROLE_RANK, ROLES, STAFF_ROLES } from '../lib/constants'
import { rateLimit } from '../middleware/rate-limit'
import { recordPublicPageEvent } from '../services/analytics.service'
import { createPageReport } from '../services/moderation.service'
import { getPublicSettings, SETTING_KEYS } from '../services/settings.service'
import { getPublicPage } from '../services/page.service'
import { readJson } from './helpers'
import { publicPageEventSchema } from '../validation/analytics.schema'
import { createPageReportSchema } from '../validation/moderation.schema'
import { getClientIp } from '../lib/http'
import type { AppEnv } from '../types'

// ============================================================================
// Unauthenticated surface. Everything here is safe to expose to any browser.
//
// The allowlist is explicit rather than "everything not marked private": a
// setting added to the database in future is invisible until someone
// deliberately exposes it here.
// ============================================================================

const PUBLIC_SETTING_KEYS = new Set<string>([
  SETTING_KEYS.platformName,
  SETTING_KEYS.platformTagline,
  SETTING_KEYS.maintenanceMode,
  SETTING_KEYS.maintenanceMessage,
  SETTING_KEYS.pagesBaseUrl,
  // Drives whether the SPA renders a "create account" link at all; the actual
  // gate is enforced server-side in POST /auth/register.
  SETTING_KEYS.registrationOpen,
])

export const publicRoutes = new Hono<AppEnv>()

const analyticsEventLimit = rateLimit('analytics_event_ip')
const reportCreateLimit = rateLimit('report_create_ip')

/**
 * Anonymous page read. The ONLY unauthenticated page surface.
 *
 * `/:slug` is looked up AFTER normalisation — "/Ada", "/ADA" and "/ada" are
 * the same page — and visibility is enforced in one place
 * (`getPublicPage`): live, published, owner usable, links visible and
 * in-window. Anything else is `404 Page`, indistinguishable from an unknown
 * slug, so the response reveals nothing about why a page is unreachable.
 *
 * Pure read: no counters, no audit rows. Anonymous reads are not attributed to
 * anyone, so an audit entry would be noise; view counting arrives separately.
 */
publicRoutes.get('/pages/:slug', async (c) => {
  const slug = normalizeSlug(c.req.param('slug'))
  return ok(c, await getPublicPage(c.env.DB, slug))
})

publicRoutes.post('/pages/:slug/events', analyticsEventLimit, async (c) => {
  const event = await readJson(c, publicPageEventSchema)
  await recordPublicPageEvent(c.env.DB, c.req.param('slug'), event)
  return noContent(c)
})

publicRoutes.post('/pages/:slug/reports', reportCreateLimit, async (c) => {
  const body = await readJson(c, createPageReportSchema)
  const user = c.get('user')
  const report = await createPageReport(c.env.DB, {
    slug: c.req.param('slug'),
    targetType: body.targetType ?? 'page',
    linkId: body.linkId ?? null,
    category: body.category,
    description: body.description ?? null,
    reporterUserId: user?.id ?? null,
    reporterLabel: user?.displayName ?? user?.username ?? null,
    reporterEmail: body.email ?? null,
    reporterIp: getClientIp(c),
  }, c.get('auditor'))
  return ok(c, { received: true }, { status: report.duplicate ? 200 : 201 })
})

publicRoutes.get('/settings', async (c) => {
  const { settings, platformName } = await getPublicSettings(c.env.DB)

  const filtered: Record<string, unknown> = {}
  for (const [key, value] of Object.entries(settings)) {
    if (PUBLIC_SETTING_KEYS.has(key)) filtered[key] = value
  }
  if (!(SETTING_KEYS.pagesBaseUrl in filtered)) {
    filtered[SETTING_KEYS.pagesBaseUrl] = 'https://onelink.local/'
  }

  return ok(c, {
    platformName,
    settings: filtered,
    // Roles are public because the SPA needs them to render the role picker,
    // and the capability matrix needs it to hide buttons the user cannot use.
    roles: ROLES.map((role) => ({
      role,
      rank: ROLE_RANK[role],
      staff: (STAFF_ROLES as readonly string[]).includes(role),
    })),
  })
})

/**
 * The capability matrix.
 *
 * Exposed so the SPA can hide actions a role cannot perform. It is NOT a
 * security boundary — every route re-checks server-side. Clients that use it
 * for authorisation are trusting the client, which is exactly the mistake this
 * endpoint exists to avoid.
 */
publicRoutes.get('/capabilities', (c) =>
  ok(c, {
    capabilities: CAPABILITIES,
    byRole: Object.fromEntries(ROLES.map((role) => [role, capabilitiesOf(role)])),
  }),
)
