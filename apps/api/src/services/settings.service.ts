import { now } from '../lib/clock'
import {
  DEFAULT_PLATFORM_NAME,
  DEFAULT_RESERVED_SLUGS,
  DEFAULT_RESERVED_USERNAMES,
  SETTINGS_CACHE_TTL_MS,
} from '../lib/constants'
import { badRequest, notFound } from '../lib/errors'
import { auditInsertStmt } from './audit.service'
import type { ActorInfo, Auditor, SettingRow } from '../types'

// ============================================================================
// Settings: runtime policy, editable by an owner through /admin/settings.
//
// Values are stored as TEXT with a `type` discriminator, and are parsed on read
// so callers get real booleans/numbers instead of strings.
//
// A per-isolate snapshot cache keeps the hot path (maintenance-mode check on
// every request) off D1. Writes invalidate it immediately for the isolate that
// performed them; other isolates converge within SETTINGS_CACHE_TTL_MS. For a
// single-tenant admin backend that trade-off is deliberate and cheap.
// ============================================================================

export type SettingValue = string | boolean | number | unknown

export interface SettingRecord {
  key: string
  value: SettingValue
  type: SettingRow['type']
  label: string | null
  group: string | null
  description: string | null
  isPublic: boolean
  updatedAt: number
}

export type SettingsMap = Record<string, SettingValue>

interface CacheEntry {
  rows: SettingRow[]
  loadedAt: number
}

let cache: CacheEntry | null = null

export function invalidateSettingsCache(): void {
  cache = null
}

async function loadRows(db: D1Database): Promise<SettingRow[]> {
  const age = cache ? now() - cache.loadedAt : Number.POSITIVE_INFINITY
  if (cache && age < SETTINGS_CACHE_TTL_MS) return cache.rows

  const { results } = await db.prepare('SELECT * FROM settings').all<SettingRow>()
  cache = { rows: results, loadedAt: now() }
  return results
}

export function parseSettingValue(row: SettingRow): SettingValue {
  switch (row.type) {
    case 'boolean':
      return row.value === 'true' || row.value === '1'
    case 'number': {
      const parsed = Number(row.value)
      return Number.isFinite(parsed) ? parsed : 0
    }
    case 'json':
      try {
        return JSON.parse(row.value) as unknown
      } catch {
        return null
      }
    default:
      return row.value
  }
}

function toRecord(row: SettingRow): SettingRecord {
  return {
    key: row.key,
    value: parseSettingValue(row),
    type: row.type,
    label: row.label,
    group: row.grp,
    description: row.description,
    isPublic: row.is_public === 1,
    updatedAt: row.updated_at,
  }
}

export async function getSettingsMap(db: D1Database): Promise<SettingsMap> {
  const rows = await loadRows(db)
  const map: SettingsMap = {}
  for (const row of rows) map[row.key] = parseSettingValue(row)
  return map
}

export async function getSetting<T extends SettingValue>(
  db: D1Database,
  key: string,
  fallback: T,
): Promise<T> {
  const rows = await loadRows(db)
  const row = rows.find((candidate) => candidate.key === key)
  if (!row) return fallback
  return parseSettingValue(row) as T
}

export async function getBooleanSetting(
  db: D1Database,
  key: string,
  fallback: boolean,
): Promise<boolean> {
  const value = await getSetting<boolean>(db, key, fallback)
  return typeof value === 'boolean' ? value : fallback
}

export async function getNumberSetting(
  db: D1Database,
  key: string,
  fallback: number,
): Promise<number> {
  const value = await getSetting<number>(db, key, fallback)
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback
}

export async function getStringSetting(
  db: D1Database,
  key: string,
  fallback: string,
): Promise<string> {
  const value = await getSetting<string>(db, key, fallback)
  return typeof value === 'string' ? value : fallback
}

export function platformNameOf(map: SettingsMap): string {
  const value = map['platform.name']
  return typeof value === 'string' && value.length > 0 ? value : DEFAULT_PLATFORM_NAME
}

/**
 * Usernames public sign-up may not claim.
 *
 * Falls back to the compiled-in list when the setting is missing or malformed,
 * so a broken row degrades to the safe default instead of disabling the
 * protection entirely (an empty list would allow `owner` to be registered).
 */
export function reservedUsernamesOf(map: SettingsMap): string[] {
  const value = map[SETTING_KEYS.reservedUsernames]
  if (!Array.isArray(value)) return [...DEFAULT_RESERVED_USERNAMES]

  const entries = value
    .filter((entry): entry is string => typeof entry === 'string')
    .map((entry) => entry.trim().toLowerCase())
    .filter((entry) => entry.length > 0)

  return entries.length > 0 ? entries : [...DEFAULT_RESERVED_USERNAMES]
}

/**
 * Slugs nobody may claim for a link page.
 *
 * Mirrors `reservedUsernamesOf`: falls back to the compiled-in list when the
 * setting is missing or malformed, so a broken row degrades to the safe
 * default instead of opening platform paths (`api`, `login`, `health`) to
 * squatting.
 */
export function reservedSlugsOf(map: SettingsMap): string[] {
  const value = map[SETTING_KEYS.reservedSlugs]
  if (!Array.isArray(value)) return [...DEFAULT_RESERVED_SLUGS]

  const entries = value
    .filter((entry): entry is string => typeof entry === 'string')
    .map((entry) => entry.trim().toLowerCase())
    .filter((entry) => entry.length > 0)

  return entries.length > 0 ? entries : [...DEFAULT_RESERVED_SLUGS]
}

