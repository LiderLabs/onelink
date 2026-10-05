import { beforeEach } from 'vitest'
import { env } from 'cloudflare:workers'
import { resetDatabase } from './helpers'

// Applies the schema, then the platform defaults, to the test-local D1 database
// before the suite runs. Storage is isolated per test file by the workers pool.
//
// `readD1Migrations()` (Node side, in vitest.config.ts) has already split each
// file into individual statements, so this is the same statement stream
// `wrangler d1 migrations apply` / `d1 execute --file` produce — just executed
// directly instead of via the deprecated `cloudflare:test` helper.
async function apply(statements: { name: string; queries: string[] }[]): Promise<void> {
  for (const file of statements) {
    if (file.queries.length === 0) continue
    await env.DB.batch(file.queries.map((query) => env.DB.prepare(query)))
  }
}

await apply(env.TEST_MIGRATIONS)
await apply(env.TEST_SEED)



// Every test starts from the post-seed state. Registered here rather than in
// each spec so a new spec cannot forget it and silently inherit another file's
// rows — which shows up as a nonsense failure in the code under test.
beforeEach(resetDatabase)

