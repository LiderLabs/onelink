# OneLink

Admin backend for OneLink — a link-in-bio platform. Hono on Cloudflare Workers,
with D1 for state and R2 for media. The admin SPA is served by the same Worker as
the API, so the two share one origin (that is what lets `__Host-` session cookies
work with `SameSite=Lax` and no custom domain).

```
apps/api
  src/lib          crypto, config, rbac, query helpers (pure, unit-tested)
  src/middleware   request id, auth, rate limiting, maintenance, error envelope
  src/routes       auth, public, users, settings, audit, health
  src/services     business logic + D1 access
  migrations/      D1 schema (applied with `wrangler d1 migrations apply`)
  seed/            platform defaults (idempotent, INSERT OR IGNORE)
  scripts/         seed-owner.mjs — creates/refreshes the owner account
  test/            vitest suites (run inside workerd via @cloudflare/vitest-plugin)

apps/web
  src/lib          typed API client, session store, formatting, resource/dirty-form hooks
  src/components   shell, console layout, auth frame, field/button/notice/dialog primitives
  src/features     profile (identity, socials, security), public (slug layout)
  src/routes       login, register, forgot-password, reset-password, profile, console 404
```

The SPA is served by the API Worker itself (`assets.directory` in
`apps/api/wrangler.jsonc`). One origin means the `__Host-` session cookie needs
no CORS, no `SameSite=None`, and no custom domain.

## Requirements

- Node.js >= 20
- A Cloudflare account with Workers, D1 and R2 available
- `npx wrangler login` once per machine

## Local development

```bash
npm install
cp .dev.vars.example .dev.vars      # then edit the values (repository root)
npm run db:migrate:local
npm run db:seed:local
npm run db:seed:owner               # prints the owner credentials
npm run dev                         # wrangler dev (API) on http://localhost:8787
npm run dev:web                     # in a second terminal: Vite on http://localhost:5173
```

Use `http://localhost:5173`, not the Worker's own port. The Vite dev server
proxies `/api` to `wrangler dev`, so development goes through exactly the
same-origin, credentialed path production uses — which is the only way the
`__Host-` cookie behaves at all.

### Where `.dev.vars` lives (and why that is fiddly)

The file you edit is the one at the **repository root**. `wrangler`, however,
resolves `.dev.vars` relative to the directory that holds `wrangler.jsonc` —
`apps/api/` — so on its own it never sees the root file. `npm run dev` therefore
copies the root file to `apps/api/.dev.vars` before starting wrangler
(`apps/api/scripts/sync-dev-vars.mjs`).

- **Edit the root `.dev.vars`**, never `apps/api/.dev.vars`. The latter is
  generated — it says so in its own header — and is overwritten on every
  `npm run dev`.
- **Restart `npm run dev` after editing it.** wrangler watches the copy, not the
  source, so an edit made while the dev server is running is not picked up.
- If the root file is missing, `npm run dev` stops with instructions instead of
  starting a Worker that answers `500` to everything — which is what "local runs
  as `production` (the committed default) with no `SESSION_PEPPER`" looks like
  from the outside, and it is easy to mistake for a code bug.

`ENVIRONMENT=development` in that file is what unlocks the local affordances
(reset tokens returned in response bodies, so the password-reset flow is
testable without a mail provider). Both files are gitignored — never commit real
secret values; `.dev.vars.example` is the committed template.

## The web console

The SPA is served by the API Worker itself, so both live on one origin. In
development, browse `http://localhost:5173` — never the Worker's own port, where
the `__Host-` session cookie does not exist.

| Route | Screen |
| --- | --- |
| `/login`, `/register` | sign in, create an account |
| `/forgot-password`, `/reset-password` | the reset flow (generated links use these) |
| `/` | redirects to `/app` |
| `/app` | the console; redirects to `/app/profile` until "My pages" lands |
| `/app/profile` | identity (display name, username, bio, location, pronouns), social links, password change, account record |
| `/profile` | compatibility redirect to `/app/profile`, for old bookmarks |
| `/:slug`, `/p/:slug` | the public page — layout only for now; the renderer is a later phase |
| any unmatched path under `/app/` | a console 404 that cannot fall through to a slug |

