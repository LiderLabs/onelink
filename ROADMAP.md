# OneLink — Roadmap

OneLink is a link-in-bio platform: Hono on Cloudflare Workers, D1 for state, R2 for
media, and one SPA served by the same Worker as the API (so the `__Host-` session
cookie needs no CORS, no `SameSite=None` and no custom domain).

This file is the plan of record. It is written to be **executed**, not admired: every
phase names the files it touches, the migration it adds, the tests that must cover it,
and the criteria that say "done". Where something does not exist yet, this file says
so plainly rather than assuming it.

Verified against commit `1e5db86` (`feat(api): owner-facing pages and links API`), with
§1.1, §1.6 and §1.8 refreshed to the tree after R1.3.

## How to read this

| Field | Meaning |
| --- | --- |
| **API** | Backend work in `apps/api` — **the current focus** |
| **UI** | `apps/web` work — deliberately deferred to one pass at the end of Release 1 |
| **Schema** | A new numbered file in `apps/api/migrations/`, plus a `seed/` row when runtime policy is involved |
| **Tests** | Suites in `apps/api/test/` that must cover the change |
| **Exit** | Observable, checkable proof the phase is finished |

Status markers: ✅ done · 🔨 next · ⏳ planned · 🎨 UI (deferred) · 📦 Release 2.

> **UI sequencing is planned separately.** `UI-ROADMAP.md` splits the single R1.8 UI pass
> into user-facing phases that land beside the API phase each one consumes, and leaves the
> staff console out. It supersedes the single-pass reading of **S2** *for user-facing
> screens only*: U0 (the `/app` namespace, i.e. **S3**) and U1 (`/app/profile`) are now
> implemented ahead of R1.3. **S2** still governs the staff console.
> **Owner split:** the UI stream is handed to a second owner working from `UI-ROADMAP.md`
> §0 (what is built, what is left); this file continues the API stream, R1.3 next. The two
> meet at the phases U5–U9, each of which is blocked on one API phase.

**Ground rules → §7.** The three that bite hardest:

1. Every new table goes into `VOLATILE_TABLES` (`apps/api/test/helpers.ts`) or rows
   leak between tests and the failure looks like a bug in the code under test.
2. Rate limits are **seeded, not migrated**, and `rateLimit` **fails open** if the row
   is missing — a new write surface needs a seed row *and* a 429 test.
3. `apps/api/src/lib/errors.ts` codes and `apps/web/src/lib/api.ts` codes change in
   the same commit.

## 1. Verified state of the repository

### 1.1 Routes that exist

| Surface | File | State |
| --- | --- | --- |
| Auth: register, login, logout, session, profile (`PATCH /me`), change-password, forgot/reset | `src/routes/auth.ts` | ✅ |
| Admin users: list, detail, create, invite, sanction, suspend, ban, notes, sessions, revoke, password reset | `src/routes/users.ts` | ✅ |
| Settings, audit log (+ export), health | `src/routes/{settings,audit,health}.ts` | ✅ |
| Public: settings, page read | `src/routes/public.ts` | ✅ |
| Owner pages & links | `src/routes/pages.ts` | ✅ |
| Profile & socials | `src/routes/profile.ts` | ✅ |
| Media / avatars | `src/routes/media.ts` | ✅ |

`pages.ts` exposes exactly 11 routes:

```
GET    /api/v1/pages/mine
GET    /api/v1/pages/:id
POST   /api/v1/pages
PATCH  /api/v1/pages/:id
POST   /api/v1/pages/:id/publish
POST   /api/v1/pages/:id/unpublish
DELETE /api/v1/pages/:id
POST   /api/v1/pages/:id/links
PATCH  /api/v1/pages/:id/links/:linkId
PUT    /api/v1/pages/:id/links/order
DELETE /api/v1/pages/:id/links/:linkId
```

Every mutation composes `writeLimit → requireActiveAccount → requirePasswordSettled →
requireOwnerSelf`, where the last guard refuses mutations from impersonated sessions.
Reads hide foreign pages as `404` via the access seam (`requirePageAccess` in
`services/page-access.service.ts` as of R1.0; it was `requireOwnedPage`).

### 1.2 SPA routes that exist

`/login`, `/register`, `/forgot-password`, `/reset-password`, `/profile`, and `/`
redirecting to `/profile`. **There is no pages dashboard yet** — that is Release 1.

### 1.3 Schema that exists

Migrations are `apps/api/migrations/0001_init.sql` (identity, sessions, moderation,
pages, links, revisions, slug reservations, media, reports/appeals/flags, audit,
settings, email templates, rate limits) and `0002_pages_theme_and_scheduling.sql`
(adds page theme/layout/accent/branding, link `description`, link `starts_at`/
`ends_at`). Both are additive-only and STRICT.

Tables with **no route or service touching them yet**: `reports`,
`appeals`, `content_flags`, `report_actions`, `invitations` (staff-shaped only).
`slug_reservations` is used, but only internally.

### 1.4 Dead columns (verified, not assumed)

| Column | Reality |
| --- | --- |
| `pages.view_count` | Declared in `0001` and in `types.ts`. **Never read or written anywhere.** |
| `page_links.clicks` | Same — declared, never incremented. |
| `pages.content_revision` | ~~Never written. Stays at its default `1` forever.~~ **Resolved in R1.0:** `createPage` stamps `0` (never published), `publishPage` copies the revision it writes to `page_revisions` into the column, and `revisionOfPage()` reads `revision` back off the row. `latestRevision()` is now a cross-check, not the source. |

