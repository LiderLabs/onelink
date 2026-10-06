import { describe, expect, it } from 'vitest'
import { ULID_REGEX, isUlid, ulid } from '../src/lib/ids'
import {
  DEFAULT_PBKDF2_ITERATIONS,
  MAX_SUPPORTED_ITERATIONS,
  MIN_ACCEPTED_ITERATIONS,
  base64ToBytes,
  bytesToBase64,
  constantTimeEqual,
  hashPassword,
  hashToken,
  parsePasswordHash,
  randomToken,
  verifyPassword,
} from '../src/lib/crypto'
import {
  chunk,
  likeContains,
  parsePagination,
  placeholders,
  resolveSort,
  totalPagesFor,
} from '../src/lib/query'
import { humanizeDuration, isExpired, toIso } from '../src/lib/clock'
import { DEFAULT_RESERVED_SLUGS } from '../src/lib/constants'
import { SETTING_KEYS, parseSettingValue, reservedSlugsOf } from '../src/services/settings.service'
import {
  assertCanEditUser,
  assertCanGrantRole,
  assertCanModerateUser,
  can,
  capabilitiesOf,
  outranks,
} from '../src/lib/rbac'
import { renderTemplate } from '../src/services/email.service'
import type { SettingRow } from '../src/types'

// ============================================================================
// Pure unit tests — no D1, no HTTP.
// ============================================================================

describe('ULID', () => {
  it('produces a 26-character Crockford Base32 id', () => {
    const id = ulid()
    expect(id).toHaveLength(26)
    expect(ULID_REGEX.test(id)).toBe(true)
    expect(isUlid(id)).toBe(true)
  })

  it('rejects malformed ids', () => {
    // `I`, `L`, `O` and `U` are excluded from Crockford Base32.
    expect(isUlid('01ARZ3NDEKTSV4RRFFQ69G5FAI')).toBe(false)
    expect(isUlid('too-short')).toBe(false)
    expect(isUlid(12345)).toBe(false)
  })

  it('sorts lexicographically in timestamp order', () => {
    const early = ulid(1_700_000_000_000)
    const later = ulid(1_700_000_001_000)
    expect(early < later).toBe(true)
  })

  it('does not collide across many draws', () => {
    const ids = new Set(Array.from({ length: 2_000 }, () => ulid()))
    expect(ids.size).toBe(2_000)
  })
})

describe('password hashing', () => {
  it('verifies a correct password', async () => {
    const stored = await hashPassword('a-very-good-password', 10_000)
    const result = await verifyPassword('a-very-good-password', stored, 10_000)
    expect(result.ok).toBe(true)
    expect(result.needsRehash).toBe(false)
  })

  it('rejects an incorrect password', async () => {
    const stored = await hashPassword('a-very-good-password', 10_000)
    const result = await verifyPassword('not-the-password', stored, 10_000)
    expect(result.ok).toBe(false)
  })

  it('embeds the algorithm, iteration count and base64 salt/hash', async () => {
    const stored = await hashPassword('a-very-good-password', 12_345)
    const parts = stored.split('$')
    expect(parts).toHaveLength(5)
    expect(parts[0]).toBe('pbkdf2')
    expect(parts[1]).toBe('sha256')
    expect(parts[2]).toBe('12345')

    const parsed = parsePasswordHash(stored)
    expect(parsed).not.toBeNull()
    expect(parsed?.salt).toHaveLength(16)
    expect(parsed?.hash).toHaveLength(32)
  })

  it('produces a different hash each time (random salt)', async () => {
    const a = await hashPassword('same-password', 10_000)
    const b = await hashPassword('same-password', 10_000)
    expect(a).not.toBe(b)
    expect((await verifyPassword('same-password', b, 10_000)).ok).toBe(true)
  })

  it('fails closed on an under-iterated hash', () => {
    // Below MIN_ACCEPTED_ITERATIONS the hash must not be usable at all.
    const weak = `pbkdf2$sha256$${MIN_ACCEPTED_ITERATIONS - 1}$AAAA$BBBB`
    expect(parsePasswordHash(weak)).toBeNull()
  })

  it('fails closed on malformed input', () => {
    expect(parsePasswordHash('not-a-hash')).toBeNull()
    expect(parsePasswordHash('md5$sha1$1000$AAAA$BBBB')).toBeNull()
    expect(parsePasswordHash('')).toBeNull()
  })

  it('reports needsRehash when the stored cost is lower than the target', async () => {
    const stored = await hashPassword('a-very-good-password', 10_000)
    const result = await verifyPassword('a-very-good-password', stored, 99_999)
    expect(result.ok).toBe(true)
    expect(result.needsRehash).toBe(true)
  })

  it('treats a missing or null hash as a failed verification', async () => {
    expect((await verifyPassword('whatever', null)).ok).toBe(false)
    expect((await verifyPassword('whatever', undefined)).ok).toBe(false)
  })

  it('fails closed on a hash above the runtime ceiling', () => {
    // workerd cannot derive more than MAX_SUPPORTED_ITERATIONS, so such a hash
    // is unverifiable: reject it here instead of throwing out of deriveBits.
    const tooStrong = `pbkdf2$sha256$${MAX_SUPPORTED_ITERATIONS + 1}$AAAA$BBBB`
    expect(parsePasswordHash(tooStrong)).toBeNull()
    expect(parsePasswordHash(`pbkdf2$sha256$${MAX_SUPPORTED_ITERATIONS}$AAAA$BBBB`)).not.toBeNull()
  })

  it('ships a default cost the runtime can actually compute', async () => {
    // Regression guard. The suite is deliberately cheap (vitest.config.ts pins
    // PBKDF2_ITERATIONS to 10 000), so a default the platform rejects used to go
    // unnoticed here while 500ing every login on the deployed Worker: workerd's
    // WebCrypto refuses PBKDF2 above 100 000 iterations. Assert the bound AND
    // derive a hash at the real production cost, in the real runtime.
    expect(DEFAULT_PBKDF2_ITERATIONS).toBeLessThanOrEqual(MAX_SUPPORTED_ITERATIONS)
    expect(DEFAULT_PBKDF2_ITERATIONS).toBeGreaterThanOrEqual(MIN_ACCEPTED_ITERATIONS)

    const stored = await hashPassword('correct horse battery staple')
    expect(stored).toContain(`$${DEFAULT_PBKDF2_ITERATIONS}$`)
    const result = await verifyPassword('correct horse battery staple', stored)
    expect(result.ok).toBe(true)
    expect(result.needsRehash).toBe(false)
  })
})

