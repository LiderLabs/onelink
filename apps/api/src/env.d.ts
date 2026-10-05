// `wrangler types` generates the binding + `vars` surface from wrangler.jsonc
// into worker-configuration.d.ts, as BOTH `Cloudflare.Env` and the legacy
// `CloudflareBindings` alias. Secrets live in .dev.vars (local) and
// `wrangler secret put` (remote), so Wrangler cannot see them and they are
// declared here instead.
//
// The whole codebase uses `Cloudflare.Env` as the single binding type — that is
// the documented augmentation target, and it already carries every binding via
// `extends __BaseEnv_CloudflareBindings`.
//
// Keep this list in sync with .dev.vars.example.
declare namespace Cloudflare {
  interface Env {
    /** Server-side pepper mixed into every session/reset/invitation token hash. */
    SESSION_PEPPER: string
    /** Origin of the admin SPA; used for CORS in development. */
    APP_ORIGIN: string
    /**
     * Optional override of the PBKDF2 iteration count. Lower it on the Workers
     * free plan (10 ms CPU/request) — see src/lib/crypto.ts.
     */
    PBKDF2_ITERATIONS?: string
  }
}