Two behaviours worth stating exactly, because the plan depends on them:

- **`revision` in the API response is read off the page row (R1.0).** The next
  revision number is still `MAX(page_revisions.revision) + 1`, computed by
  `latestRevision()` in `publishPage` (`src/services/page.service.ts`), but that
  value is copied into `pages.content_revision` as it is published and
  `revisionOfPage(row)` turns it back into `revision` — with `0` reported as
  `null`, so "never published" is distinguishable from "published once". The
  revisions table remains the ledger; the column is a copy of it.
- **Publishing snapshots `{ page, links }`** into `page_revisions.snapshot` as JSON,
  and **unpublishing sets `status = 'draft'` on the same row**. There is no draft
  *copy*: the owner edits the live row directly and republishes. Autosave,
  "unpublished changes", discard and restore have nothing to stand on today.

Deleting a page soft-deletes the page and its links and writes a `slug_reservations`
row (`reason = 'page_deleted'`), so a removed address cannot be inherited.

### 1.5 Identity field caps today

`apps/api/src/validation/user.schema.ts`: `displayName` ≤ **80**, `bio` ≤ **500**.
Constants in `src/lib/constants.ts`: `MAX_SLUG_LENGTH = 48`, `MAX_URL_LENGTH = 2048`,
`MAX_LINKS_PER_PAGE_HARD_CAP = 200`, `DEFAULT_PAGE_SIZE = 25`, `MAX_PAGE_SIZE = 100`.

### 1.6 Seeded policy (`apps/api/seed/0001_platform-defaults.sql`)

17 seeded settings rows (16 of them named in `SETTING_KEYS`,
`src/services/settings.service.ts`), 8 email templates, 8 rate limits. Relevant here:

- Settings: `platform.pages_base_url`, `platform.registration_open`,
  `platform.maintenance_mode`, `content.max_links_per_page` (50),
  `content.reserved_slugs`, `content.reserved_usernames`.
- Rate limits: `pages_write_user` (120/h, block), **`media_upload_user` (60/h,
  throttle — already present)**, `report_create_ip`, `api_global`, `login_*`,
  `register_ip`, `password_reset_ip`.
- **`profile_write_user`** was seeded in R1.1 (60/h, `block`) and is the one budget
  `PATCH /auth/me` and the `/profile/socials` writes share.

### 1.7 Two collisions this plan must fix

1. **Console paths vs. the public slug namespace.** `content.reserved_slugs` is
   `admin, api, app, settings, login, logout, signup, register, dashboard, about, terms,
   privacy, support, help, static, assets, health, favicon.ico, robots.txt,
   sitemap.xml`. It does **not** contain `pages` or `profile`. Once public pages are
   served from the root of the origin, a user can claim slug `pages` and shadow the
   planned console route `/pages`. The settled answer is **S3**: the console lives under
   `/app/*`, so `app` joins this list and no other console path is ever claimable —
   **shipped in R1.0** (in `DEFAULT_RESERVED_SLUGS` *and* the seed; the seed's
   `INSERT OR IGNORE` means an existing deployment needs the one-off `json_insert`
   recorded at that seed row and in R1.0).
2. **Custom domains vs. one origin.** `__Host-onelink_session` requires a Secure,
   domainless origin, and `APP_ORIGIN` is simultaneously the CORS allow-list and the
   base of reset links. A user's own domain therefore serves **public pages only,
   never the console or auth** (Release 2, §5).

### 1.8 Test suites

`apps/api/test/`: `auth.spec.ts`, `pages.api.spec.ts`, `profile.api.spec.ts`,
`socials.api.spec.ts`, `avatar.api.spec.ts`, `media.api.spec.ts`,
`media.maintenance.spec.ts`, `media.validation.spec.ts`, `signup.spec.ts`,
`unit.lib.spec.ts`, `users.admin.spec.ts` — **242 tests across eleven**, run in workerd
against a real local D1 with no mocks.

## 2. Release map

| Release | Contents | Why it is cut here |
| --- | --- | --- |
| **Release 1** | Owner product loop: profile, media, page address, links, draft/publish, public page, sharing — **API first** | One loop a single user can complete. Nothing in it depends on Release 2. |
| **Release 2** | Scheduling polish, analytics, contact collection, email provider, teams, custom domains, moderation engine, admin console, ops | Every item needs Release 1's data (traffic, blocks, page-access seam) to be meaningful. |

Nothing in Release 1 waits on Release 2, and almost everything in Release 2 waits on
Release 1. That one-way dependency is the whole argument for this order.

## 3. Release 1 — the owner product loop (API first)

The build order is **forced**, not stylistic:

- **R1.1 first (done).** Every later screen reads `GET /pages/mine`, which returned raw
  `PageRow` objects (snake_case) — `listAccessiblePages` handed back rows, as
  `listOwnPages` did before R1.0 — while `GET /pages/:id` returned the owner DTO. A
  client built against the leaking list would have been a client rewritten; R1.1 closed
  that before any screen consumed it.
