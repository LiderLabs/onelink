# OneLink

**All your platforms. One link.**

OneLink is a link-in-bio platform for creators and businesses. It brings a profile, social accounts, and important destinations together on a shareable public page.

This repository contains the public website, the creator workspace, and the API. Creators can sign up, complete onboarding, edit their page, publish it, and share its address or QR code. The backend also provides administration, moderation, and page collaboration APIs.

## Contents

- [Technology stack](#technology-stack)
- [Implemented features](#implemented-features)
- [User journeys](#user-journeys)
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
| Frontend | React 19 + TypeScript | Public website and creator screens |
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
- Password-change and password-reset flows, registration availability checks, and session-based access to the workspace.

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

### Backend capabilities beyond the creator UI

- Role and capability checks for `owner`, `admin`, `moderator`, `support`, and `user` accounts.
- Staff user management, warnings, suspensions, bans/reactivation, notes, password-reset requests, and session revocation.
- Public content reports, report assignment/resolution, content moderation, appeals, and private evidence storage.
- Platform settings, audit-log queries, and configurable limits.
- Page membership, invitations, and page-access checks.
- Analytics event storage and page summaries for 7, 30, or 90 days.
- Daily maintenance for expired sanctions, retained audit/analytics data, media cleanup, and removed links.

These APIs exist in the backend. Dedicated staff, team-invitation, and moderation screens are not wired into the current frontend route table.

## User journeys

**New creator:** Landing page → Sign up → Claim page address → Profile → Add links → Customize → Preview & publish → Creator dashboard.

**Returning creator:** Sign in → Creator dashboard. If setup is incomplete, `/app` sends the creator back to onboarding. A required password change must be completed before protected editing actions become available.

**Visitor:** Open a published page → View profile/socials → Follow its links. No account is required to view an available public page.

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

The owner seeder prints credentials and requires a password change after sign-in. Public registration can be used to create ordinary creator accounts.

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

| Feature | Current status |
| --- | --- |
| Real visitor analytics | Backend ingestion/reporting exists; public event collection and creator reporting are not connected |
| Notification preferences | Settings screen exists; preference storage and delivery are unavailable |
| Self-service account deletion | UI explains availability; deletion is disabled for creators. Staff user-deletion APIs exist |
| Multi-device session management | Creator UI shows the current session only. Password changes invalidate other sessions; staff APIs can list/revoke sessions |
| Email delivery | Templates and password-reset tokens exist, but no mail provider sends messages. Development returns reset tokens; production email reset delivery is incomplete |
| Teams and staff tools | Backend APIs exist; dedicated frontend screens are not mounted |
| Contact forms / submissions | No working submission collection or inbox; `/app/submissions` is a placeholder |
| Custom domains and platform integrations | Custom-domain setup is not implemented. Landing-page platform cards illustrate supported destinations; they do not connect external services |

## Additional documentation

- [Backend roadmap](ROADMAP.md) - release scope and backend decisions.
- [UI roadmap](UI-ROADMAP.md) - UI phases and earlier handover notes.
- [Design specifications](docs/superpowers/specs) - detailed feature designs.
- [Implementation plans](docs/superpowers/plans) - feature implementation plans.

Roadmaps and plans contain historical descriptions. For the current implementation, start with this README, the frontend route table, and the API route/schema files.
