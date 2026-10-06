# OneLink — User-facing UI roadmap

Date: 2026-10-06
Status: **U0 + U1 built and committed**; U2–U10 not started. §0 is the built-versus-to-build
dashboard — read that first.
Owner: the UI stream is handed to a second owner working from this file. The API stream
continues in `ROADMAP.md` (**R1.3** next).
Baseline for the UI: `c23eeb1`. U0 + U1 landed as `feat(web): console namespace (U0) and
profile screen (U1)`, the first UI commit after it. `apps/api/test` was green before and
after — **171 tests, 7 files** — because no API file was touched.
Companion documents: `ROADMAP.md` (API plan of record) ·
`docs/superpowers/specs/2026-10-06-existing-api-ui-design.md` (screen requirements)

## 0. Built versus to build — the handover dashboard

*Added 2026-10-06, when the UI stream was handed to a second owner while the API stream
continued in `ROADMAP.md`. §0.1 and §0.2 are the summary; §4 and §7 keep the detail, and
every phase in §7 also carries its own status marker. If you are picking this up, read
§0.1–§0.4, then §3 (the rules), then §7's entry for the phase you are taking.*

### 0.1 Built — U0 + U1 ✅

One change set, committed as `feat(web): console namespace (U0) and profile screen (U1)`,
the first UI commit after the API baseline `c23eeb1`. **No file in `apps/api` changed in
it**, which is why the API suites were 171/7 both before and after.

| Phase | What is in the repository | Consumes |
| --- | --- | --- |
| **U0** console shell and namespace | the `/app` nested layout and its rail, `/app/profile`, a `/app/*` console 404 that cannot fall through to a slug, `/profile` → `/app/profile`, `/` → `/app`, `/:slug` + `/p/:slug` public skeleton, and every shared primitive listed below | — |
| **U1** profile identity and socials | `/app/profile`: identity, social links, security, account record — the spec §5 screen, with the previous account page kept whole inside it | R1.1 `PATCH /auth/me` · R1.2 `/profile/socials` |

The files that commit added or changed, so nobody has to diff to find them:

```text
apps/web/src/
  main.tsx                     (changed) createBrowserRouter + RouterProvider
  App.tsx                      (changed) RouteObject[] — AppShell branch + PublicLayout branch
  components/
    ConsoleLayout.tsx          the console shell inside /app (rail + content)
    ConsoleNav.tsx             the rail itself
    ConfirmDialog.tsx          native <dialog>: focus trap, Escape, inert, focus returned
    EmptyState.tsx
    ErrorNotice.tsx            manual retry only — never auto-retries a mutation
    Field.tsx                  (changed) Field · TextareaField · SelectField · CheckboxField
    Button.tsx                 (changed) + the danger variant
    Guards.tsx                 (changed) safeNext validates a local path
    AppShell.tsx               (changed)
  lib/
    use-resource.ts            stale-response-safe fetch, nothing set after unmount
    dirty-form.ts              useDirtyForm + useUnsavedChanges (useBlocker + beforeunload)
    api.ts                     (changed) exported request, validationIssues/fieldErrorsFrom, updateProfile
    session.tsx                (changed) updateProfile merges the PATCH answer over the session user
    types.ts                   (changed) location/pronouns, SocialPlatform, SocialLink, UpdateProfile*
  features/
    profile/                   ProfileScreen · IdentityForm · SocialsEditor · SocialRow ·
                               AccountRecord · ChangePasswordForm · api.ts · social-platforms.ts
    public/                    PublicLayout · PublicPageRoute (skeleton — the renderer is U4)
  routes/
    console-not-found.tsx      /app/* 404 that cannot fall through to a slug
    profile.tsx                (changed) re-export shim → features/profile
    login.tsx, not-found.tsx   (changed)
  styles.css                   (changed) dialog + ::backdrop
```

**What is proven, and what is not.**

| Check | Result |
| --- | --- |
| `npm run typecheck` (worker types + both workspaces) | clean |
| `npm --workspace apps/web run build` (`tsc --noEmit && vite build`) | clean |
| `npm test` — the API suites, i.e. the UI's contract evidence | **171 passing / 7 files**, unchanged |
| Browser pass at desktop width and ~375 px against local Wrangler/D1 | **not done** (§9 item 3) |
| Six-session-state matrix on the profile screen | **not done** (§9 item 4) |

U0 and U1 are therefore ✅ on code paths and types, **not** on a click-through: the
environment that wrote them had no browser and no running Worker/D1. Nothing is known to be
broken; nothing is *proven* either. The last two rows of that table are the first work a
new UI owner should do — they are cheap, and they are what would promote U0/U1 from ✅ to
*verified*.

### 0.2 To build — in order

**Profile live preview is implemented.** The existing `/app/profile` editor now
previews unsaved identity, photo crops, social-link edits/additions, visibility,
and order. Save remains explicit; cancel/undo restores saved values. This is the
client-side profile preview. Local **Profile** and **Socials** tabs separate
photo/details, security, and session information from social links and preview;
switching tabs preserves drafts. U9's server-driven page preview, sharing, and QR
tools below remain separate work.

| Phase | Produces | Needs | Can start |
| --- | --- | --- | --- |
| **U2** ⏳ | `/app/pages`, `/app/pages/new`, plus the `requestList`/`Pagination` and `UnavailableResource` primitives | R1.1 ✅ exists | **today — this is next** |
| **U3** ⏳ | `/app/pages/:id`: appearance, links, publication, plus `SaveStateNotice` and `PageRenderer` | R1.1 ✅ exists | today |
| **U4** ⏳ | the real `/:slug` renderer (not the skeleton) | the public read endpoint, which exists | today — identity only arrives in **U9** |
| **U5** ✅ | avatar picker, browser crop/resize, upload, replace/remove | R1.3 avatar API exists | avatar flow implemented; page images pending |
| **U6** 🚧 | the address field, live availability check, and the rename confirmation | **R1.4 — not built** | after R1.4 |
| **U7** 🚧 | link groups, `openInNewTab`, bulk, trash and restore, thumbnails, time windows | **R1.5 — not built** | after R1.5 |
| **U8** 🚧 | autosave, the unpublished-changes state, the version list | **R1.6 — not built** | after R1.6 |
| **U9** 🚧 | the server-driven preview, sharing, copy link, QR | **R1.7 — not built** | after R1.7 |
| **U10** ⏳ | the session, error, accessibility and dirty-form sweeps | U0–U9 | last |