- **R1.2–R1.3 before R1.5.** A link thumbnail is an R2 key; the upload pipeline and key
  namespacing must exist before a `thumbnail_key` column can point anywhere.
- **R1.5 before R1.6.** The publish snapshot is `{ page, links }` today. The draft model
  must serialize the *final* link shape (groups, new-tab, thumbnail) — the reverse order
  forces a snapshot-format migration and invalidates every stored revision.
- **R1.6 before R1.7.** "Publish pushes the draft live" is what makes the public page
  correct; the editor preview is the public renderer with different chrome.
- **R1.8 (UI) last.** One pass over contracts that are frozen by then.

### R1.0 — Seams ✅ shipped

Cheap now, expensive later. Backend only — no frontend or schema change.

- **One access seam.** `requireOwnedPage` / `requireOwnedPageLink` / `listOwnPages`
  are gone from `services/page.service.ts`. `services/page-access.service.ts` now
  owns every "may this actor reach this page?" answer:
  `requirePageAccess(db, actor, pageId, minRole = 'owner')` → `{ page, role }`,
  `requirePageLinkAccess(db, page, linkId)`, `listAccessiblePages(db, actor, pagination)`,
  and the two pieces R2.1 actually replaces — `resolvePageRole(actor, page)` and
  `pageAccessPredicate(actor)` — beside `PAGE_ROLES` / `PAGE_ROLE_RANK`.
  `routes/pages.ts` reaches its page through the seam and no longer decides access
  itself. Behaviour preserving, including the invariant that an unreachable page is
  `404 Page`, never `403` (missing, soft-deleted, foreign and — later — out-ranked
  are one answer).
- **Console namespace (S3).** `app` joins `content.reserved_slugs`, in the code
  (`DEFAULT_RESERVED_SLUGS`, `src/lib/constants.ts`) *and* in the seed. The seed uses
  `INSERT OR IGNORE`, so an existing deployment keeps the list it already has:
  upgrading requires running this once (recorded as a comment beside the seed row).
  ```sql
  UPDATE settings
     SET value = json_insert(value, '$[#]', 'app')
   WHERE key = 'content.reserved_slugs';
  ```
- **`pages.content_revision` is written, not dropped.** `createPage` stamps `0`
  (`NEVER_PUBLISHED`); `publishPage` writes the revision number it is publishing; and
  `revisionOfPage(row)` reads `revision` off the row, so no reader aggregates
  `page_revisions` any more. Unpublishing deliberately leaves the column alone — the
  page still has a last-published revision, it is simply not live — which is also why
  the API keeps reporting it. `latestRevision()` stays, exported, as the ledger
  cross-check.
- **`assertSlugAvailable` exported** (it was private) so R1.4's slug rename applies
  the one policy implementation instead of copying it.
- **Exit (met).** `npm run typecheck` clean; `npm test` green — **133 tests, was
  127**, six new cases (four unit, two API). New coverage: four unit tests pinning the
  reserved list (`app` present, entries normalised and duplicate-free, fallback to the
  shipped list when the setting is missing/malformed/empty, stored list used once
  usable); an API test that a page cannot claim `app`, which is what proves the *seeded*
  row; an API test that `pages.content_revision` is `0` until the first publish, then
  mirrors the live revision and agrees with `latestRevision()`; and the unpublish test
  now also pins that a page taken down keeps its revision. The 404-not-403 rule was
  already covered by `answers 404 — not 403 — for another user's page`.

### R1.1 — Owner pages API fixes ✅ *(the approved A1–A8)*

Implemented. `GET /pages/mine` maps rows through `toApiPage`, so the list returns owner
DTOs with real `meta` (`page`/`limit`/`total`/`totalPages`); `PATCH /auth/me` writes
self-service `displayName`/`bio`/`username` behind `profile_write_user` (R1.3 later
extended the same handler with `avatarKey`/`expectedAvatarKey`). `requireOwnerSelf` moved
into `middleware/auth.ts`. Covered by `pages.api.spec.ts` and `profile.api.spec.ts`.

| | |
| --- | --- |
| **API** | `GET /api/v1/pages/mine` maps each row through `toApiPage`, so the raw `PageRow[]` (with `user_id`, `deleted_at`, `content_revision` and every snake_case column) no longer leaks. List `meta` (`page`/`limit`/`total`/`totalPages`) is already produced by `list()` — add the assertion that locks it in. New `PATCH /api/v1/auth/me` for self-service `displayName`/`bio`/`username`. |
| **Schema** | none |
| **Seed** | add `profile_write_user` (60/h, `block`). `pages_write_user` and `media_upload_user` already exist. |
| **Guards** | Move the duplicated `requireOwnerSelf` out of `routes/pages.ts` into `middleware/auth.ts` and compose it on `PATCH /auth/me`, so "an admin acting as a user cannot write as them" holds on the new surface too. Chain order stays `requireActiveAccount → requirePasswordSettled → requireUnimpersonated → rateLimit → readJson`. |
| **Validation** | A profile schema shaped to accept the future `location`/`pronouns`/`socials` keys, so R1.2 is additive rather than a re-cut. |
| **Tests** | `pages.api.spec.ts`: `/mine` returns DTO keys only (no `user_id`, no `deleted_at`), correct `meta` across two pages. New `profile.api.spec.ts`: happy path, 422 bad input, **429 after the seeded limit**, 403 when impersonated, 401 unauthenticated. |
| **Exit** | `/mine` returns owner DTOs with `meta`; a signed-in `user` can change their own display name, bio and username; every new write surface has a 429 test. |
| **UI** 🎨 | `requestList` helper in `apps/web/src/lib/api.ts`, the pages dashboard and the profile form. |

