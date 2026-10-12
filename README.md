# OneLink

**All your platforms. One link.**

OneLink is a link-in-bio platform for creators and businesses. It brings a profile, social accounts, and important destinations together on a shareable public page.

This repository contains the public website, creator workspace, admin workspace, and API. Creators can sign up, complete onboarding, edit their page, publish it, and share its address or QR code. Staff can manage accounts, review reports and appeals, update platform settings, and inspect audit records.

For backend integration, start with [Backend developer handoff](#backend-developer-handoff). It documents password recovery, the admin workspace, the existing API contracts they consume, and remaining integration work.

## Contents

- [Technology stack](#technology-stack)
- [Implemented features](#implemented-features)
- [User journeys](#user-journeys)
- [Backend developer handoff](#backend-developer-handoff)
- [Project structure](#project-structure)
- [How data and publishing work](#how-data-and-publishing-work)
- [Local development](#local-development)
- [Frontend routes](#frontend-routes)
- [API overview](#api-overview)
- [Configuration](#configuration)
- [Checks and browser testing](#checks-and-browser-testing)
- [Deployment](#deployment)
- [Current limitations](#current-limitations)
- [Additional documentation](#additional-documentation)

## Technology stack

| Area | Technology | Purpose |
| --- | --- | --- |
| Frontend | React 19 + TypeScript | Public website, creator screens, and admin workspace |
| Routing | React Router 7 | Authentication guards, page navigation, and unsaved-change protection |
| Frontend tooling | Vite 8 | Development server and production builds |
| Styling | Tailwind CSS 4 + feature CSS | Responsive layouts, cyan accents, and dark workspace themes |
| Icons | Phosphor Icons + shared OneLink SVG | Interface icons and consistent branding |
| Animation | CSS + Web Animations API | Landing-page motion with reduced-motion support |
| QR codes | `qrcode` | Browser-generated PNG and SVG exports |
| API | Hono + TypeScript | HTTP routes running on Cloudflare Workers |
| Validation | Zod | Request schemas and input validation |
| Database | Cloudflare D1 | Users, sessions, pages, drafts, links, and platform records |
| Media storage | Cloudflare R2 | Public images and private moderation evidence |
| Deployment | Wrangler | Worker deployment, bindings, and database migrations |
| Testing | Vitest + Cloudflare Vitest plugin + Playwright | API tests in the Workers runtime and browser checks |
| Repository | npm workspaces | Shared commands for `apps/api` and `apps/web` |

## Implemented features

### Public website and authentication

- Landing page with the OneLink logo surrounded by social platforms, featured platform cards, and sign-in/sign-up links.
- Compact, transparent sticky navigation, responsive layouts, animated hero elements, and a footer button that returns to the top.
- Sign up with an account username, email, password confirmation, and optional display name.
- Sign in using an email address or username, show/hide password controls, and links back to the landing page.
- Forgot-password and reset-password screens using the current dark/cyan auth card and OneLink logo, with email/password validation, pending states, readable API errors, and home/sign-in navigation.
- Password changes, registration availability checks, and session-based access to the workspace.

Password recovery starts with **Forgot password?** on `/login`, or directly at `/forgot-password`. Enter the account email and choose **Send reset link**, then follow the latest link to `/reset-password?token=...`, enter matching new passwords, and sign in again. Links expire after one hour and work once; requesting another link invalidates previous links. A successful reset ends all existing sessions.

**Email delivery is not connected yet.** The existing API creates reset tokens and renders the email template, but no provider sends the message. Local development shows **Open development reset link** when the API returns a development token for an existing account. Production must deliver the link by email; the frontend does not expose tokens or claim that mail was delivered there. The request confirmation remains generic for registered and unregistered addresses.

### Creator dashboard and navigation

- Dashboard with the creator's profile, page address, publication status, setup checklist, saved links, and page preview.
- Quick actions for editing a page, adding links, copying its address, and publishing.
- Sticky workspace header with an avatar, username, and sign-out control.
- Desktop sidebar that can be hidden or shown; the choice is remembered in the browser.
- Mobile bottom navigation for Overview, Editor, Links, and Analytics, with a More menu for the remaining screens.

### Guided onboarding

New creators follow five steps: claim a page address, edit their profile, add links, customize the design, and preview/publish.

- Page-address availability checks against the API.
- Live previews while editing profile details, links, and design.
- Back/continue navigation and a browser-saved hint for resuming setup.
- Content saved through the API; publishing completes setup and opens the creator dashboard.

### Profile editor and social profiles

- Upload, replace, or remove a profile photo.
- Crop, reposition, zoom, and resize photos in the browser before uploading.
- Edit display name (up to 50 characters), bio (up to 160 characters), account username, and optional location/pronouns.
- Add and edit social profiles with a platform and URL, change their order, toggle visibility, or remove them.
- Preview changes as they are made and warn before leaving unsaved edits.

Photo inputs support JPEG, PNG, and static WebP up to 10 MiB and 40 million decoded pixels. The crop is uploaded as a 512 x 512 WebP capped at 240 KiB. Canceling the crop does not upload a file.

### Page editor and page management

- My pages screen with page cards, publication status, public addresses, edit/view actions, and page creation/deletion.
- Page editor with **Profile, Links, Design, and Publishing** tabs and icon-based controls.
- Edit page-specific names and bios, change the page address, and customize light/dark themes, accent colors, list/grid layouts, and branding visibility.
- Live preview at mobile or desktop widths.
- Autosave to a private draft, explicit Save draft, saved/unsaved status, and conflict handling for stale edits.
- Publish, unpublish, discard a draft, inspect published version history, and restore a previous version into the draft.
- Public pages at addresses such as `/mikejay`, with actual destination links, social icons, and OneLink branding.
- A return shortcut to the previous workspace screen when opening a public page from the app.

### Link management

- Add and edit links with a URL, title, optional description, visibility, and new-tab behavior.
- Organize links into groups, search by title/URL, and filter by group or status.
- Reorder links, hide/show them, remove them, and apply bulk visibility or group changes.
- Set start/end times for scheduled links; the public page respects the published schedule.
- Request URL metadata suggestions and upload optional link thumbnails in the page editor.
- Restore removed links from Recently removed after publishing; the backend purges them after 30 days.
- Preview the draft's visible destinations while editing.

### Share and QR

- Select a page, copy its address, open it, or use the browser's native sharing feature where supported.
- Prepare shares for X, WhatsApp, LinkedIn, and Facebook.
- Customize QR pattern/background colors, export resolution, and an optional OneLink badge.
- Preview QR codes and download PNG or SVG files.
- Verify that a published page is publicly accessible before enabling public sharing and downloads; private pages have an owner preview.

### Account settings

The sidebar has one **Settings** entry with nested sections:

| Section | Current behavior |
| --- | --- |
| Profile | Edit personal details, photo, and social profiles; view account email information |
| Password & security | Change the password; other sessions are signed out while this browser remains signed in |
| Active sessions | View this browser's session details and sign out |
| Notifications | Clearly marked unavailable; preferences are not saved yet |
| Appearance | Charcoal/midnight workspace tones, comfortable/compact spacing, and reduced motion; saved in this browser |
| Delete account | Clearly marked unavailable; individual page deletion is available |

### Analytics screen

The analytics interface includes time-range controls, activity charts, traffic sources, countries, devices, top links, and CSV export for explicitly labeled fictional sample data.

The current frontend does **not** send visitor events or request real analytics reports. The API already has event-ingestion and page-report endpoints, but connecting them to the public renderer and analytics screen remains to be done. Your data therefore shows an unavailable state rather than invented metrics.

### Admin workspace

Staff sign-in opens `/admin`. Staff can also open **Admin** from the creator header's account menu. The workspace uses the shared OneLink logo, cyan accents, a sticky header, a collapsible desktop sidebar, and mobile navigation.

| Screen | Implemented behavior |
| --- | --- |
| Overview | Current user/active-account totals, open and reviewing report counts, recent users, and recent audit activity from the API |
| Users | Server search, role/status filters, sorting, pagination, clickable rows and View buttons for account details, creation, profile edits, notes, sessions, and confirmed warnings/suspensions/bans/reactivation/deletion |
| Reports | Queue filters, stored evidence, public-page link, assignment, dismissal/resolution, account warnings/bans, and whole-page removal with confirmation |
| Appeals | Review appeal and sanction details; uphold, overturn, or reduce eligible suspensions with recorded reasons |
| System settings | Typed controls for existing platform policies, registration availability, serialized autosave, save errors/retry, and unsaved-navigation protection |
| Audit log | Search and action/status/date filters, event details, and CSV export of all matching pages within the configured export limit |

Access follows the API's `owner`, `admin`, `moderator`, `support`, and `user` roles and capability grants. Only owners can change platform policies and assign roles. The API enforces account rank and last-active-owner protection. Creator accounts are redirected out of `/admin`; password-change restrictions remain enforced.

The UI does not claim an invitation email was sent when creating accounts. Impersonation, email-template editing, and rate-limit-rule editing remain unavailable because the current API exposes no endpoints for them. Content removal takes the **entire page** offline; staff have no endpoint for removing a single reported link. Reports with no matching owner account keep account sanctions unavailable.

### Additional backend capabilities

- Role and capability checks for `owner`, `admin`, `moderator`, `support`, and `user` accounts.
- Staff user management, warnings, suspensions, bans/reactivation, notes, password-reset requests, and session revocation.
- Public content reports, report assignment/resolution, content moderation, appeals, and private evidence storage.
- Platform settings, audit-log queries, and configurable limits.
- Page membership, invitations, and page-access checks.
- Analytics event storage and page summaries for 7, 30, or 90 days.
- Daily maintenance for expired sanctions, retained audit/analytics data, media cleanup, and removed links.

Team-invitation, private moderation-evidence uploads, content-flag management, and real creator analytics are not wired into dedicated frontend screens yet.

## User journeys

**New creator:** Landing page → Sign up → Claim page address → Profile → Add links → Customize → Preview & publish → Creator dashboard.

**Returning creator:** Sign in → Creator dashboard. If setup is incomplete, `/app` sends the creator back to onboarding. A required password change must be completed before protected editing actions become available.

**Visitor:** Open a published page → View profile/socials → Follow its links. No account is required to view an available public page.

**Staff:** Sign in → Admin overview → Users, Reports, Appeals, System Settings, or Audit Log → Return to Creator Dashboard or sign out. Accounts requiring a password change visit security settings first.

## Backend developer handoff

**Updated: 12 October 2026. Latest update: password-recovery UI; the admin workspace is also delivered.** These frontend changes preserve existing backend routes, schemas, migrations, and permission rules.

The public landing page, authentication, creator dashboard, onboarding, profile/social editor, page editor, link manager, published pages, Share & QR, and account-settings sections are already built. Their behavior and storage are described under [Implemented features](#implemented-features). Real creator analytics and several account-settings actions remain unavailable; see the [remaining-work table](#current-limitations).

### Password recovery connections

- `POST /api/v1/auth/forgot-password` receives `{ email }` and returns `{ data: { accepted: true, devToken?: string | null } }`. The frontend trims/validates email, prevents duplicate pending requests, and displays rate-limit, network, and validation errors.
- `POST /api/v1/auth/reset-password` receives `{ token, newPassword }`. Client validation checks 8–200 characters and matching confirmation; the server enforces its existing password policy and token validity. Successful resets clear the password inputs, refresh session state, and offer sign-in with the new password.
- Missing/malformed links offer a new reset request. Expired/used-link errors come from the API. Tokens are carried in the link rather than printed in the page copy.
- Backend delivery work remains in [email.service.ts](apps/api/src/services/email.service.ts): connect the provider through `deliver()` and preserve the existing one-hour expiry, single-use tokens, generic confirmation, and session revocation. `APP_ORIGIN` must point to the frontend origin for emailed links.

### Admin delivery

- Staff sign-in redirects to `/admin`; the creator avatar dropdown also provides an Admin entry.
- Overview, Users, Reports, Appeals, System Settings, and Audit Log are mounted routes with loading, empty, error, and permission states.
- Sensitive actions require confirmation and a reason. Pending dialogs prevent duplicate submissions and cannot be dismissed during the request.
- Settings autosave serializes requests, keeps edits made during a save, and exposes failures with an explicit retry.
- Audit CSV export reads every filtered page, enforces the export limit, escapes spreadsheet formulas, and cancels the download if reads fail or pagination changes.
- The interface uses the current OneLink logo and cyan/dark colors, a sticky header, a collapsible desktop sidebar, and mobile navigation.

### Admin API connections

All paths below are relative to `/api/v1`. These endpoints already exist and are called by the frontend.

| Frontend behavior | Existing requests |
| --- | --- |
| Overview totals and recent activity | `GET /admin/users`, `GET /admin/reports`, `GET /admin/audit-logs`; totals come from list metadata, with no fabricated growth metrics |
| User directory, creation, and editing | `GET /admin/users` with `q`, `role`, `status`, `sort`, `includeDeleted`, `page`, `limit`; `GET /admin/users/:id`; `POST /admin/users`; `PATCH /admin/users/:id` |
| User warnings, suspension, bans, and reactivation | `POST /admin/users/:id/warn`, `/suspend`, `/ban`, `/reactivate`; required `reason`, plus suspension duration/permanence where applicable |
| User deletion, notes, and sessions | `DELETE /admin/users/:id?reason=...`; `GET`/`POST /admin/users/:id/notes`; `GET`/`DELETE /admin/users/:id/sessions` |
| Reports queue and resolution | `GET /admin/reports` with status/category/pagination; `GET /admin/reports/:id`; `POST /admin/reports/:id/assign`; `POST /admin/reports/:id/resolve` with `status` and `notes` |
| Reported content removal | `POST /admin/content/pages/:id/remove` with `reason` and `reportId`; removes the entire page, not a selected link |
| Appeal review | `GET /admin/appeals` with status/pagination; `GET /admin/appeals/:id`; `POST /admin/appeals/:id/decision` with `decision`, `notes`, and `reducedDurationHours` for a reduction |
| Platform settings | `GET /admin/settings`; `PATCH /admin/settings` with `{ settings: [{ key, value }] }`; existing keys only, with at most 100 changes per request |
| Audit browsing and export | `GET /admin/audit-logs` with `q`, `action`, `status`, `from`, `to`, `page`, `limit`; `GET /admin/audit-logs/actions`; `GET /admin/audit-logs/:id`; CSV is generated in the browser |

Frontend contracts: [users](apps/web/src/features/admin/users-api.ts), [moderation and appeals](apps/web/src/features/admin/moderation-api.ts), [settings](apps/web/src/features/admin/settings-api.ts), and [audit](apps/web/src/features/admin/audit-api.ts). Backend contracts: [user routes](apps/api/src/routes/users.ts), [moderation routes](apps/api/src/routes/moderation.ts), [settings routes](apps/api/src/routes/settings.ts), [audit routes](apps/api/src/routes/audit.ts), and [validation schemas](apps/api/src/validation).

### Contract and integration notes

- **Authentication:** The browser uses the existing HTTP-only session cookie and `credentials: include`. Login/current-session responses provide the user and capability grants; no admin token is stored in local storage.
- **Access:** Role names remain `owner`, `admin`, `moderator`, `support`, and `user`. There is no `super_admin` role. Owner is the highest role and can edit platform policies and assign permitted roles. Backend capability, rank, self-action, and last-active-owner checks remain authoritative.
- **Restricted sessions:** Required password changes route to `/app/settings/security` before admin access. Inactive, impersonated, and non-staff sessions cannot enter the admin workspace.
- **Response shapes:** Single reads/writes use `{ data: ... }`; paginated lists use `{ data: [...], meta: { page, limit, total, totalPages } }`; errors use `{ error: { code, message, details } }`. Users/settings use camelCase DTOs; reports/appeals/audit use snake_case. Timestamps are epoch milliseconds.
- **Settings reads:** The current settings endpoint returns all records in its data array even when metadata suggests multiple pages. The frontend consumes that array once; it does not paginate settings.
- **Report identity:** Public-page links come from the stored page slug, not the account username. Reports without an owner ID use an exact, unique username match from the user directory; unresolved identities keep account sanctions unavailable. A stable owner user ID in report data would avoid this fallback.
- **Moderation retries:** Warning/ban/page removal and report resolution are separate requests. If the action succeeds but resolution fails, the UI retains the completed action during SPA navigation and retries only resolution. This retry state is not durable across a full browser reload.
- **User creation:** The frontend submits `requirePasswordChange: true`. It does not claim login instructions were emailed because no mail provider is connected.
- **Creator publishing:** Draft changes stay private until publication; account photos/socials update separately. Preserve draft `updatedAt` conflict checks and profile write preconditions when extending the backend.

### Review and verification

Admin feature verification on **12 October 2026** passed the production build/TypeScript checks, all four admin browser scripts, the landing/auth regression script, and **305 API tests across 17 test files**. Admin browser scripts intercept API responses; the API suite uses isolated Workers/D1/R2 test storage. These checks do not replace manual verification against the development database or a deployed environment.

Password-recovery verification on the same date passed the production build, the recovery browser check against Vite on `5173` and Worker-served assets on `8787`, the landing/auth regression check, and **21 authentication API tests**. Browser recovery requests use fixtures; the auth tests independently exercise the existing API. No account password in the local development database was changed by these checks.

For manual review, sign in at `/login` using the seeded owner account, complete the required password change, then open `/admin`. Check creation/editing and suspension/reactivation using a disposable account, confirm report/appeal actions when queue entries exist, refresh after a settings save, and inspect/export the resulting audit records. Repeat with an ordinary creator to confirm `/admin` redirects to the creator dashboard. Setup and commands are below.

## Project structure

```text
onelink/
├── apps/
│   ├── web/
│   │   ├── public/              Static assets, including the OneLink favicon
│   │   ├── src/
│   │   │   ├── App.tsx          Current frontend route table
│   │   │   ├── components/     Shared branding, fields, dialogs, guards, and layouts
│   │   │   ├── features/
│   │   │   │   ├── admin/      Staff overview, users, reports, appeals, platform settings, and audit
│   │   │   │   ├── auth/       Authentication styling
│   │   │   │   ├── landing/    Landing page, platform hero, and animation hooks
│   │   │   │   ├── creator/    Dashboard, onboarding, links, analytics, sharing, settings
│   │   │   │   ├── pages/      Page list, editor, renderer, publishing, and QR tools
│   │   │   │   ├── profile/    Identity, socials, photo editor, and password form
│   │   │   │   ├── media/      Browser image processing, cropping, and upload client
│   │   │   │   ├── public/     Public-page routes and layout
│   │   │   │   ├── console/    Earlier console modules and submissions placeholder
│   │   │   │   └── editor/     Earlier editor modules retained in the repository
│   │   │   ├── lib/            Typed API client, session state, and form/resource helpers
│   │   │   ├── routes/         Sign-in, sign-up, password reset, and error screens
│   │   │   └── styles.css      Shared styles and Tailwind entry point
│   │   └── vite.config.ts      Development proxy and build settings
│   └── api/
│       ├── src/
│       │   ├── app.ts          Hono middleware and API route registration
│       │   ├── index.ts        Worker entry point and scheduled maintenance
│       │   ├── routes/         HTTP endpoints
│       │   ├── services/       Business logic and D1/R2 access
│       │   ├── validation/     Zod request schemas
│       │   ├── middleware/     Authentication, auditing, rate limits, and error handling
│       │   └── lib/            Configuration, permissions, crypto, and shared helpers
│       ├── migrations/        Versioned D1 schema
│       ├── seed/              Platform defaults
│       ├── scripts/           Environment sync and owner-account seeding
│       ├── test/              API test suites
│       └── wrangler.jsonc     Worker, database, bucket, asset, and cron configuration
├── scripts/browser/           Playwright checks and fixtures
├── docs/superpowers/           Design specs and implementation plans
├── .dev.vars.example          Local configuration template
├── package.json               Workspace commands
├── ROADMAP.md                 Backend roadmap and technical notes
└── UI-ROADMAP.md              UI roadmap and historical implementation notes
```

Use [App.tsx](apps/web/src/App.tsx) to identify the screens currently mounted. Some earlier editor/console modules remain on disk without being active routes.

## How data and publishing work

The frontend calls `/api/v1` through its typed API client. D1 stores application data, and R2 stores uploaded media. In production, one Worker serves both the built frontend and the API, keeping them on the same origin.

During development, Vite proxies `/api` to the Worker. Open the app on **http://localhost:5173** so the browser uses the same origin for the UI and its session cookie.

- **Page drafts:** Page text, design, groups, and link edits are saved privately. Publish applies the saved draft to the public page. Restoring history creates a draft; it does not publish automatically.
- **Account profile:** Account identity, photos, and social profiles are shared across owned pages and saved separately. Photo and social changes take effect on the account immediately; they are not held until page publication.
- **Browser preferences:** Sidebar visibility, workspace appearance, and the onboarding resume hint use local storage. The page content itself is saved through the API.
- **Public addresses:** An account username and a page slug are separate values. `/mikejay` opens the page with that slug. `/p/mikejay` is an alternate route, used when a slug would conflict with an application route.
- **Access:** Authentication, account restrictions, page permissions, and moderation status are enforced by the backend. Publishing does not bypass moderation review.

## Local development

### Requirements

- **Node.js 22.12 or newer** and npm, to satisfy the installed Vite/Wrangler tooling.
- Two terminals: one for the API, one for the frontend.
- A Cloudflare account and Wrangler login for remote resources/deployment. Local D1 and R2 use Wrangler's local storage.

Run commands from the repository root unless a step says otherwise. On Windows, use `npm.cmd` if PowerShell blocks `npm.ps1`.

### 1. Install dependencies and configure the environment

```bash
npm ci
```

Copy the example configuration using the command for your shell:

```powershell
# Windows PowerShell
Copy-Item .dev.vars.example .dev.vars
```

```bash
# macOS / Linux
cp .dev.vars.example .dev.vars
```

Edit the root `.dev.vars`. Keep `ENVIRONMENT=development` and `APP_ORIGIN=http://localhost:5173`; set your local session pepper and optional owner credentials. See [Configuration](#configuration) for the variables.

### 2. Prepare the local database and frontend assets

```bash
npm run db:migrate:local
npm run db:seed:local
npm run build
```

To create a local staff owner account, also run:

```bash
npm run db:seed:owner
```

The owner seeder reads `OWNER_EMAIL` and `OWNER_PASSWORD` from the root `.dev.vars`, prints credentials, and requires a password change after sign-in. **Re-running it resets that owner's password to the configured value.** Use the current password if you have already changed it; seeding is not needed for every login. Public registration creates ordinary creator accounts.

### 3. Start both servers

Terminal 1:

```bash
npm run dev
```

Terminal 2:

```bash
npm run dev:web
```

| Service | Local address |
| --- | --- |
| Website and creator workspace | http://localhost:5173 |
| API Worker | http://localhost:8787 |
| Health endpoint through the frontend proxy | http://localhost:5173/api/v1/health |

`npm run dev` applies local migrations before starting the API and copies the root `.dev.vars` into `apps/api/.dev.vars`. **Edit the root file, then restart the API** to apply environment changes; the copy is generated and overwritten.

## Frontend routes

| Route | Destination |
| --- | --- |
| `/` | Public landing page |
| `/login`, `/register` | Sign in and sign up |
| `/forgot-password`, `/reset-password` | Password-reset flow |
| `/app` | Entry point that chooses dashboard or onboarding |
| `/app/dashboard` | Creator dashboard |
| `/app/onboarding` | Guided page setup |
| `/app/editor` | Opens an existing owned page, or onboarding if none exists |
| `/app/pages` | My pages |
| `/app/pages/new` | Create a page |
| `/app/pages/:id` | Page editor; `?tab=profile`, `links`, `design`, or `publish` selects a tab |
| `/app/links` | Link manager |
| `/app/analytics` | Analytics interface and fictional sample data |
| `/app/share` | Share and QR tools; `?page=:id` selects a page |
| `/app/settings` | Redirects to the Profile settings section |
| `/app/settings/:section` | `profile`, `security`, `sessions`, `notifications`, `appearance`, or `delete-account` |
| `/app/profile`, `/profile` | Compatibility redirects to Profile settings |
| `/app/socials` | Compatibility redirect to the socials section in Settings |
| `/app/submissions` | Unavailable-feature placeholder |
| `/admin` | Staff overview; permission-guarded |
| `/admin/users` | User directory, account detail, and management actions |
| `/admin/reports`, `/admin/appeals` | Moderation and appeal queues |
| `/admin/settings` | Platform policies; owners can edit |
| `/admin/audit` | Audit filters, event detail, and CSV export |
| `/:slug`, `/p/:slug` | Public page |
| Unmatched `/app/*` | Workspace not-found screen |

## API overview

All application API routes are under `/api/v1`. This is a map of feature areas; the route files and Zod schemas define the full request/response contracts.

| Area | Endpoint family | What it handles |
| --- | --- | --- |
| Health | `/health` | Worker health |
| Authentication | `/auth/*` | Register, login/logout, current user, profile updates, and password changes/resets |
| Socials | `/profile/socials` | Add, edit, order, hide/show, and delete social profiles |
| Pages | `/pages/*` | Ownership/access, slug availability, page CRUD, previews, publication |
| Drafts and history | `/pages/:id/draft`, `/pages/:id/revisions` | Private drafts, discard, version inspection, and restoration |
| Links and groups | `/pages/:id/links`, `/pages/:id/groups` | Link/group CRUD, ordering, bulk actions, metadata, and restoration |
| Media | `/media/*` | Managed avatars, image uploads, media reads, and deletion |
| Public pages | `/public/pages/:slug` | Public page data, content reports, and event ingestion |
| Analytics | `/pages/:id/analytics` | Page analytics summaries |
| Teams | `/pages/:id/members`, `/pages/:id/invitations`, `/page-invitations` | Membership and invitation management |
| Staff users | `/admin/users/*` | User administration, sanctions, notes, sessions, and password resets |
| Moderation | `/admin/reports`, `/admin/appeals`, `/admin/content-flags`, `/admin/content` | Review queues, evidence, decisions, and content actions |
| Appeals | `/appeals/*` | A user's appeals and evidence |
| Platform configuration | `/admin/settings`, `/public/settings`, `/public/capabilities` | Protected settings and public platform configuration |
| Audit | `/admin/audit-logs/*` | Audit entries and action filters |

See [API registration](apps/api/src/app.ts), [route implementations](apps/api/src/routes), and [validation schemas](apps/api/src/validation). Frontend screens consume these existing APIs.

## Configuration

| Name | Location / type | Purpose |
| --- | --- | --- |
| `ENVIRONMENT` | Local `.dev.vars` / Worker variable | `development`, `test`, or `production`; unknown values use production behavior |
| `APP_ORIGIN` | Local `.dev.vars` / Worker variable | Public app origin, CORS allow-list, and base address for password-reset links |
| `SESSION_PEPPER` | Local `.dev.vars` / deployed Worker secret | Secret mixed into session/reset token hashes; production requires at least 16 characters |
| `OWNER_EMAIL`, `OWNER_PASSWORD` | Root `.dev.vars` or seeder inputs | Credentials used by the owner-account seeding script |
| `PBKDF2_ITERATIONS` | Optional Worker variable | Password-hashing cost, clamped between 10,000 and 100,000 |
| `DB` | D1 binding | Application database, configured as `onelink-db` |
| `PUBLIC_BUCKET` | R2 binding | Public media, configured as `onelink-public` |
| `PRIVATE_BUCKET` | R2 binding | Private evidence, configured as `onelink-private` |

The root `.dev.vars` and its generated API copy are gitignored. Keep real credentials out of committed files. Production configuration belongs in [wrangler.jsonc](apps/api/wrangler.jsonc) and Worker secrets.

Sessions use the `__Host-onelink_session` secure, HTTP-only cookie with `SameSite=Lax` and an eight-hour absolute lifetime. Profile/draft write preconditions reject stale changes instead of silently overwriting another editor's work.

## Checks and browser testing

```bash
npm test                  # API suites using the Workers runtime and local test D1/R2
npm run typecheck         # Generate Worker binding types; check both workspaces
npm run build             # Typecheck and build the frontend
```

The API tests apply migrations and seed data to isolated test storage. Generated `worker-configuration.d.ts` is gitignored; use the root `typecheck` command, which generates it before checking the API.

There is no separate frontend unit-test runner. Browser checks live in [scripts/browser](scripts/browser). With the frontend running, install Playwright's Chromium once and run the fixture-based acceptance suite:

```bash
npx playwright install chromium
npm run browser:acceptance
```

That suite intercepts API requests and does not mutate the local database. Additional scripts cover onboarding, navigation, page editing, links, analytics, sharing, photos, previews, and landing-page motion. Some use a real local test account and modify data; read their setup before running them. The landing checks and several creator checks launch installed Google Chrome.

Admin checks also intercept all API requests and launch installed Google Chrome:

```bash
node scripts/browser/admin-entry-check.mjs
node scripts/browser/admin-users-check.mjs
node scripts/browser/admin-moderation-check.mjs
node scripts/browser/admin-settings-audit-check.mjs
```

Password-recovery checks also use intercepted API fixtures, so they do not change account passwords or send emails:

```bash
node scripts/browser/password-recovery-check.mjs
npm run test -w @onelink/api -- auth.spec.ts
```

The browser check covers 320–1440px layouts, auth navigation, form validation, duplicate pending submissions, development-token links, production confirmation without a token, and reset success/error states. Its default origin is `http://127.0.0.1:5173`; set `BASE_URL` to check another running origin.

For older checks that export a function accepting a Playwright page, use the repository runner:

```bash
node scripts/browser/run-check.mjs scripts/browser/profile-photo-image-check.js
```

Browser screenshots and generated artifacts are written under `output/playwright/`.

## Deployment

The root deploy command builds the frontend, then deploys the Worker together with its assets. There is no separate frontend host to configure.

### First deployment

1. Authenticate and create the D1 database:

   ```bash
   npx wrangler login
   npm run db:create
   ```

2. Update `database_id` in [wrangler.jsonc](apps/api/wrangler.jsonc) with the created database ID. Set `APP_ORIGIN` to your deployment's origin and keep `ENVIRONMENT=production`. If using a different account or resource names, update the bindings accordingly.

3. Create the configured buckets and set a strong production session pepper. Run these commands from `apps/api`:

   ```bash
   npx wrangler r2 bucket create onelink-public
   npx wrangler r2 bucket create onelink-private
   npx wrangler secret put SESSION_PEPPER
   ```

4. From the repository root, apply schema/defaults and deploy:

   ```bash
   npm run db:migrate:remote
   npm run db:seed:remote
   npm run deploy
   npm run db:seed:owner:remote
   ```

5. Sign in as the seeded owner and change its password. The remote seeder uses the owner credentials you configured and prints them to the terminal.

Check the landing page, `/api/v1/health`, sign-in, and a frontend deep link such as `/reset-password?token=x` on the deployed origin.

### Subsequent deployments

```bash
npm run db:migrate:remote  # Apply any new schema migrations first
npm run deploy
```

The Worker serves frontend deep links through SPA fallback, while `/api/*` always reaches the API. A daily cron runs at **03:00 UTC**.

## Current limitations

These distinctions matter when evaluating the project or planning the next feature:

This is the remaining-work list, not a claim that these features are implemented. It distinguishes missing backend support from existing APIs that still need frontend integration.

| Feature | Current status | Remaining work |
| --- | --- | --- |
| Real visitor analytics | Backend ingestion/reporting exists; creator analytics uses labeled sample data | Connect public events to `POST /public/pages/:slug/events` and real reports to `GET /pages/:id/analytics`; backend endpoints already exist |
| Notification preferences | Settings screen exists; preferences and delivery are unavailable | Add authenticated preference storage and delivery support, then connect the UI |
| Self-service account deletion | Disabled for creators; staff user deletion is implemented | Add a self-service deletion contract and confirmation/re-authentication policy, then connect the creator screen |
| Multi-device session management | Creator UI shows this session; staff can list/revoke other users' sessions | Add creator-facing list/revoke endpoints and controls; existing staff endpoints remain permission-guarded |
| Email delivery | Templates/tokens exist; no provider sends messages | Connect a mail provider and password-reset delivery; define login-instruction delivery for staff-created accounts |
| Teams | Membership/invitation APIs exist; dedicated screens are not mounted | Build frontend invitation/member management against the existing APIs |
| Impersonation | Disabled; there is no supported API endpoint | Define authorized impersonation start/end, session handling, and auditing before connecting the UI |
| Email-template and rate-limit-rule editing | Admin UI marks the separate editors unavailable | Expose authenticated CRUD contracts for the existing template/rule records; general settings autosave already works |
| Individual reported-link removal | Staff can remove an entire page only | Add staff link-level moderation and auditing if selective removal is required |
| Report owner identification | Frontend falls back to an exact username lookup when the snapshot lacks an owner ID | Return a stable owner user ID to make account actions independent of username changes |
| Content flags and private evidence | Backend APIs exist; dedicated review/upload controls are not connected | Add frontend content-flag review and private report/appeal evidence workflows |
| Contact forms / submissions | `/app/submissions` is a placeholder | Define collection/storage/inbox APIs and build the corresponding screens |
| Custom domains and platform integrations | No custom-domain setup or external-account connections | Implement these separately; landing-page platform cards represent destinations, not authenticated integrations |

## Additional documentation

- [Backend roadmap](ROADMAP.md) - release scope and backend decisions.
- [UI roadmap](UI-ROADMAP.md) - UI phases and earlier handover notes.
- [Design specifications](docs/superpowers/specs) - detailed feature designs.
- [Implementation plans](docs/superpowers/plans) - feature implementation plans.

Roadmaps and plans contain historical descriptions. For the current implementation, start with this README, the frontend route table, and the API route/schema files.
