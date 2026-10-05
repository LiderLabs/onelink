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
```

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
npm run dev                         # wrangler dev, http://localhost:8787
```

`.dev.vars` overrides the committed `vars` in `wrangler.jsonc`, which is what
keeps local development on `ENVIRONMENT=development` while deploys ship
`production`. It is gitignored — never commit real secret values.

## Tests and typecheck

```bash
npm test          # 94 tests, run in workerd against a local D1
npm run typecheck # regenerates worker-configuration.d.ts, then tsc --noEmit
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

Subsequent deploys are just `npm run deploy` (migrations first if the schema
changed). Smoke test:

```bash
curl https://<worker>/api/v1/health
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
