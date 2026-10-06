import { Hono } from 'hono'
import { noContent, ok } from '../lib/http'
import {
  requireActiveAccount,
  requirePasswordSettled,
  requireUnimpersonated,
} from '../middleware/auth'
import { rateLimit } from '../middleware/rate-limit'
import { actorInfoOf } from '../services/user.service'
import {
  createSocialLink,
  deleteSocialLink,
  listSocialLinkDtos,
  reorderSocialLinks,
  requireOwnedSocialLink,
  updateSocialLink,
} from '../services/profile.service'
import { currentUser, readJson } from './helpers'
import {
  createSocialLinkSchema,
  reorderSocialLinksSchema,
  updateSocialLinkSchema,
} from '../validation/profile.schema'
import type { AppEnv } from '../types'

// ============================================================================
// /api/v1/profile — the caller's own identity.
//
// The identity fields themselves (`location`, `pronouns`) are not here: they are
// columns on `users`, so `PATCH /api/v1/auth/me` already owns writing them and this
// router would only be a second door to the same row. What lives here is the
// resource `users` cannot hold — social links, one row each (**D9**) — mounted
// under the same prefix so a client has one place to look for "my profile".
//
// Guards compose exactly as on `PATCH /auth/me`, in this order:
//
//   1. `requireActiveAccount`  — no suspended/banned/deleted/pending accounts,
//   2. `requirePasswordSettled` — no outstanding forced password change,
//   3. `requireUnimpersonated`  — only on writes; an impersonated session reads,
//   4. `writeLimit`             — the flood is refused before the body is parsed,
//   5. `readJson`               — and only then is anything parsed at all.
//
// Reads stop after step 2: `GET /socials` is open to an impersonated session — support
// has to see the profile it is looking at — and is unrated, but it is still closed to
// a damaged account, exactly like `GET /pages/mine`. Only `GET /auth/me` is readable by
// anything that merely holds a session, because that is the read that explains the
// damage. Note that steps 3 and 4 run the opposite way round from `routes/pages.ts`,
// which limits before its guards: there the rule is per page and cheap to reach, while
// here it is the one shared `user`-scoped allowance the owner writes their whole
// profile with, so a caller who may not write at all (`403`) must not be able to spend
// it out from under the account holder.
//
// `writeLimit` is `profile_write_user` — the SAME counter `PATCH /auth/me` spends
// on, because the two surfaces write the same profile. A client that burns its
// budget editing its bio cannot then hammer socials, and vice versa; if these were
// separate rows the limit would be trivially doubled by alternating endpoints.
//
// Ownership has no seam to route through: `requireOwnedSocialLink` answers
// `404 Social link` for a foreign id, so nothing below can act on someone else's
// row and no status code reveals that the row exists.
// ============================================================================

export const profileRoutes = new Hono<AppEnv>()

const writeLimit = rateLimit('profile_write_user')

// --------------------------------------------------------------- social links --

profileRoutes.get('/socials', requireActiveAccount, requirePasswordSettled, async (c) => {
  const user = currentUser(c)
  return ok(c, { socials: await listSocialLinkDtos(c.env.DB, user.id) })
})

profileRoutes.post(
  '/socials',
  requireActiveAccount,
  requirePasswordSettled,
  requireUnimpersonated,
  writeLimit,
  async (c) => {
    const user = currentUser(c)
    const body = await readJson(c, createSocialLinkSchema)
    const created = await createSocialLink(
      c.env.DB,
      actorInfoOf(user),
      {
        platform: body.platform,
        url: body.url,
        // Absent stays absent: the service decides `true` for a social that did not
        // say, so the default lives in one place instead of in the schema as well.
        isVisible: body.isVisible,
      },
      c.get('auditor'),
    )
    return ok(c, created, { status: 201 })
  },
)

profileRoutes.patch(
  '/socials/:id',
  requireActiveAccount,
  requirePasswordSettled,
  requireUnimpersonated,
  writeLimit,
  async (c) => {
    const user = currentUser(c)
    const link = await requireOwnedSocialLink(c.env.DB, user.id, c.req.param('id'))
    const body = await readJson(c, updateSocialLinkSchema)
    return ok(c, await updateSocialLink(
      c.env.DB,
      actorInfoOf(user),
      link,
      {
        // `undefined` is "not in the body" — a social has nothing to clear, so every
        // absence simply leaves its column alone.
        platform: body.platform,
        url: body.url,
        isVisible: body.isVisible,
      },
      c.get('auditor'),
    ))
  },
)

/** Registered BEFORE `/socials/:id` so `order` is not swallowed by the id route. */
profileRoutes.put(
  '/socials/order',
  requireActiveAccount,
  requirePasswordSettled,
  requireUnimpersonated,
  writeLimit,
  async (c) => {
    const user = currentUser(c)
    const body = await readJson(c, reorderSocialLinksSchema)
    return ok(c, {
      socials: await reorderSocialLinks(c.env.DB, actorInfoOf(user), body.socialIds, c.get('auditor')),
    })
  },
)

profileRoutes.delete(
  '/socials/:id',
  requireActiveAccount,
  requirePasswordSettled,
  requireUnimpersonated,
  writeLimit,
  async (c) => {
    const user = currentUser(c)
    const link = await requireOwnedSocialLink(c.env.DB, user.id, c.req.param('id'))
    await deleteSocialLink(c.env.DB, actorInfoOf(user), link, c.get('auditor'))
    return noContent(c)
  },
)
