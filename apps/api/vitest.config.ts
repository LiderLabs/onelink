import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { cloudflareTest, readD1Migrations } from '@cloudflare/vitest-plugin'
import { defineConfig } from 'vitest/config'

const root = path.dirname(fileURLToPath(import.meta.url))

/**
 * `cloudflareTest()` is a Vite plugin (vitest v4). It boots a Miniflare
 * instance from `wrangler.jsonc`, so tests exercise the real D1/R2 bindings in
 * the real Workers runtime, with isolated storage per test file.
 *
 * Both the schema and the platform defaults are applied to the test database so
 * tests run against the same starting state as a real deployment — including
 * the `rate_limits` and `email_templates` rows the services depend on.
 */
export default defineConfig(async () => {
  const schema = await readD1Migrations(path.join(root, 'migrations'))
  const seed = await readD1Migrations(path.join(root, 'seed'))

  return {
    plugins: [
      cloudflareTest({
        wrangler: { configPath: './wrangler.jsonc' },
        miniflare: {
          bindings: {
            ENVIRONMENT: 'test',
            APP_ORIGIN: 'http://localhost:5173',
            SESSION_PEPPER: 'test-pepper-not-a-real-secret',
            // Keep PBKDF2 cheap in tests: hundreds of derivations happen across
            // the suite and the cost is the only thing that would make it slow.
            // This is why a platform-incompatible default is invisible here —
            // test/unit.lib.spec.ts separately derives one hash at the real
            // production cost to prove the default is computable on workerd.
            PBKDF2_ITERATIONS: '10000',
            TEST_MIGRATIONS: schema,
            TEST_SEED: seed,
          },
        },
      }),
    ],
    test: {
      setupFiles: ['./test/apply-migrations.ts'],
      include: ['test/**/*.spec.ts'],
      testTimeout: 20_000,
    },
  }
})