The profile screen is two resources wearing one screen, and they behave
differently on purpose:

- **Identity** is `PATCH /api/v1/auth/me` (R1.1/R1.2). Only changed fields are sent,
  an emptied optional box is sent as `null`, and the response is *merged* over the
  session user rather than replacing it — the PATCH answer is an `ApiUser` and
  carries no `sessionId`, `sessionExpiresAt` or `impersonatedBy`.
- **Social links** are `/api/v1/profile/socials` (R1.2): append, edit, reorder,
  delete. Reordering uses Move up / Move down (no drag-and-drop this pass) and
  submits every live id, hidden rows included.
- The links section is **not requested at all** for a suspended account or a
  session with an outstanding forced password change: that endpoint answers `403`
  for both, and a deliberate refusal is not an error worth rendering. An
  impersonated session may read the links and may not write them.

Unsaved edits are protected in both directions: in-app navigation asks first
(React Router's blocker, which is why the app mounts `createBrowserRouter`), and
closing the tab warns. A successful save resets the dirty baseline to the server's
normalized values, so the second submit diffs against what is actually stored.

## Tests and typecheck

```bash
npm test          # 199 API tests in 10 files, run in workerd against local D1/R2
npm run typecheck # regenerates worker-configuration.d.ts, then typechecks both workspaces
```

The API suites are the contract evidence for the SPA: the browser consumes those
endpoints and their DTOs rather than re-testing them. `apps/web` has no test
runner of its own, and `npm --workspace apps/web run build` (which runs
`tsc --noEmit && vite build`) plus a browser pass are what verify it.

`worker-configuration.d.ts` is generated and gitignored, so run typechecks from
the root (the workspace script only runs `tsc`) or run `npm run types` first.

### Profile photos

The profile editor accepts JPEG, PNG, and static WebP files up to 10 MiB and
40 million decoded pixels. Drag or use arrow keys to position the square crop,
zoom, reset, and choose **Save photo**. Cropping happens locally; the browser
uploads a 512 × 512 WebP capped at 240 KiB. Cancel sends no upload. Replacement
and confirmed removal clean up the previous photo. Unsaved profile text survives
photo operations. Failed file cleanup has a separate retry control.

The top navbar links to **Profile** (`/app/profile`) for the photo, profile
details, security, and session details, and **Socials** (`/app/socials`) for social
links and the live preview. The account avatar and username sit at the top right.
Switching between these pages preserves unsaved drafts.

The editor's live profile preview follows unsaved name, username, bio,
location/pronouns, photo crop, and social-link drafts. Hidden socials are omitted;
cancel/undo restores the saved view. Reordering previews immediately and rolls
back on rejection. Preview updates do not issue save requests. On mobile the
preview appears above the Socials editor; desktop keeps it in the side panel.

`POST /api/v1/media/avatar?kind=avatar` accepts raw WebP, `GET /api/v1/media/avatar`
returns current metadata, and `DELETE /api/v1/media/avatar/:id` retires owned avatars.
Attachment uses `PATCH /api/v1/auth/me` with `avatarKey` and `expectedAvatarKey`
to detect concurrent edits. Daily maintenance retries retired files and removes
unattached uploads older than 24 hours. The existing generic image API remains
available at `POST /api/v1/media?kind=avatar|page_image` and `DELETE /api/v1/media/:id`,
including its legacy public URLs and PNG/JPEG/GIF/WebP formats. Existing avatars
remain readable; managed editor uploads require the current avatar key when attached.

Start the API with `npm run dev` and the web app with `npm run dev:web` in two
terminals. Open the Vite URL. Browser checks use Playwright CLI and local test
accounts; run them from the checkout that owns the browser session:

```bash
npx @playwright/cli open http://127.0.0.1:5173
npx @playwright/cli run-code --filename=scripts/browser/profile-photo-image-check.js
npx @playwright/cli run-code --filename=scripts/browser/profile-photo-flow-check.js
npx @playwright/cli run-code --filename=scripts/browser/profile-photo-cancel-check.js
npx @playwright/cli run-code --filename=scripts/browser/profile-photo-ui-check.js
npx @playwright/cli run-code --filename=scripts/browser/profile-photo-state-check.js
npx @playwright/cli run-code --filename=scripts/browser/profile-photo-response-check.js
npx @playwright/cli run-code --filename=scripts/browser/profile-preview-check.js
npx @playwright/cli run-code --filename=scripts/browser/profile-preview-social-check.js
npx @playwright/cli run-code --filename=scripts/browser/profile-navigation-check.js
```

The flow check creates a disposable local account used by the UI check.
The state check runs after the flow check and captures mobile and
desktop crop screenshots under `output/playwright/`.

## Deploying

First deploy, in order:

```bash
npm run db:create                                   # D1: onelink-db
npx wrangler r2 bucket create onelink-public        # from apps/api
npx wrangler r2 bucket create onelink-private
npm run db:migrate:remote
npm run db:seed:remote
npx wrangler secret put SESSION_PEPPER              # 32 random bytes, hex
npm run deploy
npm run db:seed:owner:remote                        # prints the owner credentials
```

Subsequent deploys are just `npm run deploy` — it builds the SPA first, then
uploads the Worker and its assets (so the two can never drift apart). Run
migrations first if the schema changed.

If the deployed origin changes, update `APP_ORIGIN` in `apps/api/wrangler.jsonc`:
it is both the CORS allow-list and the base of password-reset links.

Smoke test:

```bash
curl -i https://<worker>/                        # the SPA shell (text/html)
curl -i https://<worker>/api/v1/health           # JSON, even with Accept: text/html
curl -i "https://<worker>/reset-password?token=x" # deep link -> index.html
curl https://<worker>/api/v1/public/settings
```

## Configuration

| Name | Kind | Purpose |
| --- | --- | --- |
| `ENVIRONMENT` | var | `development` \| `test` \| `production`. Unrecognised values fail closed (treated as production). |
| `APP_ORIGIN` | var | Public origin of this deployment. The whole CORS allow-list, and the base URL of password-reset links (`/reset-password?token=…`). |
| `DB` | D1 | `onelink-db`. |
| `PUBLIC_BUCKET` / `PRIVATE_BUCKET` | R2 | Avatars and other media. |
| `SESSION_PEPPER` | secret | Mixed into session/reset token hashes, so a stolen database cannot be replayed. Required in production (>= 16 chars, else requests fail). |
| `PBKDF2_ITERATIONS` | var | Optional. Overrides the password-hashing cost; clamped into `[10_000, 100_000]`. |

## Operational notes

- **PBKDF2 is capped at 100 000 iterations** by workerd's WebCrypto. That is a
  hard platform limit (`NotSupportedError` above it), not a policy choice, so the
  default is the strongest cost that actually computes here. Hashes record their
  own count, and a stored count is rehashed on the next successful login if it is
  below the configured target.
- **CORS allows exactly `APP_ORIGIN`**, and in production an unset `APP_ORIGIN`
  grants nothing rather than reflecting the caller.
- **No mail provider is wired up yet.** Password reset therefore cannot be
  completed by hand in production: `/auth/forgot-password` accepts the request
  but the response only contains `devToken` outside production
  (`allowDevTokens` in `src/lib/config.ts`), and `email.service.ts` is a stub.
- `platform.registration_open` defaults to `true`, so public sign-up is live once
  deployed. The seeded owner has `require_password_change = 1`: login succeeds,
  but every other authenticated route answers `403 MUST_CHANGE_PASSWORD` until
  the password is rotated. **Rotate it immediately after the first deploy.**
- A daily cron (`0 3 * * *`) prunes expired sessions and reset tokens.
