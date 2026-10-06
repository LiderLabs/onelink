# OneLink UI for the existing API

Date: 2026-10-06
Status: Proposed written spec, awaiting user review
Baseline: `ef76cd2` (PROFILE UPDATE API)

## 1. Intent and agreed scope

Give account holders and staff a complete browser interface for the features the
backend currently implements. The user selected all existing backend features,
including user management, sanctions, settings, and audit logs, and approved the
in-chat design on 2026-10-06.

Success means an account holder can edit their identity and socials, create a page,
manage its links and appearance, publish it, and open its public URL. Staff can
perform the actions their capabilities permit through working screens. Every
screen handles loading, empty results, rejected requests, and expired sessions.

Extend the existing React/Vite/Tailwind application and black-and-white visual
language. Keep the current cookie authentication and API contracts. This request
explicitly opens the UI work that ROADMAP.md otherwise defers until R1.8 and R2.7.

## 2. Scope boundary and backend realities

- Profile editing and socials are implemented, including location and pronouns.
- Page and link CRUD, ordering, scheduling, publish, unpublish, and public reads
  are implemented. Slugs are immutable after creation.
- A publish writes a revision snapshot. Public reads use the live page and link
  rows, not that snapshot. Saving changes to an already published page changes
  the public content immediately. Explain this before the editor's save actions.
- There is no separate draft store, autosave endpoint, revision browsing, restore,
  slug-availability endpoint, or slug rename endpoint. The editor uses explicit
  saves and never suggests that a saved change is waiting for publication.
- R2 bindings and media tables exist, but upload/serve/delete APIs do not. Do not
  introduce avatar or thumbnail upload controls in this change.
- Email templates can be rendered, but no delivery provider is configured.
  Password-reset screens must explain this. An admin email-reset response's
  `delivered` field does not currently prove delivery, so never claim an email was
  sent on that basis. Development reset tokens may be shown only when returned
  by the API. Temporary passwords remain available to authorized staff.
- Reports, appeals, content flags, analytics, and impersonation initiation have
  no implemented routes. Capability names alone do not justify new screens.
- Audit export and staff invitations mentioned in documentation have no routes
  in the checked code. Do not invent those actions.
- Rate limiting is per Worker isolate; the UI handles actual 429 responses and
  retry hints without presenting the rules as guaranteed global quotas.

No database migration or new production backend feature is needed. A backend
defect discovered during implementation is reported with its observable impact
and handled only when necessary for a working existing flow.

## 3. Routes and navigation

| Route | Purpose | Access |
| --- | --- | --- |
| `/login`, `/register` | Existing authentication | Anonymous |
| `/forgot-password`, `/reset-password` | Existing reset flow and canonical backend reset URLs | Public |
| `/app` | Redirect to My pages, or profile when password rotation is required | Session |
| `/app/profile` | Identity, socials, account details, password change | Session; writes require usable account |
| `/app/pages` | Paginated My pages | Usable account, settled password |
| `/app/pages/new` | Create page | Same, unimpersonated |
| `/app/pages/:id` | Appearance, links, publication actions | Owned resource |
| `/app/admin/users` | User listing and filters | `users.read` |
| `/app/admin/users/new` | Create account | `users.create` |
| `/app/admin/users/:id` | Account detail and staff actions | `users.read`; actions individually gated |
| `/app/admin/settings` | Platform settings | `settings.read`; save requires `settings.update` |
| `/app/admin/audit` | Audit listing | `audit.read` |
| `/app/admin/audit/:id` | Audit entry detail | `audit.read` |
| `/app/status` | Health and current account's capability summary | Session |
| `/` | Redirect to `/app` | Redirect; auth guard determines destination |
| `/profile` | Compatibility redirect to `/app/profile` | Redirect |
| `/:slug` | Published public page | Public |
| `/p/:slug` | Public fallback for slugs colliding with legacy/root routes | Public |

Specific routes precede the public slug route. Paths beginning with `/app/` that
do not match a screen render a console 404 and cannot fall through to a slug.
Retain the root auth routes because generated password-reset links use them.

The legacy `/profile` alias conflicts with a slug the current API permits. Keep
the alias for existing bookmarks and provide `/p/profile` for that public page.
Use the fallback for any historical slug colliding with a fixed root route.