### R1.2 — Profile & identity API ✅

Implemented. `migrations/0003_profile_fields.sql` adds `users.location`/`users.pronouns`
and the `user_social_links` table; `src/routes/profile.ts` (mounted at `/api/v1/profile`)
serves socials CRUD, reorder and visibility behind the shared `profile_write_user` budget,
and `toApiUser` carries `location`/`pronouns`. Covered by `profile.api.spec.ts` and
`socials.api.spec.ts`.

| | |
| --- | --- |
| **Schema** | `0003_profile_fields.sql`: `users.location TEXT`, `users.pronouns TEXT`; new `user_social_links (id, user_id, platform, url, position, is_visible, created_at, updated_at)` with `UNIQUE(user_id, position)` and `user_id` ON DELETE RESTRICT. Add `user_social_links` to `VOLATILE_TABLES` **before** `users` (child rows first, or the reset batch aborts). |
| **API** | `toApiUser` gains `location`/`pronouns`. Socials as their own resource (**D9**): `GET`/`POST /api/v1/profile/socials`, `PATCH`/`DELETE /api/v1/profile/socials/:id`, plus an order route mirroring `PUT /pages/:id/links/order`. |
| **Policy** | Platform enum in `lib/constants.ts` (same pattern as `DEFAULT_RESERVED_SLUGS`), validated in zod **and** re-checked in the service — 0003 adds these columns with `ALTER TABLE`, and SQLite cannot CHECK what a later migration adds. |
| **Caps** | The spec's `displayName` ≤ 50 and `bio` ≤ 160 are now enforced on write. **D12** — enforce on write, never truncate a stored value (lenient read, strict write). |
| **Tests** | `profile.api.spec.ts`: socials CRUD, reorder, visibility toggle, `422` unknown platform, `404` (never 403) for a social row belonging to someone else. |
| **Exit** | The identity a public page renders — name, bio, location, pronouns, socials — is fully writable by its owner and by nobody else. |
| **UI** 🎨 | Profile fields, socials editor, live preview. |

### R1.3 — Media API (avatars and generic page-image uploads complete)

Profile photos are implemented: owned uploads and public serving, conditional
attachment, recoverable retirement/removal, and bounded daily cleanup. The API
accepts only validated 512-square WebP avatars up to 240 KiB. The browser accepts
JPEG/PNG/static WebP and supplies crop/resize without new runtime dependencies.
Other media kinds and link thumbnails remain future work.

| | |
| --- | --- |
| **Schema** | no migration. Existing `media_assets` and `media_upload_user` (60/h, throttle) are used. |
| **API** | Managed avatars: `POST /api/v1/media/avatar?kind=avatar`, owned `GET /media/avatar`, public `GET /media/files/avatars/:ownerId/:filename`, and owned `DELETE /media/avatar/:id`. Attach using `PATCH /auth/me { avatarKey, expectedAvatarKey }`. Existing generic `POST /media?kind=avatar|page_image`, `DELETE /media/:id`, and legacy public URLs remain available. Thumbnail UI remains planned. |
| **Rules** | Owner-namespaced immutable keys; server validates WebP container, dimensions, and bytes. Atomically mark retired and clear a matching profile pointer, then delete R2 before deleting the row. Retired rows are recoverable; maintenance rechecks unattached candidates. |
| **Tests** | `media.api.spec.ts`: reject oversized and unknown types, ownership enforcement, key namespacing (two users, same filename, distinct keys), `429` on the seeded throttle, delete clears object and row. |
| **Exit** | An avatar uploads, attaches, serves and deletes; `PUBLIC_BUCKET` has stopped being an unused binding. |
| **UI** 🎨 | In-browser crop and resize (**D4**). The API stops at "store exactly the bytes you were given". |

### R1.4 — Page address API ⏳

| | |
| --- | --- |
| **Schema** | none — `pages.slug` and `slug_reservations` already exist. |
| **API** | `GET /api/v1/pages/slug-available?slug=` → `{ slug, available, reason }`, reusing the `assertSlugAvailable` exported in R1.0 (normalise first, then check reserved → taken → reservation). `PATCH /api/v1/pages/:id` gains `slug`, which `UpdatePageInput` deliberately lacks today ("Slugs are claimed at creation and IMMUTABLE in this slice", `page.service.ts`). |
| **Rename policy** | On success: normalise, re-check availability, write `pages.slug`, audit `page.slug_change` with before/after, and reserve the **old** slug only under the anti-squat policy (**D10**). Reserving unconditionally would also lock the owner out of renaming back, which is not the intent. |
| **Route ordering** | `GET /slug-available` must be registered **before** `GET /:id`, or Hono matches it as an id — the same trap already handled for `PUT /:id/links/order`. Add a regression test. |
| **Tests** | Availability matrix (free / taken / reserved / held by a released reservation), rename happy path, `409` for each refusal, `404` for a foreign page, an audit row per rename, and (per D10) the owner can reclaim the address they released. |
| **Exit** | An owner can check an address before committing to it, and rename a page without losing revision history or admin audit. |
| **UI** 🎨 | Address field with live availability and a change confirmation step. |

