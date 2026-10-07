import { notFound } from '../lib/errors'
import { asCount } from '../lib/query'
import type { ActorInfo, PageLinkRow, PageRow, Pagination } from '../types'

// ============================================================================
// Page access seam (R1.0).
//
// Before this file existed, every owner route answered three questions in three
// different places: "which pages may this actor list?" (`listOwnPages`), "may
// this actor read this page?" (`requireOwnedPage`) and "does this link belong
// to that page?" (`requireOwnedPageLink`). Release 2's teams (R2.1) change the
// *answer* — a page will have members, each with a role — but not the
// questions, so the questions live here and nowhere else. A team model then
// rewrites `pageAccessPredicate` and `resolvePageRole` instead of every route.
//
// Ownership remains `pages.user_id = actor.id`; collaborators add a page_members
// row and one of the bounded roles below.
//
// The invariant every caller relies on: a page the actor cannot reach is
// `404 Page`, never `403`. Missing, soft-deleted, foreign and
// insufficiently-ranked are one answer, so no status code confirms that an id
// exists or who owns it.
// ============================================================================

/** Per-page roles, weakest first. Rank is the rule, not declaration order. */
export const PAGE_ROLES = ['viewer', 'editor', 'owner'] as const

export type PageRole = (typeof PAGE_ROLES)[number]

export const PAGE_ROLE_RANK: Record<PageRole, number> = {
  viewer: 10,
  editor: 20,
  owner: 30,
}

/** The role the actor holds on this page, or `null` when they hold none. */
export function resolvePageRole(
  actor: ActorInfo,
  page: Pick<PageRow, 'user_id' | 'member_role'>,
): PageRole | null {
  if (page.user_id === actor.id) return 'owner'
  return page.member_role ?? null
}

/**
 * The SQL predicate selecting every page the actor may reach, plus its binds.
 *
 * `listAccessiblePages` and `requirePageAccess` share this one fragment so a
 * listing can never disagree with a single-page read about what is reachable.
 * The `pages.` qualifier is mandatory: both callers write `FROM pages` and
 * every column is qualified, so nothing depends on the table alias.
 */
export function pageAccessPredicate(actor: ActorInfo): { clause: string; binds: unknown[] } {
  return {
    clause: `(pages.user_id = ? OR EXISTS (
      SELECT 1 FROM page_members
       WHERE page_members.page_id = pages.id AND page_members.user_id = ?
    ))`,
    binds: [actor.id, actor.id],
  }
}

export interface PageAccess {
  /** The live row. A page the actor cannot reach never reaches a caller. */
  page: PageRow
  /** The actor's effective per-page role. */
  role: PageRole
}

/**
 * The one read path every owner route uses.
 *
 * `minRole` defaults to `'owner'`; content read/write routes opt into the
 * minimum role they need, while page and team administration stay owner-only.
 */
export async function requirePageAccess(
  db: D1Database,
  actor: ActorInfo,
  pageId: string,
  minRole: PageRole = 'owner',
): Promise<PageAccess> {
  const { clause, binds } = pageAccessPredicate(actor)

  const row = await db
    .prepare(
      `SELECT pages.*,
              (SELECT page_members.role FROM page_members
                WHERE page_members.page_id = pages.id AND page_members.user_id = ?
                LIMIT 1) AS member_role
         FROM pages
        WHERE pages.id = ? AND ${clause} AND pages.deleted_at IS NULL
        LIMIT 1`,
    )
    .bind(actor.id, pageId, ...binds)
    .first<PageRow>()

  const role = row ? resolvePageRole(actor, row) : null

  // One throw for "no such page", "not mine" and "not senior enough on it":
  // a caller cannot tell the three apart, which is the point.
  if (!row || role === null || PAGE_ROLE_RANK[role] < PAGE_ROLE_RANK[minRole]) {
    throw notFound('Page')
  }

  return { page: row, role }
}

/**
 * A live link on a page the actor has already reached.
 *
 * The membership check is part of this query rather than a caller's job: the
 * row it returns is the authority, so a route cannot accidentally act on a link
 * id that belongs to a different page.
 */
export async function requirePageLinkAccess(
  db: D1Database,
  page: Pick<PageRow, 'id'>,
  linkId: string,
): Promise<PageLinkRow> {
  const row = await db
    .prepare('SELECT * FROM page_links WHERE id = ? AND page_id = ? AND deleted_at IS NULL LIMIT 1')
    .bind(linkId, page.id)
    .first<PageLinkRow>()
  if (!row) throw notFound('Page link')
  return row
}

export interface PageAccessListResult {
  rows: PageRow[]
  total: number
}

/**
 * One page of every page the actor may reach, most recently touched first.
 *
 * Scoped by the same predicate as `requirePageAccess`, so a page that appears
 * here always opens, and — more importantly — a page that does not appear here
 * cannot be opened either.
 */
export async function listAccessiblePages(
  db: D1Database,
  actor: ActorInfo,
  pagination: Pagination,
): Promise<PageAccessListResult> {
  const { clause, binds } = pageAccessPredicate(actor)

  const [rowsResult, countResult] = await db.batch([
    db
      .prepare(
        `SELECT pages.*,
                (SELECT page_members.role FROM page_members
                  WHERE page_members.page_id = pages.id AND page_members.user_id = ?
                  LIMIT 1) AS member_role
           FROM pages
          WHERE ${clause} AND pages.deleted_at IS NULL
          ORDER BY pages.updated_at DESC, pages.id DESC
          LIMIT ? OFFSET ?`,
      )
      .bind(actor.id, ...binds, pagination.limit, pagination.offset),
    db
      .prepare(`SELECT count(*) AS total FROM pages WHERE ${clause} AND pages.deleted_at IS NULL`)
      .bind(...binds),
  ])

  return {
    rows: (rowsResult?.results ?? []) as unknown as PageRow[],
    total: asCount((countResult?.results?.[0] ?? null) as { total?: unknown } | null),
  }
}