Signed-in navigation contains My pages and Profile, followed by the staff links
the session's capabilities permit. Service status is a secondary link. Use a
sidebar at desktop widths and a compact, keyboard-accessible expandable menu on
small screens. Preserve skip navigation, sign out, maintenance notices, and
account suspension notices. Keep auth screens compact within their existing frame.

## 4. Visual and interaction design

Retain existing paper, ink, rule, and danger tokens, Fraunces headings, Archivo
body text, and JetBrains Mono metadata. Reuse Button, Field, Notice, and status
screens; extend the form primitives with textarea, select, and checkbox controls.
Use clear section titles, generous form spacing, restrained borders, and readable
lists. Tables scroll within their own region on mobile, or collapse to labeled
records when that better preserves meaning. Do not let the page overflow.

Use visible labels, associated hints/errors, focus indicators, and native controls
where possible. Reordering includes Move up/Move down controls usable by keyboard
and touch. Drag-and-drop is unnecessary for this pass. Motion remains subtle and
respects reduced-motion preferences.

Destructive confirmations identify the affected account/page/link and the actual
effect. A shared dialog manages focus, Escape, return focus, and pending state.
Staff sanction and session-revocation forms require the backend's reason field.
There is no additional confirmation for ordinary profile or appearance saves.

## 5. Profile and socials

Organize `/app/profile` into identity, social links, security, and account details.

- Identity edits displayName (1-50), bio (0-160), location (0-100), pronouns (0-40),
  and username (3-32, backend character rules). Submit changed fields only using
  `PATCH /auth/me`. Clearing optional text sends null. Read legacy longer text
  without truncating it; validate a field when its changed value is submitted.
- On success adopt the saved identity or refresh `/auth/me` so the shell and
  account record reflect the server's normalized values. Distinguish a committed
  save from a later session-refresh failure to avoid inviting duplicate writes.
- Socials use `/profile/socials`: list, append, edit platform/URL/visibility,
  reorder, and delete. Platforms match the backend enum, and the cap is 20.
  Submit the complete list of IDs for reorder, including hidden entries.
- Retain the password-change form and its forced-rotation flow. A forced-change
  session can reach security here; identity and social editing remain disabled.
- Suspended/pending accounts can see their account explanation via `/auth/me`.
  They do not request the restricted socials endpoint or gain write controls.
- Impersonated sessions may read identity/socials but cannot edit them. Present
  a prominent read-only notice. Do not implement an impersonation start button.

## 6. My pages and page editor

`GET /pages/mine` supplies the listing and pagination metadata. Show title/slug,
publication status, moderation state, and last update. Provide create, open, and
confirmed delete actions, a useful empty state, and retry for loading failures.
Keep page/filter state in the URL where relevant.

Creation supports the existing slug, title, bio, theme, layout, accentColor, and
showBranding fields. Slug is optional so the server can use the username; explain
the resulting address and handle 409 collisions. The created resource opens its
editor. Slug remains read-only there.

The editor reads `GET /pages/:id` and separates appearance/content from links:

- Appearance/content: title (120), page bio (500), light/dark theme, list/grid
  layout, optional six-digit hex accent, and branding. Submit changed fields only.
- Links: title (140), HTTP(S) URL (2048), description (280), optional icon text
  (80), visibility, startsAt, and endsAt. Support create/edit/delete and full-list
  reordering. Describe icon as text, since the API has no asset/icon catalog.
- Scheduling controls display local date/time and send epoch milliseconds.
  Empty bounds send null. Preserve unchanged stored timestamps and validate the
  resulting start/end window against the existing value as well as entered text.
- Publishing/unpublishing calls the existing POST endpoints and refetches the
  server state. Moderation-removed pages cannot publish. Display last published
  revision and timestamp, without a history/restore action.
- Provide a render preview using the same client renderer as the public page.
  It is labeled a local preview of entered values, not an authoritative server
  draft. Apply visibility/schedule filters consistently; preview is never a save.
- Disable publication actions while form changes are unsaved. Explain that they
  operate on saved content. Preserve entered values when a request fails.
- Saving content or links on a published page carries the explicit message that
  the save updates the live page immediately. Unpublish remains available.
- Open/copy the actual public URL using the current application origin, since
  this deployment serves the renderer and API on that origin. Do not produce
  unreachable links from the seeded `https://onelink.local/` setting. Use the
  `/p/:slug` fallback for a fixed-root-route collision.