describe('token hashing', () => {
  it('is deterministic for the same token and pepper', async () => {
    const a = await hashToken('token-value', 'pepper')
    const b = await hashToken('token-value', 'pepper')
    expect(a).toBe(b)
    expect(a).toHaveLength(64) // sha256 hex
  })

  it('changes when the pepper changes', async () => {
    const a = await hashToken('token-value', 'pepper-one')
    const b = await hashToken('token-value', 'pepper-two')
    expect(a).not.toBe(b)
  })

  it('produces url-safe, unpadded random tokens', () => {
    const token = randomToken(32)
    expect(token).toMatch(/^[A-Za-z0-9_-]+$/)
    expect(token).not.toContain('=')
    expect(randomToken(32)).not.toBe(token)
  })
})

describe('base64 + constant-time compare', () => {
  it('round-trips arbitrary bytes', () => {
    const bytes = new Uint8Array([0, 1, 127, 128, 255, 42])
    const encoded = bytesToBase64(bytes)
    expect(Array.from(base64ToBytes(encoded))).toEqual(Array.from(bytes))
  })

  it('compares equal and unequal values correctly', async () => {
    expect(await constantTimeEqual('abc', 'abc')).toBe(true)
    expect(await constantTimeEqual('abc', 'abd')).toBe(false)
    // Different lengths must not throw.
    expect(await constantTimeEqual('abc', 'abcdefghij')).toBe(false)
  })
})