### R1.5 — Links v2 API ⏳

| | |
| --- | --- |
| **Schema** | `0004_link_groups_and_thumbnails.sql`: new `link_groups (id, page_id, name, position, created_at, updated_at)`; and on `page_links`: `group_id TEXT REFERENCES link_groups(id)`, `open_in_new_tab INTEGER NOT NULL DEFAULT 0`, `thumbnail_key TEXT`. Insert `link_groups` into `VOLATILE_TABLES` **immediately after** `page_links` — children are deleted first, and `page_links.group_id` points at `link_groups`. |
| **API** | Link create/update gain `openInNewTab`, `groupId`, `thumbnailKey`. Group CRUD: `GET`/`POST /pages/:id/groups`, `PATCH`/`DELETE /pages/:id/groups/:groupId`, `PUT /pages/:id/groups/order`. Bulk: `POST /pages/:id/links/bulk { ids, action: hide \| show \| delete \| move, groupId? }` — one request, one rate-limit hit, one audit entry per affected link. Trash: `GET /pages/:id/links?trashed=1` and `POST /pages/:id/links/:linkId/restore`. Metadata: `POST /pages/:id/links/metadata { url }`. |
| **Scheduling** | `starts_at`/`ends_at` already flow through create/update and are enforced by the service, so the API for windows is nearly done. Add a **derived** `status` (`scheduled \| active \| expired`) to `toPageLinkDto` so no client re-implements the comparison, and settle the "coming soon" placeholder (**D13**). |
| **SSRF** | `…/links/metadata` is the only place this API fetches a user-supplied URL. Allow `http`/`https` only; refuse loopback, private, link-local and metadata targets (`127.0.0.0/8`, `10/8`, `172.16/12`, `192.168/16`, `169.254.0.0/16`, `::1`, `fc00::/7`); cap redirects; cap body bytes; hard timeout; **never proxy the response bytes** back to the browser. This is security-critical and deserves its own test file. |
| **Retention** | New setting `content.trash_retention_days` (default 30). The daily cron purges links whose `deleted_at` is older than the window. `page_links.deleted_at` exists and is written on delete — nothing reads it today, so a deleted link is currently invisible and permanent. |
| **Tests** | `links.api.spec.ts`: new columns round-trip; group CRUD and FK behaviour; bulk is all-or-nothing in one `db.batch()`; trash → restore → purge; the SSRF refusal matrix; derived status at the exact millisecond boundary; `429` on `pages_write_user` for bulk. |
| **Exit** | The whole link surface the spec describes exists behind the API, `deleted_at` is finally read, and the outbound fetch refuses every private target in the matrix. |
| **UI** 🎨 | Groups, drag-reorder, bulk selection, trash view, thumbnail picker, time-window editor. |

### R1.6 — Draft, autosave & version history API ⏳

| | |
| --- | --- |
| **Schema** | `0005_page_drafts.sql`: `page_drafts (id, page_id UNIQUE REFERENCES pages(id), content TEXT NOT NULL, updated_by, created_at, updated_at)`. **D5** chooses a separate row over draft columns on `pages`, so published content cannot be mutated by autosave *by construction* rather than by discipline. The snapshot envelope becomes `{ v: 1, page, links, groups }`; existing snapshots have no `v` and must be read tolerantly. |
| **API** | `PUT /pages/:id/draft` (autosave, with an `updatedAt` guard so two tabs cannot silently clobber each other); `GET /pages/:id/draft`; `POST /pages/:id/draft/discard`; `GET /pages/:id/revisions` (metadata only, newest 10); `GET /pages/:id/revisions/:revision`; `POST /pages/:id/revisions/:revision/restore` — which writes the **draft**, never the live row, so restoring is always a previewable step. |
| **Publish** | `POST /pages/:id/publish` changes from "snapshot the live row" (`page.service.ts`) to "apply the draft to the live row in one `db.batch()`, snapshot the result, bump the revision". `unpublishedChanges` becomes a real field on the owner DTO: true when a draft exists that is newer than the last publish. |
| **Rate limits** | Autosave cannot share `pages_write_user` (120/h) — a five-second flush exhausts it in ten minutes and then blocks the owner from publishing. Seed `page_autosave_user` as **`throttle`, never `block`**: a degraded autosave must not lock someone out of their own editor. |
| **Pruning** | Keep the newest 10 `page_revisions` rows per page, pruned in the same batch as the insert. `idx_revisions_page` already supports the lookup. |
| **Tests** | `drafts.api.spec.ts`: autosave never touches `pages`; publish applies the draft; `unpublishedChanges` flips both ways; discard; restore writes a draft and leaves live content untouched; the stale-write guard; prune keeps exactly 10; `429` on the autosave rule; a snapshot stored before `v` existed still reads. |
| **Exit** | An owner can save continuously, see that unpublished changes exist, publish, revert, and restore any of the last ten versions — and a published page does **not** change until publish is called. |
| **UI** 🎨 | Autosave indicator, unpublished-changes banner, version list, restore confirmation. |

### R1.7 — Public page & sharing API ⏳

