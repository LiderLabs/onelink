import { createMiddleware } from 'hono/factory'
import { RATE_LIMIT_CONFIG_TTL_MS } from '../lib/constants'
import { now } from '../lib/clock'
import { rateLimited } from '../lib/errors'
import { getClientIp } from '../lib/http'
import type { AppEnv, RateLimitRow } from '../types'

// ============================================================================
// Rate limiting.
//
// HONEST LIMITATION — read this before relying on it:
//
//   Counters live in a per-isolate in-memory Map. Cloudflare runs many isolates
//   across many locations, so the effective limit over a window is roughly
//   `max_requests x isolates`, not `max_requests`. That is adequate for the
//   actual job here — blunting credential stuffing and runaway loops against a
//   single-tenant admin backend — but it is NOT a hard quota.
//
//   The upgrade path, when a hard limit is genuinely needed, is a Durable
//   Object per key. The `RateLimiter` interface below exists so that only this
//   file changes when that happens.
//
// The RULES (limit / window / scope / action) live in the `rate_limits` table,
// so an owner can tune them without a deploy.
// ============================================================================

interface Bucket {
  count: number
  resetAt: number
}

const buckets = new Map<string, Bucket>()

/** Guard against unbounded memory growth if an attacker sprays unique keys. */
const MAX_BUCKETS = 10_000

interface RulesCache {
  rules: Map<string, RateLimitRow>
  loadedAt: number
}

let rulesCache: RulesCache | null = null

export function invalidateRateLimitCache(): void {
  rulesCache = null
}

async function loadRules(db: D1Database): Promise<Map<string, RateLimitRow>> {
  const age = rulesCache ? now() - rulesCache.loadedAt : Number.POSITIVE_INFINITY
  if (rulesCache && age < RATE_LIMIT_CONFIG_TTL_MS) return rulesCache.rules

  const { results } = await db.prepare('SELECT * FROM rate_limits').all<RateLimitRow>()
  const rules = new Map(results.map((row) => [row.key, row]))
  rulesCache = { rules, loadedAt: now() }
  return rules
}

export interface RateLimitDecision {
  allowed: boolean
  limit: number
  remaining: number
  resetAt: number
}

export interface RateLimiter {
  check(
    rule: RateLimitRow,
    identity: string,
    cost: number,
  ): Promise<RateLimitDecision | null>
}

export const inMemoryRateLimiter: RateLimiter = {
  async check(rule, identity, cost) {
    const timestamp = now()
    const bucketKey = `${rule.key}:${identity}`

    // Opportunistic sweep, only once the map has grown past the cap.
    if (buckets.size > MAX_BUCKETS) {
      for (const [key, bucket] of buckets) {
        if (bucket.resetAt <= timestamp) buckets.delete(key)
      }
      if (buckets.size > MAX_BUCKETS) buckets.clear()
    }

    let bucket = buckets.get(bucketKey)
    if (!bucket || bucket.resetAt <= timestamp) {
      bucket = { count: 0, resetAt: timestamp + rule.window_seconds * 1000 }
      buckets.set(bucketKey, bucket)
    }

    bucket.count += cost

    return {
      allowed: bucket.count <= rule.max_requests,
      limit: rule.max_requests,
      remaining: Math.max(0, rule.max_requests - bucket.count),
      resetAt: bucket.resetAt,
    }
  },
}

/** Test helper: drops every counter so suites cannot leak state into each other. */
export function resetRateLimitBuckets(): void {
  buckets.clear()
}

function identityFor(
  userId: string | null,
  ip: string | null,
  scope: RateLimitRow['scope'],
): string {
  if (scope === 'global') return 'global'
  if (scope === 'user') return ['u', userId ?? 'anon', 'ip', ip ?? 'unknown'].join(':')
  return `ip:${ip ?? 'unknown'}`
}

export interface RateLimitOptions {
  /** Swap in a different implementation (e.g. a Durable Object) for a route. */
  limiter?: RateLimiter
  cost?: number
  /** Media uploads refuse a depleted throttle budget with a retry hint. */
  rejectThrottle?: boolean
}

export const rateLimit = (ruleKey: string, options: RateLimitOptions = {}) =>
  createMiddleware<AppEnv>(async (c, next) => {
    const rules = await loadRules(c.env.DB)
    const rule = rules.get(ruleKey)
    if (!rule || rule.enabled !== 1) return next()

    const limiter = options.limiter ?? inMemoryRateLimiter
    const identity = identityFor(c.get('user')?.id ?? null, getClientIp(c), rule.scope)
    const decision = await limiter.check(rule, identity, options.cost ?? 1)

    if (!decision) return next()

    c.header('x-ratelimit-limit', String(decision.limit))
    c.header('x-ratelimit-remaining', String(decision.remaining))
    c.header('x-ratelimit-reset', String(Math.ceil(decision.resetAt / 1000)))

    if (!decision.allowed && (rule.action === 'block' || (rule.action === 'throttle' && options.rejectThrottle))) {
      const retryAfter = Math.max(1, Math.ceil((decision.resetAt - now()) / 1000))
      throw rateLimited(`Too many requests. Try again in ${retryAfter}s.`, retryAfter)
    }

    // `throttle` and `captcha` actions surface the headers but do not reject —
    // implementing either properly needs more than a counter.
    await next()
  })