describe('query helpers', () => {
  it('escapes LIKE metacharacters', () => {
    expect(likeContains('100%')).toBe('%100\\%%')
    expect(likeContains('a_b')).toBe('%a\\_b%')
    expect(likeContains('back\\slash')).toBe('%back\\\\slash%')
    expect(likeContains('  spaced  ')).toBe('%spaced%')
  })

  it('caps the LIKE term length for D1', () => {
    const pattern = likeContains('x'.repeat(200))
    expect(pattern.length).toBeLessThanOrEqual(42)
  })

  it('clamps pagination into range', () => {
    expect(parsePagination({ page: '3', limit: '10' })).toEqual({ page: 3, limit: 10, offset: 20 })
    expect(parsePagination({ page: '0', limit: '0' })).toEqual({ page: 1, limit: 1, offset: 0 })
    expect(parsePagination({ page: '-5', limit: '9999' })).toEqual({ page: 1, limit: 100, offset: 0 })
    expect(parsePagination({ page: 'nonsense', limit: undefined }).page).toBe(1)
  })

  it('maps arbitrary sort input onto a whitelisted fragment', () => {
    const allowed = { newest: 'created_at DESC', oldest: 'created_at ASC' }
    const asc = { created_at: 'created_at ASC', '-created_at': 'created_at DESC' }

    expect(resolveSort('oldest', allowed, 'newest')).toBe('created_at ASC')
    expect(resolveSort('-created_at', asc, 'created_at')).toBe('created_at DESC')

    // This is an EXACT-MATCH whitelist: anything not a literal key falls back,
    // which is what keeps the `ORDER BY` string unreachable from user input.
    expect(resolveSort('created_at:asc', allowed, 'newest')).toBe('created_at DESC')
    expect(resolveSort('id; DROP TABLE users', allowed, 'newest')).toBe('created_at DESC')
    expect(resolveSort(undefined, allowed, 'newest')).toBe('created_at DESC')
    expect(resolveSort('  oldest  ', allowed, 'newest')).toBe('created_at ASC')
  })

  it('builds placeholder lists and chunks', () => {
    expect(placeholders(3)).toBe('?,?,?')
    expect(() => placeholders(0)).toThrow()
    expect(chunk([1, 2, 3, 4, 5], 2)).toEqual([[1, 2], [3, 4], [5]])
  })

  it('computes total pages', () => {
    expect(totalPagesFor(0, 25)).toBe(0)
    expect(totalPagesFor(1, 25)).toBe(1)
    expect(totalPagesFor(51, 25)).toBe(3)
  })
})

describe('clock helpers', () => {
  it('formats epoch-ms as ISO and handles null', () => {
    expect(toIso(1_700_000_000_000)).toBe('2023-11-14T22:13:20.000Z')
    expect(toIso(null)).toBeNull()
    expect(toIso(undefined)).toBeNull()
  })

  it('detects expiry', () => {
    expect(isExpired(1_000, 2_000)).toBe(true)
    expect(isExpired(3_000, 2_000)).toBe(false)
    expect(isExpired(null, 2_000)).toBe(false)
  })

  it('humanises durations', () => {
    expect(humanizeDuration(60 * 60 * 1000)).toBe('1h')
    expect(humanizeDuration(90 * 1000)).toBe('2m')
  })
})

describe('settings value parsing', () => {
  const row = (type: SettingRow['type'], value: string): SettingRow => ({
    key: 'k',
    value,
    type,
    label: null,
    grp: null,
    description: null,
    is_public: 0,
    updated_by: null,
    updated_at: 0,
  })

  it('parses by declared type', () => {
    expect(parseSettingValue(row('boolean', 'true'))).toBe(true)
    expect(parseSettingValue(row('boolean', 'false'))).toBe(false)
    expect(parseSettingValue(row('number', '42'))).toBe(42)
    expect(parseSettingValue(row('number', 'nonsense'))).toBe(0)
    expect(parseSettingValue(row('string', 'hello'))).toBe('hello')
    expect(parseSettingValue(row('json', '["a","b"]'))).toEqual(['a', 'b'])
    expect(parseSettingValue(row('json', '{not json'))).toBeNull()
  })
})

describe('reserved slug policy', () => {
  it('reserves the console namespace the SPA owns (S3)', () => {
    // /app/* is the admin console. A link page claiming `app` would shadow the
    // console for anyone who follows that link, so the namespace is reserved
    // rather than merely unreserved-by-omission.
    expect(DEFAULT_RESERVED_SLUGS).toContain('app')
  })

  it('keeps the shipped list normalised and duplicate-free', () => {
    // Slugs reach the comparison already normalised (lower-cased) and are
    // matched with `includes`, so an upper-case entry, a stray space or a
    // duplicate would be silently dead policy rather than a loud failure.
    expect(DEFAULT_RESERVED_SLUGS).toEqual([...new Set(DEFAULT_RESERVED_SLUGS)])
    for (const slug of DEFAULT_RESERVED_SLUGS) expect(slug).toBe(slug.toLowerCase())
  })

  it('falls back to the shipped list when the setting is missing or unusable', () => {
    // The setting is owner-editable at runtime, so a missing row, a wrong type
    // and an empty array must all degrade to the compiled-in list: an empty
    // policy would let the next page squat `login` or `api`.
    const withSetting = (value: unknown): string[] =>
      reservedSlugsOf({ [SETTING_KEYS.reservedSlugs]: value })

    expect(withSetting(undefined)).toContain('app')
    expect(withSetting('not-an-array')).toContain('app')
    expect(withSetting([])).toContain('app')
  })

  it('uses the stored list once it holds at least one usable entry', () => {
    const map = { [SETTING_KEYS.reservedSlugs]: [' Login ', '', 42, 'SIGNUP'] }
    // Trimmed and lower-cased, non-strings dropped. `app` is then NOT reserved,
    // which is the owner's call to make by replacing the seeded list.
    expect(reservedSlugsOf(map)).toEqual(['login', 'signup'])
  })
})

