import { Hono } from 'hono'
import { list, noContent, ok } from '../lib/http'
import { parsePagination } from '../lib/query'
import { readInt } from '../lib/params'
import {
  requireActiveAccount,
  requirePasswordSettled,
  requireUnimpersonated,
} from '../middleware/auth'
import { rateLimit } from '../middleware/rate-limit'
import { actorInfoOf } from '../services/user.service'
import {
  createPage,
  createPageLink,
  deletePage,
  deletePageLink,
  getOwnedPageDetail,
  publishPage,
  reorderPageLinks,
  toOwnerPageDto,
  unpublishPage,
  updatePage,
  updatePageLink,
} from '../services/page.service'
import {
  listAccessiblePages,
  requirePageAccess,
  requirePageLinkAccess,
} from '../services/page-access.service'
import { currentUser, readJson } from './helpers'
import {
  createPageLinkSchema,
  createPageSchema,
  reorderPageLinksSchema,
  updatePageLinkSchema,
  updatePageSchema,
} from '../validation/page.schema'
import type { AppEnv } from '../types'

// ============================================================================
// /api/v1/pages — the caller's own link pages.
//
// Auth is per-user, not per-capability: `user` holds no capabilities, yet this
// is the product surface every signed-in account must reach. Every route below
// therefore composes the same three guards in this order:
//
//   1. `requireActiveAccount` — no suspended/banned/deleted/pending accounts,
//   2. `requirePasswordSettled` — no outstanding forced password change,
//   3. `requireUnimpersonated` — impersonated (read-only) sessions cannot mutate.
//
// The third guard lives in `middleware/auth.ts` and is composed explicitly,
// because owner routes do NOT use `requireCapability` — which is where the
// impersonation rule normally lives. It moved there in R1.1, when `PATCH
// /auth/me` needed the same rule: one implementation, so the guarantee ("an
// admin acting as a user cannot write as them") cannot hold on one surface and
// quietly not on another.
//
// Reads AND writes reach their page through one access seam (R1.0):
// `requirePageAccess` answers "may this actor reach this page?" and hides every
// other answer as `404 Page`, so these routes never confirm whether a page id
// belongs to someone else. R2.1's page teams change that one function, not
// these handlers.
// ============================================================================

export const pageRoutes = new Hono<AppEnv>()

const writeLimit = rateLimit('pages_write_user')

// --------------------------------------------------------------------- read --

pageRoutes.get(
  '/mine',
  requireActiveAccount,
  requirePasswordSettled,
  async (c) => {
    const user = currentUser(c)
    const pagination = parsePagination({ page: readInt(c, 'page'), limit: readInt(c, 'limit') })
    const { rows, total } = await listAccessiblePages(c.env.DB, actorInfoOf(user), pagination)
    // DTOs, not rows (R1.1): a listing must not leak `user_id`, `deleted_at` or
    // the internal `content_revision` counter, and it has to report a revision
    // exactly the way `GET /:id` does — hence `page.service.ts` owns the mapping.
    return list(c, rows.map(toOwnerPageDto), total, pagination)
  },
)

pageRoutes.get(
  '/:id',
  requireActiveAccount,
  requirePasswordSettled,
  async (c) => {
    const user = currentUser(c)
    const { page } = await requirePageAccess(c.env.DB, actorInfoOf(user), c.req.param('id'))
    return ok(c, await getOwnedPageDetail(c.env.DB, page))
  },
)

// -------------------------------------------------------------------- write --

pageRoutes.post(
  '/',
  writeLimit,
  requireActiveAccount,
  requirePasswordSettled,
  requireUnimpersonated,
  async (c) => {
    const user = currentUser(c)
    const body = await readJson(c, createPageSchema)
    const created = await createPage(
      c.env.DB,
      actorInfoOf(user),
      user.username,
      {
        slug: body.slug,
        title: body.title,
        bio: body.bio,
        theme: body.theme,
        layout: body.layout,
        accentColor: body.accentColor,
        showBranding: body.showBranding,
      },
      c.get('auditor'),
    )
    return ok(c, created, { status: 201 })
  },
)

pageRoutes.patch(
  '/:id',
  writeLimit,
  requireActiveAccount,
  requirePasswordSettled,
  requireUnimpersonated,
  async (c) => {
    const user = currentUser(c)
    const { page } = await requirePageAccess(c.env.DB, actorInfoOf(user), c.req.param('id'))
    const body = await readJson(c, updatePageSchema)
    return ok(c, await updatePage(
      c.env.DB,
      actorInfoOf(user),
      page,
      {
        // PATCH semantics: `undefined` means "absent, leave it alone" and `null`
        // means "clear it". Folding null into undefined (`?? undefined`) would
        // make an optional column impossible to empty from a client.
        title: body.title,
        bio: body.bio,
        theme: body.theme,
        layout: body.layout,
        accentColor: body.accentColor,
        showBranding: body.showBranding,
      },
      c.get('auditor'),
    ))
  },
)

