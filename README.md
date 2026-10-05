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
  src/lib          typed API client, session store, formatting
  src/components   shell, auth frame, field/button/notice primitives
  src/routes       login, register, forgot-password, reset-password, profile
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
cp .dev.vars.example .dev.vars      # then edit the values
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

`.dev.vars` overrides the committed `vars` in `wrangler.jsonc`, which is what
keeps local development on `ENVIRONMENT=development` while deploys ship
`production`. It is gitignored — never commit real secret values.

## Tests and typecheck

```bash
npm test          # 94 API tests, run in workerd against a local D1
npm run typecheck # regenerates worker-configuration.d.ts, then typechecks both workspaces
```

`worker-configuration.d.ts` is generated and gitignored, so run typechecks from
the root (the workspace script only runs `tsc`) or run `npm run types` first.

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