// ── well-known keys ─────────────────────────────────────────────────────────
export const SETTING_KEYS = {
  platformName: 'platform.name',
  platformTagline: 'platform.tagline',
  supportEmail: 'platform.support_email',
  pagesBaseUrl: 'platform.pages_base_url',
  registrationOpen: 'platform.registration_open',
  maintenanceMode: 'platform.maintenance_mode',
  maintenanceMessage: 'platform.maintenance_message',
  autoFlagEnabled: 'moderation.auto_flag_enabled',
  autoFlagKeywords: 'moderation.auto_flag_keywords',
  requireReason: 'moderation.require_reason',
  reportCooldownMinutes: 'moderation.report_cooldown_minutes',
  maxLinksPerPage: 'content.max_links_per_page',
  trashRetentionDays: 'content.trash_retention_days',
  reservedSlugs: 'content.reserved_slugs',
  reservedUsernames: 'content.reserved_usernames',
  maxAppealAttempts: 'appeals.max_attempts',
  appealWindowDays: 'appeals.window_days',
  auditRetentionDays: 'audit.retention_days',
  analyticsRetentionDays: 'analytics.retention_days',
} as const

// ---------------------------------------------------------------- reading ---

export async function listSettings(
  db: D1Database,
  options: { publicOnly?: boolean } = {},
): Promise<SettingRecord[]> {
  const rows = await loadRows(db)
  const filtered = options.publicOnly ? rows.filter((row) => row.is_public === 1) : rows
  return filtered.map(toRecord)
}

/**
 * Public settings, keyed by name. This is what an unauthenticated SPA boot
 * request is allowed to see: branding + feature flags, never security policy.
 */
export async function getPublicSettings(
  db: D1Database,
): Promise<{ settings: SettingsMap; platformName: string }> {
  const records = await listSettings(db, { publicOnly: true })
  const settings: SettingsMap = {}
  for (const record of records) settings[record.key] = record.value
  return { settings, platformName: platformNameOf(settings) }
}

// ---------------------------------------------------------------- writing ---

export interface SettingPatch {
  key: string
  value: unknown
}

function coerce(row: SettingRow, value: unknown): string {
  switch (row.type) {
    case 'boolean': {
      if (typeof value === 'boolean') return value ? 'true' : 'false'
      if (value === 'true' || value === 'false') return value
      throw badRequest(`Setting "${row.key}" must be a boolean.`)
    }
    case 'number': {
      const parsed = typeof value === 'number' ? value : Number(value)
      if (!Number.isFinite(parsed)) {
        throw badRequest(`Setting "${row.key}" must be a number.`)
      }
      return String(parsed)
    }
    case 'json': {
      if (typeof value === 'string') {
        try {
          JSON.parse(value)
          return value
        } catch {
          throw badRequest(`Setting "${row.key}" must be valid JSON.`)
        }
      }
      try {
        return JSON.stringify(value)
      } catch {
        throw badRequest(`Setting "${row.key}" is not JSON-serialisable.`)
      }
    }
    default: {
      if (typeof value !== 'string') {
        throw badRequest(`Setting "${row.key}" must be a string.`)
      }
      return value
    }
  }
}

export interface UpdateSettingsResult {
  updated: SettingRecord[]
  changed: string[]
}

/**
 * Applies a patch set atomically with a single audit entry whose `before` /
 * `after` maps describe exactly what moved. Unknown keys are rejected outright
 * rather than silently created, so a typo in the SPA cannot invent policy.
 */
export async function updateSettings(
  db: D1Database,
  actor: ActorInfo,
  patches: readonly SettingPatch[],
  auditor: Auditor,
): Promise<UpdateSettingsResult> {
  if (patches.length === 0) throw badRequest('No settings supplied.')

  const rows = await loadRows(db)
  const byKey = new Map(rows.map((row) => [row.key, row]))

  const seen = new Set<string>()
  for (const patch of patches) {
    if (seen.has(patch.key)) throw badRequest(`Duplicate setting key: ${patch.key}.`)
    seen.add(patch.key)
    if (!byKey.has(patch.key)) throw notFound(`Setting "${patch.key}"`)
  }

  const timestamp = now()
  const before: Record<string, SettingValue> = {}
  const after: Record<string, SettingValue> = {}
  const statements: D1PreparedStatement[] = []
  const changed: string[] = []
  const updated: SettingRecord[] = []

  for (const patch of patches) {
    const row = byKey.get(patch.key)
    if (!row) continue

    // Snapshot BEFORE mutating in place — this is what `before` must contain.
    before[row.key] = parseSettingValue(row)
    const encoded = coerce(row, patch.value)
    if (row.value !== encoded) changed.push(row.key)

    row.value = encoded
    row.updated_at = timestamp
    row.updated_by = actor.id

    after[row.key] = parseSettingValue(row)
    updated.push(toRecord(row))

    statements.push(
      db
        .prepare('UPDATE settings SET value = ?, updated_by = ?, updated_at = ? WHERE key = ?')
        .bind(encoded, actor.id, timestamp, row.key),
    )
  }

  const entry = auditor.claim({
    action: 'settings.update',
    targetType: 'settings',
    targetLabel: changed.length === 0 ? 'no-op' : changed.join(', '),
    actorUserId: actor.id,
    actorRole: actor.role,
    actorLabel: actor.label,
    before,
    after,
    metadata: { changed },
  })

  // Single batch => the settings changes and the audit row commit together.
  statements.push(auditInsertStmt(db, entry))
  await db.batch(statements)

  invalidateSettingsCache()
  return { updated, changed }
}
