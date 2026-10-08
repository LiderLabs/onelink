import { Hono } from 'hono'
import { badRequest, validationError } from '../lib/errors'
import { list, noContent, normalizeSlug, ok } from '../lib/http'
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
  createLinkGroup,
  createPageLink,
  bulkUpdatePageLinks,
  checkSlugAvailability,
  deletePage,
  deleteLinkGroup,
  deletePageLink,
  getOwnedPageDetail,
  getPagePreview,
  listLinkGroups,
  listPageLinks,
  publishPage,
  reorderLinkGroups,
  reorderPageLinks,
  unpublishPage,
  updatePage,
  updateLinkGroup,
  updatePageLink,
  restorePageLink,
} from '../services/page.service'
import {
  discardPageDraft,
  getPageRevision,
  listPageRevisions,
  ownerPageDtos,
  readPageDraft,
  restorePageRevision,
  savePageDraft,
} from '../services/page-draft.service'
import { fetchLinkMetadata } from '../services/link-metadata.service'
import { getPageAnalytics } from '../services/analytics.service'
import {
  listAccessiblePages,
  requirePageAccess,
  requirePageLinkAccess,
  resolvePageRole,
} from '../services/page-access.service'
import { currentUser, readJson } from './helpers'
import {
  createPageLinkSchema,
  createPageSchema,
  createLinkGroupSchema,
  bulkPageLinksSchema,
  linkMetadataSchema,
  reorderLinkGroupsSchema,
  reorderPageLinksSchema,
  slugInputSchema,
  updateLinkGroupSchema,
  updatePageLinkSchema,
  updatePageSchema,
  pageDraftInputSchema,
} from '../validation/page.schema'
import type { AppEnv } from '../types'

// ============================================================================
// /api/v1/pages — the caller's owned or shared link pages.
//
// Auth is per-user, not per-capability: `user` holds no capabilities, yet this
// is the product surface every signed-in account must reach. Every write below
// composes the same guards in this order:
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
// Reads AND writes reach their page through one access seam (R1.0): each route
// supplies its minimum role and `requirePageAccess` hides every insufficient
// role as `404 Page`. Team membership therefore cannot bypass ownership checks
// or make an inaccessible page id observable.
// ============================================================================

export const pageRoutes = new Hono<AppEnv>()

const writeLimit = rateLimit('pages_write_user')
const autosaveLimit = rateLimit('page_autosave_user', { rejectThrottle: true })

pageRoutes.get('/:id/analytics', requireActiveAccount, requirePasswordSettled, async (c) => {
  const { page } = await requirePageAccess(c.env.DB, actorInfoOf(currentUser(c)), c.req.param('id'))
  const rawDays = c.req.query('days') ?? '30'
  if (!['7', '30', '90'].includes(rawDays)) throw badRequest('Analytics days must be 7, 30 or 90.')
  return ok(c, await getPageAnalytics(c.env.DB, page.id, Number(rawDays)))
})

// --------------------------------------------------------------------- read --

pageRoutes.get(
  '/mine',
  requireActiveAccount,
  requirePasswordSettled,
  async (c) => {
    const user = currentUser(c)
    const pagination = parsePagination({ page: readInt(c, 'page'), limit: readInt(c, 'limit') })
    const actor = actorInfoOf(user)
    const { rows, total } = await listAccessiblePages(c.env.DB, actor, pagination)
    // DTOs, not rows (R1.1): a listing must not leak `user_id`, `deleted_at` or
    // the internal `content_revision` counter, and it has to report a revision
    // exactly the way `GET /:id` does — hence `page.service.ts` owns the mapping.
    const pages = await ownerPageDtos(c.env.DB, rows)
    return list(
      c,
      pages.map((page, index) => ({
        ...page,
        accessRole: resolvePageRole(actor, rows[index]!),
      })),
      total,
      pagination,
    )
  },
)

pageRoutes.get(
  '/slug-available',
  requireActiveAccount,
  requirePasswordSettled,
  async (c) => {
    const raw = c.req.query('slug')
    if (raw === undefined) throw badRequest('A slug is required.')
    const parsed = slugInputSchema.safeParse(raw)
    if (!parsed.success) throw validationError('The slug is invalid.', parsed.error.issues)
    const slug = normalizeSlug(parsed.data)
    return ok(c, await checkSlugAvailability(c.env.DB, slug))
  },
)

pageRoutes.get(
  '/:id',
  requireActiveAccount,
  requirePasswordSettled,
  async (c) => {
    const user = currentUser(c)
    const { page, role } = await requirePageAccess(
      c.env.DB,
      actorInfoOf(user),
      c.req.param('id'),
      'viewer',
    )
    return ok(c, { ...await getOwnedPageDetail(c.env.DB, page), accessRole: role })
  },
)