| | |
| --- | --- |
| **Schema** | none. The block model that contact collection will need is Release 2, and the draft envelope's `v` field is the seam that lets it be added without invalidating stored revisions. |
| **API** | `GET /api/v1/public/pages/:slug` extends `toPublicPage` with the owner's identity — `avatarUrl`, `bio`, `location`, `pronouns`, visible socials. Today it emits only `owner: { username, displayName }`. It must stay cache-friendly and must not leak `status`, `moderationStatus`, `revision`, `viewCount` or `clicks`; `pages.api.spec.ts` already asserts those are absent — **extend that assertion, do not replace it**. |
| **Preview** | `GET /api/v1/pages/:id/preview` renders the draft through the same mapper the public route uses, so preview and production cannot drift: one function, two callers. |
| **Sharing** | Everything the sharing sheet needs is derivable client-side from `platform.pages_base_url` + slug. So: (a) guarantee `pages_base_url` is reachable on the public settings endpoint, (b) add `GET /api/v1/public/pages/:slug/qr` **only if** a server-rendered PNG is chosen (**D14** — otherwise QR generation is pure client work), and (c) settle OG/SEO delivery (**D1**). |
| **Caching** | Public reads are anonymous and hot. Do not add a view beacon here yet (that is Release 2), but keep the read pure so it stays cacheable and a `POST /public/pages/:slug/events` can be added later without touching the render path. |
| **Tests** | `public.api.spec.ts` (new): unpublished → `404`; moderation-removed → `404`; the payload carries identity and never internal fields; preview equals the public payload for identical content; a draft that has not been published does not change the public payload. |
| **Exit** | A published page serves the exact shape the editor previews, to anonymous callers, with nothing internal in it. |
| **UI** 🎨 | Public route and renderer, live preview, copy link, share intents, QR download (PNG + SVG), native share. |

## 4. Closing Release 1

### R1.8 — UI pass 🎨 *(deliberately last)*

One pass over the contracts frozen by R1.1–R1.7, in this order: pages dashboard and
editor shell → profile editor → media picker and crop → address field → link groups,
bulk and trash → autosave and version history → public renderer → preview → sharing and
QR. The API changes during this pass only to fix a bug; feature pressure goes into
Release 2, never into R1.8.

**Status (2026-10-06).** The user-facing half of that pass has begun and is now sequenced
by `UI-ROADMAP.md`, which lands each screen beside the API phase it consumes instead of
waiting for the last one. Landed so far: **U0** (the `/app` namespace move — the **S3**
router change described below) and **U1** (`/app/profile`: identity, social links,
security, account record, against R1.1/R1.2). That leaves R1.8 as the staff console
(spec §8–§9) plus whatever `UI-ROADMAP.md` has not yet sequenced; it is no longer one
monolithic pass over the whole SPA.

The UI stream is now **handed to a second owner**. `UI-ROADMAP.md` §0 is that stream's
built-versus-to-build dashboard and its phase detail stays in §7; this file keeps the API
plan and picks up with **R1.3**.

The console namespace move (**S3**) is applied to the SPA router **before** the first new
console screen, not after: `AppShell` and `Guards` need a nested `/app` layout first.

### R1.9 — Release 1 hardening ⏳

- **Docs:** ~~fix `README.md`~~ **Done** — it now reports 242 tests / 11 files, lists the
  `/pages` and `/profile` routes, and points at this file. Keep it current as screens land.
- **End to end:** one scripted pass against `wrangler dev` — signup → profile → avatar →
  address → links → autosave → publish → public page → share.
- **Negative paths:** `409` reserved/taken slug, `422` bad input, `429` on every new
  limit, `403` impersonated writes, `404` foreign resources, `503` maintenance mode.
- **Migration rehearsal:** apply `0003`–`0005` to a fresh local D1 *and* to one that
  already holds rows, then run `npm run db:seed:local` twice. `INSERT OR IGNORE` protects
  settings, but the new tables have no seed row to ignore — idempotency must be proven,
  not assumed.
- **Release 1 is done when:** `npm run typecheck` is clean, `npm test` is green including
  every new suite, and the loop above completes by hand in the browser.

## 5. Release 2 — after the loop exists 📦

| # | Item | Why it cannot come earlier |
| --- | --- | --- |
| R2.1 | **Teams & collaboration** — `page_members`, per-page roles, invites | Needs R1.0's `requirePageAccess(db, actor, pageId, minRole)` seam, by rewriting `resolvePageRole` / `pageAccessPredicate` in `page-access.service.ts`. Without it, every owner route is rewritten instead of one function. |
| R2.2 | **Custom domains** — `domains`, DNS verification, TLS | A user domain must serve **public pages only**, never auth or the console (`__Host-` cookies cannot be scoped to it). `pages_base_url` becomes per-page instead of global. |
| R2.3 | **Analytics** — view/click events, `POST /public/pages/:slug/events`, dashboards | Needs R1.7's pure public read as the anchor, and finally gives `view_count` and `page_links.clicks` writers. |
| R2.4 | **Contact collection** — form blocks, submissions, spam control | Needs the draft envelope's `v` field from R1.6, or adding a block type invalidates every stored revision. |
| R2.5 | **Email** — provider wiring, template rendering, delivery log | `email.service.ts` is a stub and the 8 seeded templates have no renderer. Independent of Release 1, and nothing in Release 1 waits on it. |
| R2.6 | **Moderation engine** — auto-flag rules, report queue, appeals flow | The tables exist; the rules and the queue do not. Only meaningful once there is traffic to moderate. |
| R2.7 | **Admin console (SPA)** — settings editor, user tools, audit viewer | The APIs exist and are tested; only the screens are missing. Kept out of Release 1 on purpose: Release 1 is the *owner* loop. |
| R2.8 | **Ops** — backups, retention jobs, observability, alerting | Needs a stable shape to monitor. |