Published under-review pages are not publicly readable according to the current
service. Display their moderation state without claiming their URL is available.
Foreign, deleted, and missing page IDs use the same unavailable-page UI.

## 7. Public renderer

Read `GET /public/pages/:slug` anonymously and render its actual DTO: page title,
bio, theme/layout/accent/branding, owner username/displayName, and returned links.
Location, pronouns, socials, avatar URLs, and counters are not in this DTO and
must not be fabricated or fetched through protected endpoints.

Use the response's links as the public authority; the backend already filters
visibility and schedule windows. Render text normally in React and accept only
HTTP(S) link destinations. Never inject stored HTML. Preserve accessible contrast
when an accent color is used, reserving it for decoration when needed.

The public route has its own layout and does not require a successful session
bootstrap to render. It distinguishes a 404/unavailable page from network/500
failures with retry. It has no console navigation, account data, or health panel.
There is no QR feature, analytics beacon, server preview, or SEO rewrite here.

## 8. Staff user management

User listing supports q, role, status, sort, includeDeleted, page, and limit using
`GET /admin/users`. Changing filters resets pagination. Retain filters in URL
search parameters. Use safe sort values supported by the service.

Create account exposes email, optional username/displayName, role, password,
requirePasswordChange, and emailVerified. Offer only roles strictly below the
actor's rank; the API performs the authoritative grant check. A server-provided
username fallback remains possible. Passwords are never persisted in browser
storage or included in diagnostic logs.

The detail page reads `GET /admin/users/:id` for identity, counts, and the latest
20 sanctions. It offers only existing endpoints:

| Action | Capability and additional rules |
| --- | --- |
| Edit name/bio/email/username | `users.update`; actor rank >= target rank |
| Change role | Also `users.role.assign`; new role strictly below actor |
| Warn/suspend/ban/reactivate | `users.sanction`; moderation rank rules |
| Soft delete | `users.delete`; moderation rank rules; confirmed reason |
| Read notes / add note | `users.notes.read` / `users.notes.write` |
| List active sessions | `users.read` |
| Revoke all sessions | `users.sessions.revoke`; moderation rank rules |
| Email reset / temporary password | `users.password.reset`; reset-mode rank rules |

Moderation forbids self-action and normally requires a strictly higher rank;
owner-on-owner is allowed except self-action. Edit/email-reset uses the backend's
equal-rank edit rule. The last-active-owner invariant remains server-authoritative:
handle refusal without implying the action succeeded.

Notes paginate independently. The sessions view lists the API's active sessions
and offers revoke-all only, since there is no single-session revoke endpoint.
Warn/suspend/ban collect reason, optional category/report ID, and supported
duration/permanent choices. Reactivate cannot restore a soft-deleted account.

Re-read affected resources after mutations. Editing the current staff account
also refreshes the session. Never display audit success until the server answers
success. Temporary-password inputs are cleared after success; no client-generated
reset token or fake invitation flow is provided.

## 9. Settings, audit, and service status

Settings loads all records from `GET /admin/settings` and groups them by `group`.
Use text inputs for strings, booleans as checkboxes, finite numeric inputs, and
validated JSON textareas. Show descriptions and public/private metadata. The GET
currently returns all records despite pagination parameters, so do not add fake
server pagination. Save changed rows together via PATCH `{ settings: [...] }`.
Admin users read settings; only the owner capability permits editing. Refresh
public/session settings after a successful save so banners update correctly.

Audit listing supports q, actorId, action, targetType, targetId, status, from, to,
page, and limit. Load available action names from `/admin/audit-logs/actions`.
Dates are entered locally and converted to epoch milliseconds. Details show actor,
target, timestamps, request ID, before, after, and metadata. The current audit DTO
has snake_case top-level names; mirror or normalize that explicitly in the client,
without assuming it matches other DTOs. Render JSON as text, never HTML.

Service status uses `/health` through `/api/v1/health` and displays healthy,
degraded, or unavailable with last-check time and manual refresh. Preserve the
503 health payload so degraded is distinguishable from an unreachable API.
Show only the signed-in user's capabilities from session state; the public
capability matrix is an implementation aid and need not be a separate screen.

## 10. Client architecture and failure handling

Keep handwritten frontend wire types aligned with the actual backend mappers;
add nullable location/pronouns, page/link/social DTOs, users/notes/sanctions/sessions,
settings, audit, and list metadata. Keep frontend types independent of backend
imports. Reuse the typed fetch client and relative `/api/v1` base.