pageRoutes.post(
  '/:id/publish',
  writeLimit,
  requireActiveAccount,
  requirePasswordSettled,
  requireUnimpersonated,
  async (c) => {
    const user = currentUser(c)
    const { page } = await requirePageAccess(c.env.DB, actorInfoOf(user), c.req.param('id'))
    return ok(c, await publishPage(c.env.DB, actorInfoOf(user), page, c.get('auditor')))
  },
)

pageRoutes.post(
  '/:id/unpublish',
  writeLimit,
  requireActiveAccount,
  requirePasswordSettled,
  requireUnimpersonated,
  async (c) => {
    const user = currentUser(c)
    const { page } = await requirePageAccess(c.env.DB, actorInfoOf(user), c.req.param('id'))
    return ok(c, await unpublishPage(c.env.DB, actorInfoOf(user), page, c.get('auditor')))
  },
)

pageRoutes.delete(
  '/:id',
  writeLimit,
  requireActiveAccount,
  requirePasswordSettled,
  requireUnimpersonated,
  async (c) => {
    const user = currentUser(c)
    const { page } = await requirePageAccess(c.env.DB, actorInfoOf(user), c.req.param('id'))
    await deletePage(c.env.DB, actorInfoOf(user), page, c.get('auditor'))
    return noContent(c)
  },
)

// -------------------------------------------------------------------- links --

pageRoutes.post(
  '/:id/links',
  writeLimit,
  requireActiveAccount,
  requirePasswordSettled,
  requireUnimpersonated,
  async (c) => {
    const user = currentUser(c)
    const { page } = await requirePageAccess(c.env.DB, actorInfoOf(user), c.req.param('id'))
    const body = await readJson(c, createPageLinkSchema)
    const created = await createPageLink(
      c.env.DB,
      actorInfoOf(user),
      page,
      {
        title: body.title,
        url: body.url,
        // Nullable fields keep `null` (clear) distinct from `undefined` (absent).
        description: body.description,
        icon: body.icon,
        isVisible: body.isVisible,
        startsAt: body.startsAt,
        endsAt: body.endsAt,
      },
      c.get('auditor'),
    )
    return ok(c, created, { status: 201 })
  },
)

pageRoutes.patch(
  '/:id/links/:linkId',
  writeLimit,
  requireActiveAccount,
  requirePasswordSettled,
  requireUnimpersonated,
  async (c) => {
    const user = currentUser(c)
    const { page } = await requirePageAccess(c.env.DB, actorInfoOf(user), c.req.param('id'))
    const link = await requirePageLinkAccess(c.env.DB, page, c.req.param('linkId'))
    const body = await readJson(c, updatePageLinkSchema)
    return ok(c, await updatePageLink(
      c.env.DB,
      actorInfoOf(user),
      page,
      link,
      {
        title: body.title,
        url: body.url,
        // Clearing a window or a description is a PATCH with `null`; folding that
        // into `undefined` is what makes "unset" impossible from a client.
        description: body.description,
        icon: body.icon,
        isVisible: body.isVisible,
        startsAt: body.startsAt,
        endsAt: body.endsAt,
      },
      c.get('auditor'),
    ))
  },
)

/** Registered BEFORE `/:id/links/:linkId` so `order` is not swallowed by the id route. */
pageRoutes.put(
  '/:id/links/order',
  writeLimit,
  requireActiveAccount,
  requirePasswordSettled,
  requireUnimpersonated,
  async (c) => {
    const user = currentUser(c)
    const { page } = await requirePageAccess(c.env.DB, actorInfoOf(user), c.req.param('id'))
    const body = await readJson(c, reorderPageLinksSchema)
    return ok(c, {
      links: await reorderPageLinks(c.env.DB, actorInfoOf(user), page, body.linkIds, c.get('auditor')),
    })
  },
)

pageRoutes.delete(
  '/:id/links/:linkId',
  writeLimit,
  requireActiveAccount,
  requirePasswordSettled,
  requireUnimpersonated,
  async (c) => {
    const user = currentUser(c)
    const { page } = await requirePageAccess(c.env.DB, actorInfoOf(user), c.req.param('id'))
    const link = await requirePageLinkAccess(c.env.DB, page, c.req.param('linkId'))
    await deletePageLink(c.env.DB, actorInfoOf(user), page, link, c.get('auditor'))
    return noContent(c)
  },
)
