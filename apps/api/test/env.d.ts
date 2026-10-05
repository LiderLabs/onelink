// Bindings injected by vitest.config.ts, declared on the same `Cloudflare.Env`
// namespace `wrangler types` generates. Adding them here means test code gets
// real types from `import { env } from 'cloudflare:workers'`.
//
// Note: we deliberately do NOT use the `cloudflare:test` module — its `env` and
// `SELF` exports are deprecated in favour of `cloudflare:workers`, and pulling
// it in would require a fragile reference into hoisted node_modules.
declare namespace Cloudflare {
  interface Env {
    /** Parsed by `readD1Migrations()` in vitest.config.ts (Node side). */
    TEST_MIGRATIONS: { name: string; queries: string[] }[]
    TEST_SEED: { name: string; queries: string[] }[]
    SESSION_PEPPER: string
    APP_ORIGIN: string
    PBKDF2_ITERATIONS: string
  }
}