**Explicitly not planned:** billing, multi-tenant organisations, per-page custom CSS/JS
(a stored-XSS foot-gun on a single origin, and the reason `showBranding` exists instead),
and server-side rendering of public pages (the SPA renders them; OG/SEO is **D1**).

## 6. Migration & seed plan

| File | Phase | Contents | Notes |
| --- | --- | --- | --- |
| `apps/api/migrations/0003_profile_fields.sql` | R1.2 | `users.location`, `users.pronouns`, new `user_social_links` | Additive. `ALTER TABLE ADD COLUMN` cannot add a CHECK, so platform validation lives in zod **and** the service. |
| `apps/api/migrations/0004_link_groups_and_thumbnails.sql` | R1.5 | new `link_groups`; `page_links.group_id`, `.open_in_new_tab`, `.thumbnail_key` | Additive. Backfill `open_in_new_tab` to `0` by default is the only sane reading of existing rows. |
| `apps/api/migrations/0005_page_drafts.sql` | R1.6 | new `page_drafts` (`page_id` UNIQUE) | Additive. Snapshot envelope gains `v: 1`; old snapshots stay readable. |

Seed rows — appended to `apps/api/seed/0001_platform-defaults.sql`, because
`db:seed:local` / `db:seed:remote` name that one file (`apps/api/package.json`). A second
seed file means changing both scripts, so append unless that change is intended.

| Key | Phase | Value |
| --- | --- | --- |
| `profile_write_user` | R1.1 | `user`, 60/h, `block` |
| `content.trash_retention_days` | R1.5 | `number`, 30 |
| `page_autosave_user` | R1.6 | `user`, 1200/h, `throttle` |

**Conventions inherited from `0001`/`0002`** (follow them, do not invent): STRICT tables;
epoch-ms `INTEGER` timestamps; `TEXT` ULID ids; closed enums as `TEXT` + `CHECK`;
ownership FKs `ON DELETE RESTRICT`; soft delete via `deleted_at`; denormalised
actor labels on audit rows so history survives an account deletion; additive-only
migrations with the reasoning written into the file header.

## 7. Engineering standards every phase must honour

1. **Envelope.** Success is `{ data, meta: { requestId, … } }`; errors are
   `{ error: { code, message, details? }, meta: { requestId } }`. Never hand-roll a
   response — use `ok` / `list` / `noContent` and `lib/errors.ts`.
2. **Auth chain.** Owner routes compose, in this order:
   `rateLimit → requireActiveAccount → requirePasswordSettled → requireUnimpersonated →
   readJson`. The limit sits first so a flood is rejected before any work happens — that
   is the order `routes/pages.ts` already uses. Admin routes use `requireCapability`
   instead, which is where the impersonation check normally lives.
3. **404, never 403, for a foreign resource.** Existence must not be probeable.
4. **Rate limits are seeded, not migrated, and fail *open*.** A new write surface needs
   a seed row *and* a test that trips it.
5. **Audit.** One entry per mutation, and its `INSERT` goes in the **same**
   `db.batch()` as the change — the `user.service.ts` contract.
6. **Validate at the edge, sanitise in the service.** zod at the route
   (`validation/*.schema.ts`), then `sanitizeSingleLine` / `sanitizeMultiline` /
   `normalizeUrl` / `normalizeSlug` (`lib/http.ts`) in the service. Never rely on a CHECK
   constraint added by a later migration.
7. **Clock.** All timestamps come from `lib/clock.ts` (`now()`), never `Date.now()`
   scattered around, so tests stay deterministic.
8. **DTOs only from `services/mappers.ts`.** A route must never return a raw row — that
   is exactly how `GET /pages/mine` leaks column names today.
9. **Tests are the specification.** workerd + a real local D1, no mocks. New tables go
   into `VOLATILE_TABLES`; every rate-limited route gets a 429 test; every owned
   resource gets a foreign-access 404 test.
10. **Dependencies.** The API has exactly two (`hono`, `zod`). Adding one — an image
    library, a QR library, an HTML parser for metadata — is a decision (**D4**, **D14**),
    not an implementation detail.
11. **Secrets.** Only in the root `.dev.vars` (gitignored) or as Worker secrets. Never in
    `wrangler.jsonc`, never in a migration, never in a test fixture.

## 8. Decision log

IDs are stable labels carried over from the spec review, so they are **not** sequential
here — a decision keeps the name it was discussed under.

### Settled (recorded so it stops being re-litigated)

| ID | Decision |
| --- | --- |
| **S1** | **Release boundary.** Release 1 = the owner product loop (former milestones M2–M7, merged). Release 2 = M8–M16. |
| **S2** | **API first.** No UI is written until R1.1–R1.7 land; a single UI pass (R1.8) then consumes frozen contracts. For **user-facing** screens this is superseded by `UI-ROADMAP.md`, which lands each screen beside its API phase (U0/U1 are in). Still standing for the staff console. |
| **S3** | **Console namespace** (**D3**). The console lives under `/app/*`. That resolves §1.7 without shrinking the public namespace: only `app` needs adding to `content.reserved_slugs`, and the SPA router owns everything under it. |