Add an envelope-aware request path for paginated responses, since the current
client unwraps `data` and discards `meta`. Preserve credentials, timeout,
204 handling, error codes, details, and Retry-After. A missing Retry-After header
must be null rather than a zero-second hint. JSON headers are added only when
sending JSON.

Organize resource client methods and screen components by feature rather than
building one large route file. Shared form/error, confirmation, pagination, and
resource-loading helpers remain small and explicit. React state and effects are
sufficient; do not add a production component/state/query library for this pass.

Resource reads ignore stale responses after navigation/filter changes and
unsubscribe on unmount. Mutations are explicit and never automatically retried.
Refetch after successful writes rather than inventing optimistic server state.
If a post-write refetch fails, explain that the write succeeded and offer reload.

- 401: clear session identity and return to login with a validated local next path.
- MUST_CHANGE_PASSWORD: refresh session and route to profile/security.
- ACCOUNT_DISABLED: refresh account state and show the account explanation.
- FORBIDDEN: explain the refused action; never use client capabilities as authority.
- 404: unavailable resource with navigation back to its listing.
- 409/422: preserve form input and show conflict/field errors.
- 429: show the server's retry interval when supplied and retain input.
- MAINTENANCE: keep readable content, explain the write refusal.
- Network/500: retryable error, without success feedback or automatic replay.

Write controls reflect current account/session policy: no identity/content/staff
writes while impersonating; no normal writes before forced rotation or on unusable
accounts. Password rotation remains available under its existing backend guard.
Maintenance exemptions match the actual code: auth paths are exempt, and owner/
admin bypass the write block. The UI must not disable actions the API permits.

Use a before-unload warning when local edits are dirty. In-app navigation uses a
shared unsaved-changes confirmation; router setup may move to React Router's data
router to support its blocker API. Successful saves reset the dirty baseline to
server-normalized data. Do not overwrite dirty input with a background refresh.

## 11. Implementation boundaries

Primary changes are in `apps/web/src/lib`, `components`, `routes`, `App.tsx`, and
`main.tsx`, plus focused style additions. Update README to document implemented
screens, new console/public routes, local setup, and actual verification commands.
Update roadmap UI status carefully without marking missing backend phases done.

Meaningful automated UI tests may add test-only dependencies and a web test script.
Plan their setup before installation; avoid tests that merely repeat static markup.
Use existing API tests as contract evidence and real local API/browser flows as
integration evidence. No deployment, remote migration, or external publication
is part of this request.

## 12. Acceptance and verification

Run root typecheck, web build, existing API tests, and focused UI tests. Exercise
the app in a browser against local Wrangler/D1 using local fixture accounts and
pages. Credentials and development tokens must not appear in captured artifacts.

Required checks:

1. Identity/social changes save, normalize, refresh the session, and survive reload.
2. Social and link reorder sends every live ID, including hidden rows, and persists.
3. Page create/edit/link CRUD/publish/unpublish/delete completes through the real API.
4. Published-page editing explicitly warns about immediate public changes.
5. Scheduling round-trips local times correctly, handles empty bounds, and refuses
   an end preceding the complete start value.
6. Public light/dark and list/grid pages render safely; draft/removed/under-review
   or unusable-owner pages show unavailable; a network failure offers retry.
7. Staff filters/pagination, edits, sanctions, notes, sessions, and both reset modes
   match their endpoints and respect capability/rank rules, including direct URLs.
8. Settings distinguish actual booleans from strings; owner saves and admin reads;
   saved maintenance settings update the shell.
9. Audit filters/details display the actual DTO; status distinguishes health 503.
10. Anonymous, ordinary user, support/moderator/admin/owner, forced-password,
    suspended, and impersonated sessions receive the intended screens/actions.
11. 401/403/404/409/422/429/503 and refetch failure preserve appropriate state and
    never show false success or repeat a committed mutation.
12. Keyboard navigation, dialog focus, accessible labels, and mobile/desktop
    layouts work; dirty forms warn before navigation.
13. Legacy auth/reset links and `/profile` bookmarks still resolve; public slug
    collisions have a working fallback URL.

Completion requires passing available checks with reported evidence and an explicit
account of any environment constraint that prevents a required verification.