describe('email template rendering', () => {
  it('substitutes placeholders', () => {
    expect(
      renderTemplate('Hi {{name}}, welcome to {{platform}}.', {
        name: 'Ada',
        platform: 'OneLink',
      }),
    ).toBe('Hi Ada, welcome to OneLink.')
  })

  it('tolerates whitespace inside the braces', () => {
    expect(renderTemplate('Hi {{  name  }}', { name: 'Ada' })).toBe('Hi Ada')
  })

  it('leaves unknown placeholders visible rather than blanking them', () => {
    // A template referencing a variable the caller forgot should be OBVIOUS.
    expect(renderTemplate('Hi {{missing}}', {})).toBe('Hi {{missing}}')
  })
})

describe('authorisation rank rules', () => {
  const actor = (role: 'owner' | 'admin' | 'moderator' | 'support' | 'user') => ({
    id: `actor-${role}`,
    role,
  })

  it('outranks only strictly more senior roles', () => {
    expect(outranks(actor('admin'), { id: 't', role: 'moderator' })).toBe(true)
    expect(outranks(actor('admin'), { id: 't', role: 'admin' })).toBe(false)
    expect(outranks(actor('moderator'), { id: 't', role: 'user' })).toBe(true)
  })

  it('lets an owner moderate a peer owner but nobody else', () => {
    expect(() =>
      assertCanModerateUser({ id: 'a', role: 'owner' }, { id: 'b', role: 'owner' }),
    ).not.toThrow()
    expect(() =>
      assertCanModerateUser({ id: 'a', role: 'admin' }, { id: 'b', role: 'admin' }),
    ).toThrow()
    expect(() =>
      assertCanModerateUser({ id: 'a', role: 'moderator' }, { id: 'b', role: 'moderator' }),
    ).toThrow()
  })

  it('refuses self-moderation', () => {
    expect(() =>
      assertCanModerateUser({ id: 'same', role: 'owner' }, { id: 'same', role: 'owner' }),
    ).toThrow(/own account/)
  })

  it('refuses moderation of a more senior account', () => {
    expect(() =>
      assertCanModerateUser({ id: 'a', role: 'moderator' }, { id: 'b', role: 'admin' }),
    ).toThrow()
  })

  it('allows a peer to be edited but not moderated', () => {
    expect(() =>
      assertCanEditUser({ id: 'a', role: 'admin' }, { id: 'b', role: 'admin' }),
    ).not.toThrow()
    expect(() =>
      assertCanEditUser({ id: 'a', role: 'support' }, { id: 'b', role: 'admin' }),
    ).toThrow()
  })

  it('refuses to grant a role at or above the actor rank', () => {
    expect(() => assertCanGrantRole(actor('admin'), 'moderator')).not.toThrow()
    expect(() => assertCanGrantRole(actor('admin'), 'admin')).toThrow()
    expect(() => assertCanGrantRole(actor('admin'), 'owner')).toThrow()
    expect(() => assertCanGrantRole(actor('owner'), 'owner')).toThrow()
  })

  it('gives admin everything except settings.update and users.role.assign', () => {
    const admin = capabilitiesOf('admin')
    expect(admin).toContain('users.delete')
    expect(admin).toContain('audit.read')
    expect(admin).not.toContain('settings.update')
    expect(admin).not.toContain('users.role.assign')
    expect(can('owner', 'settings.update')).toBe(true)
    expect(can('owner', 'users.role.assign')).toBe(true)
  })

  it('gives a plain user no capabilities at all', () => {
    expect(capabilitiesOf('user')).toHaveLength(0)
    expect(can('user', 'users.read')).toBe(false)
  })

  it('does not grant moderators settings or user creation', () => {
    expect(can('moderator', 'settings.read')).toBe(false)
    expect(can('moderator', 'users.create')).toBe(false)
    expect(can('moderator', 'users.sanction')).toBe(true)
    expect(can('moderator', 'audit.read')).toBe(false)
  })
})

