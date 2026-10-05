import { Hono } from 'hono'
import { ok } from '../lib/http'
import { now } from '../lib/clock'
import type { AppEnv } from '../types'

// ============================================================================
// Liveness / readiness.
//
// The DB probe is worth the round trip: a misconfigured binding or an
// unapplied migration is the single most common deployment failure, and this
// turns it into an obvious 503 instead of a mysterious first-request error.
// ============================================================================

export const healthRoutes = new Hono<AppEnv>()

healthRoutes.get('/', async (c) => {
  let database: 'ok' | 'error' = 'ok'
  try {
    await c.env.DB.prepare('SELECT 1 AS ok').first()
  } catch (error) {
    database = 'error'
    console.error(
      JSON.stringify({
        level: 'error',
        msg: 'health_db_probe_failed',
        message: error instanceof Error ? error.message : String(error),
      }),
    )
  }

  return ok(
    c,
    { status: database === 'ok' ? 'ok' : 'degraded', database, time: now() },
    { status: database === 'ok' ? 200 : 503 },
  )
})
