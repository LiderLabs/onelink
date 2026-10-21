# OneLink Project Overview

**All your platforms. One link.**

OneLink is a link-in-bio platform for creators and businesses. Each creator can build a public page with profile details, social accounts, and links to important destinations. The project includes a public website, creator workspace, admin workspace, and API.

This document combines the current feature inventory, core technology stack, architecture, and known gaps. “Working” means the feature is present in the current code and, where applicable, connected to an existing API. It does not confirm a production deployment or replace a fresh test run.

## Core technology stack

| Area | Technology | How OneLink uses it |
| --- | --- | --- |
| Language | TypeScript | Frontend and backend implementation, with shared API types |
| Frontend | React 19 | Landing page, authentication, creator screens, public pages, and admin screens |
| Routing | React Router 7 | Client-side routes, access guards, deep links, and unsaved-change navigation |
| Frontend build and development | Vite 8 | Local frontend server and production asset build |
| UI styling | Tailwind CSS 4 and feature CSS | Responsive layouts, current cyan/black visual system, and screen-specific styles |
| Icons and brand | Phosphor Icons and shared OneLink SVG | Interface icons and consistent OneLink branding |
| Browser graphics | SVG, Canvas, and Web Animations API | Analytics charts, photo cropping, QR rendering, and landing-page motion; GSAP is not used |
| QR codes | `qrcode` | Generate and export page QR codes as PNG and SVG |
| API framework | Hono 4 | HTTP API running on Cloudflare Workers |
| Request validation | Zod 4 | Validate API request bodies, query values, and settings |
| Runtime and hosting | Cloudflare Workers | Serves the API and the built single-page frontend from one origin |
| Relational storage | Cloudflare D1 | Users, sessions, pages, drafts, links, groups, settings, moderation, and analytics records |
| Object storage | Cloudflare R2 | Public avatar/media files and private moderation or appeal evidence |
| Database management | Wrangler migrations and SQL seeds | Create/update D1 schema and populate platform defaults |
| Scheduled work | Cloudflare Cron Triggers | Daily cleanup and maintenance tasks |
| API tests | Vitest and Cloudflare Vitest plugin | Exercise API behavior in a Workers-compatible test environment |
| Browser checks | Playwright | Check key UI flows using browser-based acceptance scripts |
| Monorepo | npm workspaces | Manage `apps/web` and `apps/api` from the repository root |

The main packages are versioned in the workspace manifests. Current major versions include React 19, React Router 7, Vite 8, Tailwind CSS 4, Hono 4, Zod 4, Vitest 4, and Wrangler 4.

## Features implemented and connected

### Public website and authentication

- Landing page with OneLink branding, platform sections, responsive navigation, sign-in/sign-up links, page motion, and a back-to-top control.
- Registration with username, email, password confirmation, and optional display name. Registration availability is controlled by the platform setting.
- Sign-in with email or username, password visibility controls, and session-based access.
- Sign-out and session-aware routing.
- Forgot-password and reset-password screens using the current cyan/dark authentication design. The forms validate input, show API errors, and handle expired or missing reset tokens.
- Password recovery APIs create and consume one-time reset tokens. Tokens expire after one hour; requesting another reset invalidates earlier links. Resetting a password ends the user's sessions.

### Creator onboarding and workspace

- New creators can claim a page address, add profile details and links, customize the design, preview, and publish.
- Page-address availability is checked with the API.
- Returning creators open the dashboard; incomplete setup returns them to onboarding.
- Dashboard shows pages, publication status, saved links, setup progress, and a page preview, with shortcuts to edit and share.
- Workspace header, collapsible desktop sidebar, mobile bottom navigation, and sign-out control.
- Sidebar visibility and the onboarding resume hint are saved locally in the browser.

### Profiles and social accounts