The practical shape of the handover: **U2 → U3 → U4 are the three phases that need nothing
from the API stream.** Every phase after them is blocked on exactly one API phase
(R1.3–R1.7), which `ROADMAP.md` is taking in that order. If both streams run at once, the
API stream should front-load **R1.3**, because it is the first one that unblocks a UI
phase — and the UI owner should not start U5–U9 against a route that does not exist
(ground rule 3).

Not in this file at all: the staff console, settings, audit, teams and Release 2. §8 says
where each of those went and why.

### 0.3 What a new owner must not break

§3 is the full list; these are the five that fail loudly if ignored.

1. **`lib/types.ts` mirrors the server mappers by hand, on purpose.** A change to
   `apps/api/src/services/mappers.ts` and the matching type land in the same commit.
2. **No production dependency without a decision.** `apps/web` still has exactly three
   (`react`, `react-dom`, `react-router-dom`) and no test runner. An icon set, a date
   picker, a crop library, a QR library or a query library is a decision (**UD6**, **D4**,
   **D14**), not a convenience.
3. **Nothing is fabricated.** A screen renders what its DTO carries and never fills a gap
   by calling a protected endpoint. That rule is what makes U4 honest and U9 necessary.
4. **Five states per screen** — loading, empty, rejected request, `429` with the server's
   `retry-after`, and session gone. A screen that only renders the happy path is unfinished.
5. **Dirty input is never lost, and a save rebases on the server.** A successful save resets
   the dirty baseline to the server-normalized values, not to what was typed.

Still in force from `ROADMAP.md`: one phase per change set, and the docs a phase makes
untrue are corrected in the same change set — which is why README, ROADMAP and this file
moved with U0 + U1.

### 0.4 Settled, so it is not re-opened

| Already decided | Where |
| --- | --- |
| The data router (`createBrowserRouter`), so `useBlocker` exists for in-app dirty-form blocking | **UD2**, §4.3 |
| One `PageRenderer` renders both the editor preview and the public page | **UD3** |
| The "saves are live" wording lives only in `SaveStateNotice`, so U8 substitutes rather than rewrites the editor | **UD4** |
| Share and copy-link URLs are built from the current origin + slug, with `/p/:slug` as the fixed-root-route fallback | **UD5** |
| Client-side QR generation (**D14**), and in-browser crop/resize for media (**D4**) | §10, U5, U9 |
| `requestList`/`Pagination`, `SaveStateNotice` and `UnavailableResource` were deliberately *not* built in U0/U1, because nothing consumed them yet | §4.2 |
| The server is authoritative on values the client could recompute — the derived link `status`, the slug-availability `reason`, and `capabilities` are displayed, never re-derived | §3 rule 4, U6, U7 |