pageRoutes.get(
  '/:id/preview',
  requireActiveAccount,
  requirePasswordSettled,
  async (c) => {
    const { page } = await requirePageAccess(c.env.DB, actorInfoOf(currentUser(c)), c.req.param('id'), 'viewer')
    return ok(c, await getPagePreview(c.env.DB, page))
  },
)

pageRoutes.get(
  '/:id/draft',
  requireActiveAccount,
  requirePasswordSettled,
  async (c) => {
    const { page } = await requirePageAccess(c.env.DB, actorInfoOf(currentUser(c)), c.req.param('id'), 'viewer')
    return ok(c, { draft: await readPageDraft(c.env.DB, page) })
  },
)

pageRoutes.put(
  '/:id/draft',
  autosaveLimit,
  requireActiveAccount,
  requirePasswordSettled,
  requireUnimpersonated,
  async (c) => {
    const user = currentUser(c)
    const { page } = await requirePageAccess(c.env.DB, actorInfoOf(user), c.req.param('id'), 'editor')
    const body = await readJson(c, pageDraftInputSchema)
    return ok(c, {
      draft: await savePageDraft(
        c.env.DB,
        actorInfoOf(user),
        page,
        body.content,
        body.updatedAt,
        c.get('auditor'),
      ),
    })
  },
)

pageRoutes.post(
  '/:id/draft/discard',
  writeLimit,
  requireActiveAccount,
  requirePasswordSettled,
  requireUnimpersonated,
  async (c) => {
    const user = currentUser(c)
    const { page } = await requirePageAccess(c.env.DB, actorInfoOf(user), c.req.param('id'), 'editor')
    return ok(c, {
      draft: await discardPageDraft(c.env.DB, actorInfoOf(user), page, c.get('auditor')),
    })
  },
)

pageRoutes.get(
  '/:id/revisions',
  requireActiveAccount,
  requirePasswordSettled,
  async (c) => {
    const { page } = await requirePageAccess(c.env.DB, actorInfoOf(currentUser(c)), c.req.param('id'), 'viewer')
    return ok(c, { revisions: await listPageRevisions(c.env.DB, page.id) })
  },
)

pageRoutes.get(
  '/:id/revisions/:revision',
  requireActiveAccount,
  requirePasswordSettled,
  async (c) => {
    const { page } = await requirePageAccess(c.env.DB, actorInfoOf(currentUser(c)), c.req.param('id'), 'viewer')
    const revision = Number(c.req.param('revision'))
    if (!Number.isSafeInteger(revision) || revision < 1) throw badRequest('A valid revision number is required.')
    return ok(c, await getPageRevision(c.env.DB, page.id, revision))
  },
)