### Open — close each before the phase it blocks

| ID | Question | Blocks | Sensible default |
| --- | --- | --- | --- |
| **D1** | OG/SEO for public pages: accept SPA-only (no crawler metadata), or add an edge HTML rewrite that injects tags for page requests | R1.7 | SPA-only at first. It degrades link previews, not correctness, which is why it must not hold up R1.1. |
| **D4** | Image handling: crop/resize in the browser (a dependency in `apps/web`) or in the Worker (a library or binding, plus CPU time) | R1.3 | Browser-side. The API stores exactly what it is given and enforces the caps. |
| **D5** | Draft storage: a separate `page_drafts` row, or draft columns on `pages` | R1.6 | Separate row — autosave then cannot touch published content *by construction*. |
| **D9** | Socials: a `user_social_links` table, or one JSON column on `users` | R1.2 | Table: orderable, individually addressable, and 0003 need not touch `users` beyond two `ADD COLUMN`s. |
| **D10** | Rename policy: reserve the old slug forever, or release it back to its owner | R1.4 | Reserve forever (consistent with the delete policy) — but that also stops the owner renaming *back*, so decide deliberately. |
| **D12** | Identity caps: the spec's `displayName` 50 / `bio` 160, or today's 80 / 500 | R1.1, R1.2 | Spec values on **write**, stored values never truncated (lenient read, strict write) so no existing row is broken. |
| **D13** | Scheduled links: is a not-yet-started link absent from the public page, or shown as a "coming soon" placeholder? | R1.5, R1.8 | The API returns the derived `status` either way, so this can close in R1.8 with no schema change. |
| **D14** | QR images: generated in the client, or a server-rendered PNG endpoint | R1.7 | Client-side: no dependency in the Worker and no new endpoint to cache or abuse. |

**Settle D5, D9, D10 and D12 before R1.1 is coded**, even though they land later: R1.1
writes the profile schema and the access seam, and both are shaped by those answers.

## 9. Verification

Everything runs from the repository root:

```bash
npm run typecheck       # regenerates worker-configuration.d.ts, then tsc in both workspaces
npm test                # vitest in workerd, against a local D1
npm run db:migrate:local
npm run db:seed:local
npm run db:seed:owner   # prints the owner credentials
npm run dev             # wrangler dev (API) on :8787
npm run dev:web         # second terminal: Vite on :5173 — use THIS origin
```

Use `http://localhost:5173`, not the Worker's own port: Vite proxies `/api` to
`wrangler dev` so development travels the same-origin, credentialed path production
uses, which is the only way the `__Host-` cookie behaves at all.

### Definition of done for every phase

1. `npm run typecheck` is clean.
2. `npm test` is green, including the suite the phase names.
3. Every new table is in `VOLATILE_TABLES`.
4. New seed rows apply, and re-applying them changes nothing.
5. Every new route is covered: happy path, `422` bad input, `404` for a foreign
   resource, `429` if rate-limited, `403` if a mutation can be attempted while
   impersonating.
6. The migration's rollback story is stated in the change description, not discovered
   during an incident.

### Traceability — spec feature → phase

| Feature | Phase | What exists today |
| --- | --- | --- |
| Profile: name, bio | R1.1 | implemented: `PATCH /auth/me` |
| Profile: location, pronouns | R1.2 | implemented: `users.location`/`users.pronouns` (0003) |
| Social links | R1.2 | implemented: `user_social_links` + `/profile/socials` |
| Avatar upload / crop | R1.3 | implemented: owned API, browser crop, replace/remove |
| Page address + rename | R1.4 | slug immutable by design |
| Link groups | R1.5 | no table |
| Open in new tab | R1.5 | no column |
| Link thumbnail | R1.3, R1.5 | no column |
| Bulk link actions | R1.5 | one route per link |
| Link trash / restore | R1.5 | `deleted_at` written, never read |
| Link scheduling | R1.5 | columns + validation already live |
| Link metadata autofetch | R1.5 | nothing |
| Autosave | R1.6 | nothing |
| Unpublished changes | R1.6 | nothing (unpublish is a status flip) |
| Version history / restore | R1.6 | `page_revisions` written on publish; no read, no restore |
| Public page | R1.7 | exists, identity-poor |
| Preview | R1.7 | nothing |
| Sharing / copy link | R1.7, R1.8 | `platform.pages_base_url` |
| QR code | R1.7 (**D14**) | nothing |
| Analytics | Release 2 | `view_count` / `clicks` have no writers |
| Contact forms | Release 2 | no schema |
| Teams | Release 2 | needs the R1.0 access seam |
| Custom domains | Release 2 | conflicts with `__Host-` single origin |
| Admin console | Release 2 | APIs exist and are tested; screens do not |

### Working agreement

- One phase per change set, tests in the same commit as the code they cover.
- The API's contracts for Release 1 are frozen once R1.7 lands; UI work opens them only
  for bugs.
- A decision that starts blocking gets raised the moment it blocks, with the default
  chosen in §8 named explicitly — not discovered three phases later.