**Left open, and owned by whoever writes the phase:** **UD6** — whether `apps/web` gets a
test runner (today `tsc` + `vite build` + a browser pass is the whole verification story),
which §9 argues should be decided on merit rather than by reflex. Then the API-side
decisions that shape a UI phase: **D10** (rename policy → U6), **D13** (absent versus
"coming soon" for a scheduled link → U7), and **D1**/**D14** (OG/SEO, QR delivery → U9),
all recorded in `ROADMAP.md` §8. **D4** is answered, so U5 has no open question of its own.

## 1. What this file is

`ROADMAP.md` plans the API and defers **all** of `apps/web` to a single pass (**R1.8**)
at the end of Release 1. The committed UI spec then widened that pass to include staff
screens, settings and audit. The owner has since asked for the **user-facing product
first and admin/team screens last**.

This file is the plan of record for the user-facing half of that pass. It keeps the
spec's requirements and the ROADMAP's house style, but replaces "one UI pass at the
end" with **eleven phases that each land beside the API phase they consume**: a screen
ships when the endpoint behind it is honest, not when the last endpoint is frozen.

Requirements do not move. The committed spec stays the source of truth for *what* each
screen must do. This file only answers *in what order*, *against which contract*, and
*what proves it done* — and it says plainly which phases can start today and which are
waiting on R1.3–R1.7.

**What this roadmap deliberately excludes:** the staff console (`/app/admin/*`, spec
§8–§9), teams (**R2.1**), analytics (**R2.3**), contact collection (**R2.4**) and custom
domains (**R2.2**). §8 records where each went and why.

## 2. How to read this

| Field | Meaning |
| --- | --- |
| **Depends on** | The API phase the phase consumes. `—` means the API committed today is enough. |
| **Screens** | Routes the phase introduces or completes. |
| **Builds** | Shared primitives the phase creates for later phases, so no phase invents its own. |
| **Exit** | Observable, checkable proof the phase is finished. |

Status markers: ✅ done · 🔨 next · ⏳ planned · 🚧 blocked on an API phase. Phase
statuses track the marker set in `ROADMAP.md`; a phase marked ⏳ here may still be
*unblocked* (its APIs exist) — the dependency map in §5 says which.

**§0 is the dashboard** — what is built, what is next, what is blocked, and what is
settled. It was added for the handover, and it is the section to read first.

## 3. Ground rules

These are the UI mirror of ROADMAP §7. The first three are the ones that bite.

1. **Wire types are hand-written mirrors.** `apps/web/src/lib/types.ts` copies the
   server's projections on purpose (a shared package would let a server refactor
   silently change what the browser believes it received). A change to
   `apps/api/src/services/mappers.ts` and the matching type land **in the same
   commit** — the same rule `ROADMAP.md` applies to error codes.
2. **No production dependency without a decision.** `apps/web` has exactly three
   runtime dependencies today (`react`, `react-dom`, `react-router-dom`) and no test
   runner. A date picker, an image-crop library, a QR library or a query library is a
   decision (**D4**, **D14**, **UD2**, **UD6**), not an implementation detail. This
   pass uses React state and effects; the spec forbids adding a production
   component/state/query library (§10).
3. **A public render is fed only by the public DTO.** Nothing on `/:slug` may be
   fabricated, and no screen may satisfy a public render by calling a protected
   endpoint (spec §7). If a field is absent, it is absent — that is what makes U9 a
   real phase rather than a cosmetic one.
4. **Capabilities are advisory; the server is authoritative.** The client never treats
   its own capability list or `role` as the decider, and never disables an action the
   API permits (spec §10). A refusal is explained, not pre-empted.
5. **Every screen handles five states**: loading, empty, rejected request, rate limit
   (`429` with `retry-after`), and an expired session (`401` → login with a validated
   local `next` path). A screen that only renders the happy path is unfinished.
6. **Same origin only.** Browse `http://localhost:5173`: Vite proxies `/api` to
   `wrangler dev` on `:8787`. The `__Host-onelink_session` cookie does not exist on
   `:8787`, so testing there proves nothing about production.
7. **Dirty input is never lost.** In-app navigation goes through a shared
   unsaved-changes confirmation, and a before-unload warning covers tab close. A
   successful save resets the baseline to the **server-normalized** values; a
   background refresh never overwrites dirty input (spec §10).

## 4. Verified state of `apps/web`

Read from the files, not from the spec's assumptions. Revised after **U0 + U1** landed as
one change set (the console namespace, and the profile screen that consumes R1.1/R1.2).

### 4.1 What exists

| Surface | Reality |
| --- | --- |
| Router | `createBrowserRouter` over a `RouteObject[]` (`App.tsx`), rendered by `main.tsx`, with two top-level branches: `AppShell` (chrome + guards) and `PublicLayout` (no chrome, no session). `useBlocker` is therefore available. |
| Console routes | `/app` (index → `/app/profile`) · `/app/profile` · `/app/*` → console 404 that cannot fall through to a slug |
| Auth routes | `/login`, `/register`, `/forgot-password`, `/reset-password` |
| Compatibility | `/` → `/app` · `/profile` → `/app/profile`, kept for existing bookmarks |
| Public routes | `/:slug` and `/p/:slug` → `PublicPageRoute`: a layout skeleton with no session and no console chrome that fabricates nothing (the renderer is U4) |
| Guards | `RequireAnonymous`, `RequireAuth` (`components/Guards.tsx`) with `safeNext` validating a local `next` path. `/app` requires a session only — what a session may DO is decided per screen, because the API's answers differ per action. |
| Shell | `AppShell` owns the masthead, the maintenance banner, the suspension notice, skip-to-content and the footer. `ConsoleLayout` adds the rail (`ConsoleNav`) inside `/app`. |
| Primitives | `Button` (solid/outline/**danger**) · `Field`, `TextareaField`, `SelectField`, `CheckboxField` sharing one label/hint/error shell · `Notice` · `ConfirmDialog` (native `<dialog>`: focus trap, Escape, inert background, focus return) · `EmptyState` · `ErrorNotice` (manual retry) · `AuthFrame` · `Splash`/`UnavailableScreen` · `SuspendedNotice` |
| Client | `lib/api.ts`: typed `request<T>` (now exported for feature clients), `ApiError` with `code`/`details`/`retryAfterSeconds`, `errorMessageFor`, `validationIssues`/`fieldErrorsFrom` (a 422's `details.issues` mapped onto fields), 20 s timeout, `credentials: 'include'`. It still **unwraps `data` and discards `meta`** — `requestList`/`Pagination` are U2, whose list is their first consumer. |
| Session | `lib/session.tsx`: bootstrap, `user`, `capabilities`, `platformName`, `settings`, `logout`, `changePassword`, and `updateProfile`, which adopts the PATCH response by merging it OVER the session user so `sessionId`/`sessionExpiresAt`/`impersonatedBy` stay truthful. |
| Hooks | `lib/use-resource.ts` (stale responses discarded, nothing set after unmount, manual `reload`) · `lib/dirty-form.ts` (`useDirtyForm` + `useUnsavedChanges` over `useBlocker` and `beforeunload`) |
| Features | `features/profile/` — screen, identity form, socials editor + row, account record, password form, API client, platform list · `features/public/` — layout + slug skeleton |
| Types | `lib/types.ts` mirrors the server mappers: auth, `/public/settings`, plus (from U1) `location`/`pronouns`, `SocialPlatform`, `SocialLink`, `UpdateProfileInput/Response`, and the social create/update bodies. `displayName` is now `string`, matching `toApiUser`'s username fallback. |
| Styling | Tailwind v4 through `@tailwindcss/vite`, tokens `paper`/`ink`/`ink-soft`/`ink-faint`/`rule`/`danger`, Fraunces + Archivo + JetBrains Mono, `.plate` `.eyebrow` `.reveal` `.sweep`, and `dialog::backdrop`. |
| Build | `npm --workspace apps/web run build` = `tsc --noEmit && vite build`. **Still no test script and no test dependencies**, and no production dependency was added: `apps/web` still has exactly three. |

### 4.2 What U0 + U1 changed, and what they deliberately left out

`/profile` was the **account** page — an account record and the change-password form.
`/app/profile` is now the *identity* screen the spec describes (§5): identity, social
links, security and the account record, with the password half kept exactly as it was and
the old URL still resolving. It was an additive restructure, not a new screen.

Not built, because nothing consumes them yet — building them now would be dead code that
pins wording before the surface that needs it exists:

| Deferred | To | Why |
| --- | --- | --- |
| `requestList` + `Pagination` (spec §10's `meta` path) | **U2** | Its first caller is `/app/pages`, and the API's `meta` is the only pagination authority there. |
| `SaveStateNotice` | **U3/U8** | Its copy is about live *page* saves and is inverted by R1.6 (**UD4**); the wording should be written once, against the surface that shows it. |
| `UnavailableResource` | **U2/U3** | It explains a `404`/`403` for an id-addressed resource. No screen addresses one by id yet. |

### 4.3 The router decision, taken

**UD2 resolved to the data router, in U0, as planned.** `useBlocker` exists only there,
and in-app unsaved-changes blocking is a product requirement (spec §10), so
`<BrowserRouter>` + `<Routes>` was replaced before any other route existed. The migration
cost this change set exactly the two files that mount the router (`App.tsx`, `main.tsx`).

One consequence is worth recording because it is not obvious from either file alone:
signing out (or the 8-hour ceiling) while a form is dirty would otherwise leave a blocked
navigation hanging, since the route guard's redirect is itself a navigation. `IdentityForm`
releases the blocker when the session disappears, so that resolves to the login screen
instead of to a dialog about a form that can no longer be saved.

## 5. Dependency map

| UI phase | Screens | Depends on | Ready? |
| --- | --- | --- | --- |
| **U0** Console shell & namespace | `/app/*` layout, `/profile` redirect, public layout skeleton | — | **done** ✅ |
| **U1** Profile identity & socials | `/app/profile` | R1.1 ✅, R1.2 ✅ | **done** ✅ |
| **U2** My pages & create | `/app/pages`, `/app/pages/new` | R1.1 ✅ | yes — API exists |
| **U3** Page editor: appearance, links, publish | `/app/pages/:id` | R1.1 ✅ | yes — API exists |
| **U4** Public renderer | `/:slug`, `/p/:slug` | the public read endpoint, which exists today but is identity-poor | yes — completed by U9 |
| **U5** Media picker & crop | avatar on `/app/profile` | R1.3 avatar API | implemented |
| **U6** Address field & rename | address section in `/app/pages/:id` | **R1.4** ⏳ | no — blocked on R1.4 |
| **U7** Links v2 in the editor | groups, bulk, trash, thumbnails, windows | **R1.5** ⏳ | no — blocked on R1.5 |
| **U8** Autosave, unpublished changes, versions | editor save state, version list | **R1.6** ⏳ | no — blocked on R1.6 |
| **U9** Preview parity & sharing | preview, copy link, share, QR | **R1.7** ⏳ | no — blocked on R1.7 |
| **U10** Cross-cutting sweep & hardening | every user-facing route | U0–U9 | after U0–U9 |

**The honest split.** U0–U4 consume API the repository already has, so they are
buildable in this order without waiting for anything. U5–U9 each sit behind exactly
one API phase, which is why the ROADMAP's ordering (**R1.6 before the editor's save
semantics**, **R1.7 before an honest preview**) is preserved rather than fought.

Two consequences worth stating before any code is written:

- **U3 ships "saves are live" copy because that is true today** (`publishPage` snapshots
  the live row rather than applying a draft; editing a published row changes public
  output immediately).
  R1.6 makes that copy wrong, so U8 must invert it. That inversion is confined to one
  component, `SaveStateNotice` (**UD4**), so U8 swaps an implementation instead of
  rewriting a screen.
- **U3's preview and U4's public page share one renderer**, `PageRenderer` (**UD3**).
  U9 then points the preview at `GET /pages/:id/preview` — one function, two callers,
## 6. Order

Two sequences are compatible with everything above. Neither requires rework, because
the two places where a later phase changes an earlier phase's behaviour are already
budgeted as **UD3** and **UD4**.

| | Sequence A — screens soonest | Sequence B — R1.3 first (as instructed) |
| --- | --- | --- |
| Order | U0 → U1 → U2 → U3 → U4 → **R1.3** → U5 → R1.4 → U6 → R1.5 → U7 → R1.6 → U8 → R1.7 → U9 → U10 | **R1.3** → U0 → U1 → U2 → U3 → U4 → U5 → R1.4 → U6 → R1.5 → U7 → R1.6 → U8 → R1.7 → U9 → U10 |
| First screen in a browser | after U1 | after U1, one API phase later |
| Cost | none beyond UD3/UD4 | none; U5 starts already unblocked |
| Risk | U3's copy is rewritten by U8 (bounded, see UD4) | the visible product arrives later than the API for it |

**Default: B**, because it is the order that was asked for, and because U0 — the `/app`
namespace move — is the one UI change worth landing on its own rather than beside an
API change set. Switch to A only if seeing the product in a browser before R1.3 lands
matters more than keeping one stream on the API.

**What actually happened (2026-10-06).** The owner asked for the R1.1/R1.2 screens before
R1.3, so **U0 + U1 landed in one change set ahead of R1.3** — Sequence A's opening, not B's.
Nothing downstream changes: U2–U4 are still unblocked, U5 is still the first phase that
wants R1.3, and UD3/UD4 are still the only places a later phase revises an earlier one.
R1.3 remains the next API phase.

After U10, and not before: the staff console (**R2.7** screens, spec §8–§9), then teams
(**R2.1**). Both are outside this roadmap (§8).

The ROADMAP's working agreement carries over unchanged: **one phase per change set,
tests in the same commit as the code they cover**, and a blocking decision raised the
moment it blocks.

## 7. Phases

### U0 — Console shell and namespace ✅

| | |
| --- | --- |
| **Status** | ✅ **Built** in the `feat(web): console namespace (U0) and profile screen (U1)` commit. Verified by `tsc` and `vite build`, not by a browser (§9 items 3–4). |
| **Depends on** | — (no API change) |
| **Screens** | `/app` nested layout · `/app/profile` · `/profile` → `/app/profile` redirect · `/` → `/app` · `/:slug` public-layout skeleton · `/p/:slug` |
| **Builds** | The shared primitives: `useResource` (ignores stale responses, unsubscribes on unmount) · `ConfirmDialog` (native `<dialog>`: focus trap, Escape, return focus, pending) · `Field` textarea/select/checkbox · `useDirtyForm` + `useUnsavedChanges` (blocker) · `EmptyState` · `ErrorNotice` with retry · feature folders `src/features/{profile,public}`. **Deferred, with reason: `requestList`/`Pagination` to U2 and `SaveStateNotice` to U3 (§4.2).** |
| **Exit** | Met: `tsc` and the web build are clean · `/app/profile` renders the account screen's content behind the nested guard · signed-out `/app/*` lands on `/login` with a validated local `next` path · an unmatched `/app/...` path renders a console 404 and cannot fall through to a slug · `/profile` still resolves · `/:slug` renders a public layout with no console chrome and no session requirement. **Outstanding: the browser pass at desktop and ~375 px (§9 item 3).** |

This is the ROADMAP's **S3** namespace move. It is public-facing-safe because `app` was
already added to `content.reserved_slugs` in R1.0, so no page can claim `/app`. The
router decision (**UD2**) is made here and not later: migrating `<Routes>` to a data
router means touching every route, so doing it after U2 is strictly worse.

### U1 — Profile identity and socials ✅

| | |
| --- | --- |
| **Status** | ✅ **Built** in the same commit — the identity/security/account-record screen, with the old `/profile` account page kept intact behind the redirect. Verified by `tsc` and `vite build`, not by a browser (§9 items 3–4). |
| **Depends on** | R1.1 (`PATCH /auth/me`) ✅ · R1.2 (`location`, `pronouns`, `/profile/socials`) ✅ |
| **Screens** | `/app/profile` — identity, social links, security, account record (spec §5) |
| **Builds** | `features/profile/` — identity form, socials editor with keyboard/touch Move up/down (no drag-and-drop this pass), shared `409/422/429` form messaging |
| **Exit** | Implemented as specified: identity and social changes save, normalize, adopt the server's values and survive reload; a reorder submits **every live social id including hidden rows**. **Outstanding: the browser pass against local Wrangler/D1 (§9 item 3), and the six-session-state matrix (§9 item 4) — the read gate for socials is implemented, not yet exercised with a suspended/impersonated fixture.** |

Field rules as the API enforces them today (`apps/api/src/lib/constants.ts`):
`displayName` 50 · `bio` 160 · `location` 100 · `pronouns` 40 · `username` 32 with the
backend character rules · socials capped at 20 with `SOCIAL_PLATFORMS` verbatim from the
API. Submit **changed fields only**; clearing optional text sends `null`; a value stored
longer than today's cap reads back without truncation (**D12**: lenient read, strict
write).

Session states are part of the screen, not an afterthought: a forced-rotation session
reaches security here and nothing else; suspended and pending accounts read their
explanation and get no write controls; an impersonated session may read identity and
socials and must present a prominent read-only notice. `PATCH /auth/me` and the social
writes share one seeded `profile_write_user` budget (60/h), so the `429` copy uses the
server's `retry-after` and never presents the rule as a global quota (spec §2).

### U2 — My pages and page creation ⏳ *(unblocked today)*

| | |
| --- | --- |
| **Depends on** | R1.1 — `GET /pages/mine` now returns owner DTOs with real `meta` ✅ |
| **Screens** | `/app/pages` (paginated list) · `/app/pages/new` |
| **Builds** | `features/pages/` — list + create form, `Pagination` wired to `?page=`, confirmed delete |
| **Exit** | Spec §12.3 with a passing list: create completes through the real API, the list paginates from the API's `meta` (`page`/`limit`/`total`/`totalPages`), and every failure state has a route out |

The listing shows title, slug, publication status, moderation state and last update.
Page and filter state lives in the URL. Loading, empty ("no pages yet" with a create
action) and failure-with-retry are all required — the API's `meta` is the only
pagination authority, so `requestList` from U0 is what makes this possible at all.

Creation sends the fields the API accepts: `title` (120), `bio` (500), optional `slug`
(≤48), `theme`, `layout`, six-digit hex `accentColor`, `showBranding`. A `409` keeps
the typed input, explains the collision, and offers a different address; the server's
username fallback is explained rather than guessed at. The created resource opens its
own editor, where the slug is displayed read-only (until **U6**).

Deleting a page is a soft delete that also writes a slug reservation, which means the
address does not become available again. The confirmation says that, because it is the
consequence a person would not predict. Foreign, deleted and missing page ids all
render the same unavailable UI — the API answers `404` for each and the UI must not
invent a distinction it cannot see.

### U3 — Page editor: appearance, links, publication ⏳ *(unblocked today)*

| | |
| --- | --- |
| **Depends on** | R1.1 ✅ (page, link CRUD, ordering, publish/unpublish/delete) |
| **Screens** | `/app/pages/:id` |
| **Builds** | `PageRenderer` — the single renderer shared with U4 (**UD3**); `SaveStateNotice` — the single place save semantics are worded (**UD4**) |
| **Exit** | Spec §12.3 (edit/link CRUD/publish/unpublish/delete through the real API), §12.4 (published-page editing warns about immediate public changes), §12.5 (scheduling round-trips local times, handles empty bounds, refuses an end before the complete start) |

Two panels, as the spec requires. **Appearance/content:** `title` (120), page `bio`
(500), light/dark theme, list/grid layout, optional six-digit hex accent, branding —
changed fields only. **Links:** `title` (140), HTTP(S) `url` (2048), `description`
(280), optional icon text (80, described as text because the API has no icon catalog),
visibility, `startsAt`, `endsAt`; create, edit, delete and full-list reorder that sends
**every live id, hidden rows included**.

Scheduling displays local date/time and sends epoch milliseconds; an empty bound sends
`null`; an unchanged stored timestamp is preserved rather than re-derived; and the
window is validated against the stored value as well as the typed text, so an end
before a complete start is refused before the request.

Publication actions are disabled while the form is dirty, and the reason is stated:
they operate on **saved** content. `POST /publish` / `POST /unpublish` / `DELETE` refetch
server state afterwards rather than assuming an outcome. A moderation-removed page
cannot publish. Last published revision and timestamp are displayed without a
history/restore action — that is U8, and inventing one here would be a lie.

**The one sentence that is true today and false after R1.6:** saving content or links on
a *published* page changes the live page immediately. U3 states it plainly wherever a
save can reach a published page (**UD4**), and U8 replaces the wording when drafts exist.

### U4 — Public renderer ⏳ *(unblocked today; completed by U9)*

| | |
| --- | --- |
| **Depends on** | today's `GET /public/pages/:slug` — it exists and returns the real page, minus owner identity |
| **Screens** | `/:slug` (published page) · `/p/:slug` (fallback for a slug colliding with a fixed root route) |
| **Builds** | Nothing new: it consumes `PageRenderer` from U3, which is the point |
| **Exit** | Spec §12.6: public light/dark and list/grid pages render safely; draft/removed/under-review or unusable-owner pages show unavailable; a network failure offers retry |

The public route has its own layout, no console navigation, no account data and no
session bootstrap requirement. It reads the **actual DTO** — title, bio, theme, layout,
accent, branding, owner username/displayName, and the links as returned — and renders
text through React, accepting only HTTP(S) destinations and never injecting stored
HTML. The response's links are the public authority: visibility and schedule filtering
already happened server-side. Accent colour is treated as decoration and must not break
contrast.

Identity fields (avatar, bio, location, pronouns, socials) are **absent from this DTO
today**. U4 renders what is there and does not fetch them through protected endpoints
to look complete (ground rule 3). U9 adds them when R1.7 puts them in the payload.

### U5 — Media picker and crop ✅ *(avatars implemented)*

The profile photo flow includes local crop/zoom/reset, bounded WebP encoding,
progress, confirmed removal, concurrent-edit detection, ambiguous-response
reconciliation, cleanup retries, and initials fallback. Native dialog controls
support keyboard and pointer/touch input. No crop library was added. Link
thumbnail reuse remains U7 work.

| | |
| --- | --- |
| **Depends on** | R1.3 — `POST /media`, `DELETE /media/:id`, and R1.1's `PATCH /auth/me { avatarKey }` |
| **Screens** | the avatar section of `/app/profile`; the link thumbnail picker reuses it in U7 |
| **Builds** | `features/media/` — picker, in-browser crop/resize to a small square WebP, upload progress, replace and remove |
| **Exit** | An avatar uploads, attaches, renders, is replaced without orphaning the old object, and deletes; a rejected type or size explains itself; `PUBLIC_BUCKET` stops being an unused binding |

Crop and resize happen **in the browser** (**D4** default: the API stores exactly the
bytes it is given and enforces the cap). The client therefore has an obligation the
API cannot take over: it must not send a 12 MP phone photo. Resize to a bounded square,
encode WebP, then upload — the server's dimension and byte caps are the enforcement, the
client's limits are a courtesy.

Two honesty rules apply here. The client never claims a `Content-Type` the bytes do not
have, because the API sniffs magic bytes and will refuse the mismatch. And `429` on the
seeded `media_upload_user` rule (60/h, **throttle**, not `block`) is a normal soft
refusal — the copy uses the server's `retry-after` and does not present the rule as a
global quota or a broken feature.

### U6 — Address field and rename 🚧 *(blocked on R1.4)*

| | |
| --- | --- |
| **Depends on** | R1.4 — `GET /pages/slug-available?slug=`, `PATCH /pages/:id { slug }` |
| **Screens** | the address section of `/app/pages/:id`; the create form's slug field gains live checking |
| **Builds** | `slug-available` debounced check shared by both screens |
| **Exit** | An owner can check an address before committing to it and rename a page knowing what happens to the old address; every displayed public URL reflects the change, including the `/p/` fallback decision |

The API's `reason` (free / taken / reserved / held by a released reservation) is
rendered **as the reason** — the client does not re-derive it from a boolean, because
"taken by someone else" and "reserved by policy" deserve different sentences. A rename
is confirmed in a step that names both the old and the new address and states the two
things the owner cannot see: revision history survives, and an audit row is written.

**D10** is the reason this phase has a sentence about the *old* address: whether it is
released back or reserved is the API's decision, so the UI reports the outcome the API
gives it rather than promising "you can rename back". After a successful rename every
copy-link, preview and QR surface re-renders against the new slug, and the `/p/:slug`
fallback is re-evaluated: renaming into a fixed root route name must explain the fallback
rather than hand back a URL that 404s.

### U7 — Links v2 in the editor 🚧 *(blocked on R1.5)*

| | |
| --- | --- |
| **Depends on** | R1.5 — link `openInNewTab`/`groupId`/`thumbnailKey`, group CRUD, bulk, trash/restore, metadata, derived `status` |
| **Screens** | the link panel of `/app/pages/:id`; a trash view inside the same screen |
| **Exit** | Groups, bulk actions, trash and restore, the thumbnail picker, the time-window editor and metadata autofetch all work through the API; a trash purge has a visible deadline |

Group CRUD and assignment, the `openInNewTab` toggle, and a thumbnail picker that
reuses U5's flow. **Bulk is one request**: `POST /links/bulk` is a single rate-limit hit
that writes one audit entry per affected link, so selecting twenty rows sends one
request and never a loop of twenty — the UI must be written for the endpoint, not around
it. Trash is `?trashed=1` with restore, and the view names the purge window
(`content.trash_retention_days`, default 30) so "restore" has a deadline instead of
looking permanent.

Two things the UI must **not** compute. The derived `status` (`scheduled`/`active`/
`expired`) is displayed verbatim: the millisecond boundary is the API's answer, and a
client-side copy of that comparison is a bug waiting for a timezone. **D13** — whether a
not-yet-started link is absent or shown as "coming soon" — is settled by rendering what
the API returns rather than inventing a placeholder. Metadata autofetch is an explicit
button that shows the fetched title/description and lets the owner apply or ignore it;
it never writes and never auto-saves.

### U8 — Autosave, unpublished changes, version history 🚧 *(blocked on R1.6)*

| | |
| --- | --- |
| **Depends on** | R1.6 — `PUT`/`GET /pages/:id/draft`, discard, `GET /pages/:id/revisions[/:revision]`, restore, and a real `unpublishedChanges` field |
| **Screens** | the save state and version list of `/app/pages/:id` |
| **Exit** | An owner can save continuously, see that unpublished changes exist, publish, discard, and restore any of the last ten versions — **and a published page does not change until publish is called** |

This is the phase that makes "editing a published page is safe" true. Autosave flushes
on a debounce and on blur/navigation; the indicator distinguishes saving, saved, offline
and **stale write** (the `updatedAt` guard exists so two tabs cannot silently clobber
each other, and the UI must say which tab won rather than reporting success). The
unpublished-changes banner appears exactly when the API says `unpublishedChanges` — not
when the client thinks something looks different.

Restore writes a **draft**. The flow is therefore restore → preview → publish, and the
screen must say the live page has not changed yet; a restore that looked like an
immediate public change would be the single most damaging lie in this product. Discard
is confirmed, because it is unrecoverable. The version list is metadata-only (newest
ten) with a detail view per entry.

**What U8 reverses, and where.** It replaces U3's wording through `SaveStateNotice`
(**UD4**) — the "saves update the live page immediately" warning stops being true and is
removed, not softened — and it replaces U3's publish button behaviour with "apply the
draft, then snapshot". Because both changes are behind one component and one API call,
U8 is a substitution rather than a rewrite of the editor screen.

Autosave rides `page_autosave_user` (**throttle**, never `block`) precisely so a
degraded autosave cannot lock an owner out of their own editor. The UI must reflect
that: a soft `429` on a save is reported as "still trying" with the server's
`retry-after`, and it never disables publishing.

### U9 — Preview parity and sharing 🚧 *(blocked on R1.7)*

| | |
| --- | --- |
| **Depends on** | R1.7 — `GET /pages/:id/preview`, identity extended into `toPublicPage`, `pages_base_url` guaranteed on public settings |
| **Screens** | preview in `/app/pages/:id`; the sharing sheet; the public page gains identity |
| **Exit** | The preview and the public page render from the same mapper and cannot drift; the public payload carries the owner's identity and leaks nothing internal; copy link and QR produce reachable URLs |

The preview stops being a local render of entered values and becomes the **server's
preview DTO** — the same function the public route uses (**UD3**). One consequence is
worth stating because it changes what the screen may claim: from here on the preview is
authoritative, and before here it was not.

The public renderer gains what R1.7 adds — avatar, bio, location, pronouns and visible
socials — and nothing else: `status`, `moderationStatus`, `revision`, `viewCount` and
`clicks` stay out of the payload and therefore out of the UI. The API's existing
"these keys are absent" assertion is extended rather than replaced, and the UI simply
must not display what is not sent.

Sharing is derived, not fetched: the copy-link and share URLs come from the **current
origin** plus the slug (spec §6), never from the seeded `https://onelink.local/`, with
`/p/:slug` as the fallback for a fixed-root-route collision. Share intents use the same
URL, native share is used only where the browser offers it, and QR codes are generated
client-side (**D14** default) as PNG **and** SVG with size and margin options. There is
no analytics beacon, no SEO rewrite (**D1**) and no server-side PNG endpoint.

### U10 — Cross-cutting sweep and hardening ⏳

| | |
| --- | --- |
| **Depends on** | U0–U9 |
| **Screens** | every user-facing route (`/app/*`, public `/:slug`, auth) |
| **Exit** | The matrices below pass in a browser against local Wrangler/D1 at desktop and ~375 px, and the docs name the screens that actually exist |

This is not a polish pass for looks; it is the pass that proves the product handles
people who are not the happy path.

- **Session matrix:** anonymous · ordinary user · forced-password · suspended/pending ·
  impersonated · maintenance mode. For each: what is visible, what is refused, and
  whether the refusal is the API's or the UI's. The rule from ground rule 4 is checked
  here in both directions — the UI must not disable what the API permits, and must not
  offer what the API will refuse.
- **Error matrix:** `401` (clear identity, return to login with a validated local `next`)
  · `403` (explain, never treat client capabilities as authority) · `404` (unavailable,
  with a way back to the listing) · `409`/`422` (preserve input, show field errors) ·
  `429` (server's interval, input retained) · `503` maintenance (content stays readable,
  the write refusal is explained) · network/500 (retryable, no false success, and a
  committed mutation is never replayed automatically).
- **Accessibility and device:** keyboard reachability, visible focus, labelled controls,
  dialogs that trap and return focus, reorder controls usable by keyboard and touch,
  reduced-motion respected, and tables that scroll in their own region or collapse to
  labelled records without overflowing the page.
- **Dirty forms:** every form blocks in-app navigation and warns on tab close; a
  successful save resets the baseline to server-normalized data.
- **Legacy URLs:** `/profile` bookmarks and generated password-reset links still resolve.
- **Docs:** already corrected once, in U0 + U1's commit (README's screen list, its stale
  "94 API tests" claim, the ROADMAP's UI markers, and this file's §0). The sweep re-checks
  them rather than assuming they stayed true.

## 8. What is not in this roadmap

Kept out on purpose, with the reason and where each went. None of these is cancelled.

| Item | Where it went | Why it is not here |
| --- | --- | --- |
| Staff console screens — `/app/admin/users`, `/new`, `/:id`, `/app/admin/settings`, `/app/admin/audit`, `/audit/:id` (spec §8–§9) | after U10, then **R2.7** | The APIs exist and are tested; only screens are missing. Sequencing them first would put the owner loop behind five capability and rank matrices that do not affect an ordinary account. |
| Teams and per-page roles (**R2.1**) | Release 2 | Needs the R1.0 page-access seam rewritten (`resolvePageRole` / `pageAccessPredicate`), and there is no `page_members` table yet. |
| Analytics dashboards (**R2.3**), contact collection (**R2.4**), custom domains (**R2.2**), email delivery (**R2.5**), moderation engine (**R2.6**) | Release 2 | No endpoint exists for any of them. A screen for a feature with no route can only be a mock, and mocks are how a product starts lying. |
| Impersonation **start**, audit **export**, staff **invitations** | not planned | Named in documentation, implemented nowhere in the checked code (spec §2). A capability name is not a route. |
| QR via a server-rendered PNG (**D14**), OG/SEO edge rewrite (**D1**), per-page custom CSS/JS | deliberately excluded | Client-side QR by default; SEO degrades link previews rather than correctness; custom CSS/JS is a stored-XSS foot-gun on a single origin and is explicitly not planned (ROADMAP §5). |

The committed spec's §8–§9 remain valid requirements. When the staff console is
scheduled, this file grows a `U11+` section rather than a second roadmap — one plan, two
audiences, both honest about what exists.

## 9. Verification

Run from the repository root, exactly as the ROADMAP does:

```bash
npm run typecheck                 # regenerates worker-configuration.d.ts, then tsc in both workspaces
npm test                          # API suites in workerd against a local D1
npm --workspace apps/web run build # tsc --noEmit && vite build
npm run db:migrate:local
npm run db:seed:local
npm run db:seed:owner             # prints the owner credentials
npm run dev                       # wrangler dev (API) on :8787
npm run dev:web                   # second terminal: Vite on :5173 — browse THIS origin
```

`http://localhost:8787` is not a usable console: the `__Host-` cookie only behaves on
the single proxied origin, which is the whole reason `vite.config.ts` proxies `/api`.

**Contract evidence.** The API suites are the contract evidence for every UI phase —
`apps/api/test/` was green at `c23eeb1` (**171 tests, 7 files**) and green again after
U0 + U1, unchanged, because no API file was touched. The UI consumes those contracts; it
does not re-test them. Credentials and development reset tokens must never appear in
captured artifacts.

**UI tests (UD6).** `apps/web` has no test runner today. If one is added it is planned
before installation, and it earns its place by covering what is pure and worth pinning:
error mapping (`errorMessageFor`, including a missing `retry-after` staying `null`
rather than becoming zero), `requestList`'s handling of `meta`, the reorder payload
(every id, hidden rows included), local-time ↔ epoch conversion with null bounds, and
the availability-check debounce. Snapshot tests that merely restate markup are not
worth the dependency.

### Definition of done for every UI phase

1. `npm run typecheck` is clean.
2. `npm --workspace apps/web run build` succeeds.
3. The phase's screens were exercised in a browser against local Wrangler/D1 with
   fixture accounts, at desktop width and at ~375 px.
4. Loading, empty, failure, `429` (with the server's `retry-after`) and expired-session
   states each render something a person can act on.
5. No screen displays data its DTO does not contain, and no public render is completed
   with a protected request.
6. The docs this phase makes untrue are fixed in the same change set — README's screen
   list when a route appears, the ROADMAP's UI markers when a phase lands.

**Where U0 + U1 stand against that list.** Items 1, 2, 5 and 6 pass in this change set
(`tsc --noEmit` clean, `vite build` clean, no screen renders data its DTO lacks, and §4,
§5, §6, §7, §10 and the README were corrected in the same change set).

Items 3 and 4 have **not** been done: the environment this was written in has no browser
and no running Worker/D1, so neither the desktop/375 px click-through nor the six-state
session matrix (anonymous · ordinary · forced rotation · suspended/pending · impersonated ·
maintenance) has been exercised. U0 and U1 are marked ✅ on the strength of their code
paths — verified against the mappers, routes and guards on the server, and type-checked —
not on a click-through. That pass is the first thing to do on a machine running
`npm run dev` + `npm run dev:web`, and it is what would promote them from ✅ to *verified*.

## 10. UI decision log

IDs are `UD*` to keep them distinct from the ROADMAP's `S*`/`D*`. Inherited and already
settled by the ROADMAP — **S2** (API first), **S3** (`/app` namespace, applied in U0),
**D4** (browser-side image work), **D10** (old-slug policy), **D12** (lenient read,
strict write), **D13** (derived link status), **D14** (client-side QR), **D1** (SPA-only
SEO) — are used above and not re-litigated here.

| ID | Question | Blocks | Default |
| --- | --- | --- | --- |
| **UD1** | Sequence A (screens soonest) or B (R1.3 first, as instructed) | the next commit | **Answered — A's opening.** The owner asked for the R1.1/R1.2 screens before R1.3, so U0 + U1 landed first. R1.3 is still the next API phase, and U5 is still the first UI phase that needs it, so the choice stays cheap either way. |
| **UD2** | Adopt React Router's data router (`createBrowserRouter`) in U0, or keep `<Routes>` and ship `beforeunload` only | U0 | **Decided and executed in U0**: the data router. In-app unsaved-changes blocking needs `useBlocker`, which exists only there, and the alternative is a real product regression (typed input silently lost) rather than a style preference. Execution note in §4.3. |
| **UD3** | One renderer for preview and public, or two | U3, U4, U9 | **One**, `PageRenderer`. U3 previews locally, U4 renders publicly from the same component, U9 swaps the preview's *input* to the server's preview DTO so drift is impossible — the same "one function, two callers" rule R1.7 states for the API. |
| **UD4** | Where save semantics are worded | U3, U8 | **In `SaveStateNotice` only.** U3's "saves update the live page immediately" is true today and false after R1.6; keeping the wording in one component makes U8 a substitution rather than an editor rewrite. |
| **UD5** | What a shared/copyable URL is built from | U3, U6, U9 | **The current origin + slug** (spec §6), with `/p/:slug` for a fixed-root-route collision. Never the seeded `https://onelink.local/`, which is unreachable. QR stays client-side (**D14**). |
| **UD6** | Add a UI test runner, or rely on browser passes | U10 | **Plan first, install only if it earns its place** (§9 lists the cases worth pinning). A UI suite that re-asserts markup is worse than no suite, because it costs maintenance and proves nothing about behaviour. |

**Nothing open stands between the phases that can start today.** UD1 is answered (U0 + U1
landed first — §6), UD2 is executed, UD3–UD5 are decided, and UD6 has a default that blocks
nothing: it is a decision U10 makes on merit. The only genuinely open questions are the
API-side ones listed in §0.4, and each of them waits on an API phase that does not exist
yet — so none of them holds up U2, U3 or U4, which are the three phases a UI owner can
start immediately.

## 11. Traceability — spec section → phase

| Spec | Phase | Note |
| --- | --- | --- |
| §1 intent and scope | U0–U10 | The user-facing half of the scope; the staff half moves to §8 here. |
| §2 scope boundary | all | The "describe it as it is" rule is what makes U3's warning honest and U4's missing identity acceptable. |
| §3 routes and navigation | **U0** | `/app/*`, `/profile` compatibility redirect, `/:slug`, `/p/:slug`, console 404 that cannot fall through to a slug. |
| §4 visual and interaction design | **U0** (primitives), **U10** (accessibility sweep) | Extends `Field` to textarea/select/checkbox; reorder by keyboard and touch, no drag-and-drop this pass. |
| §5 profile and socials | **U1** (+ avatar in **U5**) | Identity, socials, security, account record; forced-rotation, suspended and impersonated handling. |
| §6 my pages and page editor | **U2**, **U3** (+ **U6** address, **U7** links v2, **U8** drafts, **U9** preview and copy-link) | The editor is built once and extended in place; the phases are the spec's own paragraphs, not new requirements. |
| §7 public renderer | **U4** (+ identity in **U9**) | Today's DTO has no identity; U4 renders what exists and U9 completes it. |
| §8 staff user management | **not in this roadmap** | Post-U10, then R2.7. Requirements stay valid. |
| §9 settings, audit, service status | **not in this roadmap** | Same. `/app/status` moves with the console. |
| §10 client architecture and failure handling | **U0** (typed client, `requestList`, feature folders, `useResource`) + **U10** (error matrix) | No production component/state/query library, per the spec. |
| §11 implementation boundaries | all phases | Web-only changes, plus README/ROADMAP accuracy. No deployment or remote migration. |
| §12 acceptance 1–2 | **U1** | Identity/socials persist; reorder sends every live id. |
| §12 acceptance 3–5 | **U2**, **U3** (refined by **U6**–**U8**) | Page/link CRUD, publish/unpublish/delete; the published-page warning; scheduling round-trips and empty bounds. |
| §12 acceptance 6 | **U4** (identity completed in **U9**) | Public theming, unavailable states, network retry. |
| §12 acceptance 7–9 | **not in this roadmap** | Staff listing, settings, audit. |
| §12 acceptance 10–12 | **U10** | Session matrix, error matrix, keyboard/dialog/mobile and dirty-form checks. |
| §12 acceptance 13 | **U0**, **U10** | `/profile` bookmarks and reset links keep resolving; slug collisions have a fallback URL. |