- Edit account display name, bio, location, and pronouns.
- Add, edit, reorder, hide/show, and remove social profile links.
- Upload, crop, replace, and remove profile photos. Photo processing happens in the browser before upload.
- Profile preview updates as details are edited.
- Profile and photo updates are saved through the API. Photo/social changes apply to the account independently of page publication.

### Pages and publishing

- Create and manage multiple pages, check address availability, open page details, and delete pages.
- Page editor sections for Profile, Links, Design, and Publishing.
- Customize page theme, accent color, layout, and branding visibility.
- Preview at mobile and desktop sizes.
- Save private drafts, autosave edits, publish/unpublish, discard drafts, inspect revision history, and restore a revision into a draft.
- Detect conflicting edits so stale changes do not silently overwrite a newer draft.
- Public pages are served at their page address and show profile details, social links, visible destinations, and OneLink branding.
- A workspace shortcut returns the creator after visiting a public page from the dashboard/editor.

### Link management and sharing

- Create, edit, search, group, filter, reorder, hide/show, and remove links.
- Set optional descriptions, new-tab behavior, thumbnails, and scheduled visibility windows.
- Request URL metadata suggestions.
- Restore recently removed links while they remain within the retention period.
- Copy or share a published page URL; use the browser's native share option when available.
- Customize QR colors, resolution, and OneLink badge, then export as PNG or SVG.
- Drafts have private previews. Public sharing and QR downloads require a published page.

### Account settings

- Profile details, profile photo, and social profile settings.
- Password change and current-browser session review/sign-out.
- Workspace color, spacing, and reduced-motion preferences saved in the current browser.
- Email address is displayed as account information; users cannot change it through settings.

### Admin workspace

The `/admin` workspace is protected by backend-enforced roles and capabilities. It includes:

- Overview with account totals, report counts, recent users, and recent admin activity.
- User search, sort, role/status filters, pagination, account details, account creation, profile edits, notes, and session review.
- Confirmed warnings, suspensions, bans, reactivation, deletion, and session revocation, subject to permissions and account-rank protections.
- Report queue, report detail, assignment, resolution/dismissal, supported account sanctions, and whole-page removal.
- Appeal review, including decisions to uphold, overturn, or reduce eligible suspensions, with recorded reasons.
- Platform settings with autosave and error/retry handling for settings exposed by the API.
- Audit log search, action/status/date filters, detail view, and CSV export.
- Responsive admin navigation and a creator-header link for staff accounts.

Roles include `owner`, `admin`, `moderator`, `support`, and `user`. The API controls authorization, role ranking, and protection for the last active owner.

### Backend capabilities

The API also provides authentication and session management, profile/social endpoints, page and draft operations, link/group operations, media storage, public page reads, public report submission, analytics event ingestion/reporting, moderation and appeals, platform settings, audit records, page memberships/invitations, and scheduled cleanup.

## Partially implemented or local-only features

| Feature | Current behavior | What is still needed |
| --- | --- | --- |
| Password reset email | Reset UI and token API exist. Local development can show a development reset link. | Connect an email provider through the existing email delivery seam so users receive reset links. Also send staff-created account instructions. |
| Creator analytics | Screen has date ranges, charts, insights, link tables, and CSV export for clearly labeled fictional sample data. | Send real view/click events from public pages and fetch real analytics reports. Existing API endpoints are available. |
| Appearance and sidebar | Preferences work in the current browser. | Persist preferences to the user account if they should follow a user across devices. |
| Active sessions | Creators can inspect/sign out the current browser session. Staff can inspect and revoke a user's other sessions. | Add creator-facing list/revoke endpoints and controls for other devices. |
| Account email | Current email and verification status are shown. | Add a verified email-change flow if users should be able to update their address. |
| Admin account creation | Staff can create accounts. The interface does not claim an email was sent. | Connect invitation/login-instructions email delivery. |
| Admin settings | Existing platform policy settings can be updated. | Add separate email-template and rate-limit-rule editing contracts/UI if required. |
| Moderation actions | Staff can remove an entire page and take supported account actions. | Add link-level removal if a single reported destination should be removed without taking down the page. |