pageRoutes.post(
  '/:id/revisions/:revision/restore',
  writeLimit,
  requireActiveAccount,
  requirePasswordSettled,
  requireUnimpersonated,
  async (c) => {
    const user = currentUser(c)
    const { page } = await requirePageAccess(c.env.DB, actorInfoOf(user), c.req.param('id'), 'editor')
    const revision = Number(c.req.param('revision'))
    if (!Number.isSafeInteger(revision) || revision < 1) throw badRequest('A valid revision number is required.')
    return ok(c, {
      draft: await restorePageRevision(
        c.env.DB,
        actorInfoOf(user),
        page,
        revision,
        c.get('auditor'),
      ),
    })
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
    const { page, role } = await requirePageAccess(c.env.DB, actorInfoOf(user), c.req.param('id'), 'editor')
    const body = await readJson(c, updatePageSchema)
    if (body.slug !== undefined && role !== 'owner') {
      await requirePageAccess(c.env.DB, actorInfoOf(user), page.id, 'owner')
    }
    return ok(c, await updatePage(
      c.env.DB,
      actorInfoOf(user),
      page,
      {
        slug: body.slug,
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
    const { page } = await requirePageAccess(c.env.DB, actorInfoOf(user), c.req.param('id'), 'editor')
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
    const { page } = await requirePageAccess(c.env.DB, actorInfoOf(user), c.req.param('id'), 'editor')
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

pageRoutes.get(
  '/:id/links',
  requireActiveAccount,
  requirePasswordSettled,
  async (c) => {
    const { page } = await requirePageAccess(c.env.DB, actorInfoOf(currentUser(c)), c.req.param('id'), 'viewer')
    const trashed = c.req.query('trashed')
    if (trashed !== undefined && trashed !== '1') throw badRequest('"trashed" must be 1 when supplied.')
    return ok(c, { links: await listPageLinks(c.env.DB, page, trashed === '1') })
  },
)

pageRoutes.get(
  '/:id/groups',
  requireActiveAccount,
  requirePasswordSettled,
  async (c) => {
    const { page } = await requirePageAccess(c.env.DB, actorInfoOf(currentUser(c)), c.req.param('id'), 'viewer')
    return ok(c, { groups: await listLinkGroups(c.env.DB, page) })
  },
)

pageRoutes.post(
  '/:id/groups',
  writeLimit,
  requireActiveAccount,
  requirePasswordSettled,
  requireUnimpersonated,
  async (c) => {
    const user = currentUser(c)
    const { page } = await requirePageAccess(c.env.DB, actorInfoOf(user), c.req.param('id'), 'editor')
    const body = await readJson(c, createLinkGroupSchema)
    return ok(c, await createLinkGroup(c.env.DB, actorInfoOf(user), page, body.name, c.get('auditor')), { status: 201 })
  },
)

pageRoutes.put(
  '/:id/groups/order',
  writeLimit,
  requireActiveAccount,
  requirePasswordSettled,
  requireUnimpersonated,
  async (c) => {
    const user = currentUser(c)
    const { page } = await requirePageAccess(c.env.DB, actorInfoOf(user), c.req.param('id'), 'editor')
    const body = await readJson(c, reorderLinkGroupsSchema)
    return ok(c, {
      groups: await reorderLinkGroups(c.env.DB, actorInfoOf(user), page, body.groupIds, c.get('auditor')),
    })
  },
)

pageRoutes.patch(
  '/:id/groups/:groupId',
  writeLimit,
  requireActiveAccount,
  requirePasswordSettled,
  requireUnimpersonated,
  async (c) => {
    const user = currentUser(c)
    const { page } = await requirePageAccess(c.env.DB, actorInfoOf(user), c.req.param('id'), 'editor')
    const body = await readJson(c, updateLinkGroupSchema)
    return ok(c, await updateLinkGroup(
      c.env.DB, actorInfoOf(user), page, c.req.param('groupId'), body.name, c.get('auditor'),
    ))
  },
)

pageRoutes.delete(
  '/:id/groups/:groupId',
  writeLimit,
  requireActiveAccount,
  requirePasswordSettled,
  requireUnimpersonated,
  async (c) => {
    const user = currentUser(c)
    const { page } = await requirePageAccess(c.env.DB, actorInfoOf(user), c.req.param('id'), 'editor')
    await deleteLinkGroup(c.env.DB, actorInfoOf(user), page, c.req.param('groupId'), c.get('auditor'))
    return noContent(c)
  },
)

pageRoutes.post(
  '/:id/links',
  writeLimit,
  requireActiveAccount,
  requirePasswordSettled,
  requireUnimpersonated,
  async (c) => {
    const user = currentUser(c)
    const { page } = await requirePageAccess(c.env.DB, actorInfoOf(user), c.req.param('id'), 'editor')
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
        groupId: body.groupId,
        openInNewTab: body.openInNewTab,
        thumbnailKey: body.thumbnailKey,
        startsAt: body.startsAt,
        endsAt: body.endsAt,
      },
      c.get('auditor'),
    )
    return ok(c, created, { status: 201 })
  },
)

pageRoutes.post(
  '/:id/links/metadata',
  writeLimit,
  requireActiveAccount,
  requirePasswordSettled,
  requireUnimpersonated,
  async (c) => {
    await requirePageAccess(c.env.DB, actorInfoOf(currentUser(c)), c.req.param('id'), 'editor')
    const body = await readJson(c, linkMetadataSchema)
    return ok(c, await fetchLinkMetadata(body.url))
  },
)

pageRoutes.post(
  '/:id/links/bulk',
  writeLimit,
  requireActiveAccount,
  requirePasswordSettled,
  requireUnimpersonated,
  async (c) => {
    const user = currentUser(c)
    const { page } = await requirePageAccess(c.env.DB, actorInfoOf(user), c.req.param('id'), 'editor')
    const body = await readJson(c, bulkPageLinksSchema)
    return ok(c, {
      links: await bulkUpdatePageLinks(
        c.env.DB, actorInfoOf(user), page, body.ids, body.action, body.groupId, c.get('auditor'),
      ),
    })
  },
)

pageRoutes.post(
  '/:id/links/:linkId/restore',
  writeLimit,
  requireActiveAccount,
  requirePasswordSettled,
  requireUnimpersonated,
  async (c) => {
    const user = currentUser(c)
    const { page } = await requirePageAccess(c.env.DB, actorInfoOf(user), c.req.param('id'), 'editor')
    return ok(c, await restorePageLink(
      c.env.DB, actorInfoOf(user), page, c.req.param('linkId'), c.get('auditor'),
    ))
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
    const { page } = await requirePageAccess(c.env.DB, actorInfoOf(user), c.req.param('id'), 'editor')
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
        groupId: body.groupId,
        openInNewTab: body.openInNewTab,
        thumbnailKey: body.thumbnailKey,
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
    const { page } = await requirePageAccess(c.env.DB, actorInfoOf(user), c.req.param('id'), 'editor')
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
    const { page } = await requirePageAccess(c.env.DB, actorInfoOf(user), c.req.param('id'), 'editor')
    const link = await requirePageLinkAccess(c.env.DB, page, c.req.param('linkId'))
    await deletePageLink(c.env.DB, actorInfoOf(user), page, link, c.get('auditor'))
    return noContent(c)
  },
)