## Not yet complete

Some API support exists, but there is no complete creator-facing interface:

- Team member and invitation management. Page membership/invitation APIs exist, but dedicated screens are not mounted.
- Creator appeal submission and evidence upload. The API supports appeals and evidence; staff have an admin review screen, but the creator appeal workflow is missing.
- Content-flag management and complete private evidence upload/review flows.
- A public report form. The API accepts reports, but the public page does not provide a complete report-submission experience.
- Real visitor analytics, as described above.

These product capabilities still need definition and/or backend support:

- Notification preferences and notification delivery.
- Self-service account deletion with confirmation and re-authentication rules. Staff user deletion already exists.
- Admin impersonation, including authorization, session behavior, and audit requirements. No supported API endpoint is present.
- Contact forms/submissions. `/app/submissions` is a placeholder and needs data collection, storage, and inbox APIs/screens.
- Custom domains and authenticated integrations with external platforms.
- OAuth/social sign-in, if it is part of the intended product. Current sign-in uses email or username and password.

## How the app is connected

- The browser sends requests to the API under `/api/v1` using the existing HTTP-only session cookie.
- In development, Vite runs on port `5173` and proxies API requests to the Worker on port `8787`.
- In production, the Worker serves the compiled frontend and API from the same origin. This supports the secure `__Host-onelink_session` cookie and client-side deep links.
- D1 stores application records; R2 stores images and private evidence.
- Backend authorization remains authoritative. Frontend role/capability checks are used to show or hide controls, not to secure API requests.

## Main routes

| Route | Feature |
| --- | --- |
| `/` | Public landing page |
| `/login`, `/register` | Sign-in and sign-up |
| `/forgot-password`, `/reset-password` | Password recovery |
| `/app`, `/app/dashboard` | Creator entry and dashboard |
| `/app/onboarding` | Guided creator setup |
| `/app/pages`, `/app/pages/new`, `/app/pages/:id` | Page list, create, and editor |
| `/app/links` | Link manager |
| `/app/share` | Sharing and QR tools |
| `/app/analytics` | Analytics interface and fictional sample data |
| `/app/settings/:section` | Profile, security, sessions, notifications, appearance, deletion information |
| `/admin` | Admin overview |
| `/admin/users` | User management |
| `/admin/reports`, `/admin/appeals` | Moderation and appeals |
| `/admin/settings` | Platform settings |
| `/admin/audit` | Audit log and export |
| `/:slug`, `/p/:slug` | Public page |

API route definitions and validation schemas live in `apps/api/src/routes` and `apps/api/src/validation`. Frontend code is under `apps/web/src/features` and `apps/web/src/routes`.

## Local development

Use Node.js 22.12 or newer and npm. Run commands from the repository root; on Windows use `npm.cmd` if PowerShell blocks `npm.ps1`.

```bash
npm ci
npm run db:migrate:local
npm run db:seed:local
npm run build
```

Start the API/Worker and frontend in separate terminals:

```bash
npm run dev
npm run dev:web
```

The local website is at `http://localhost:5173`; the API Worker is at `http://localhost:8787`. Configure local secrets in the root `.dev.vars` file and do not commit credentials.

## Test and verification commands

```bash
npm test
npm run typecheck
npm run build
npm run browser:acceptance
```

API tests use isolated Workers-compatible D1/R2 storage. Browser checks live under `scripts/browser`; some intercept API calls while others require a local account. Check each script's notes before running one that changes account data.

## Repository layout

```text
apps/
  web/       React frontend and browser routes
  api/       Hono Worker, API routes, services, migrations, and seeds
scripts/
  browser/   Playwright acceptance checks
docs/
  superpowers/ design specifications and implementation plans
```

For the detailed API handoff, deployment guide, and feature-by-feature route documentation, see `README.md`.
