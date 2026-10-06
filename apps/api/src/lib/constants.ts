// ============================================================================
// Shared constants. Single source of truth for enums that also appear in the
// SQL CHECK constraints in migrations/0001_init.sql — keep the two in sync.
// ============================================================================

export const MINUTE = 60_000
export const HOUR = 60 * MINUTE
export const DAY = 24 * HOUR

// ---------------------------------------------------------------- identity --
export const ROLES = ['owner', 'admin', 'moderator', 'support', 'user'] as const
export type Role = (typeof ROLES)[number]

/**
 * Usernames nobody may claim through public sign-up.
 *
 * Public registration hands the choice of username to anonymous visitors, so
 * without this list anyone could register `owner` and either squat the address
 * of a staff account or comfortably impersonate one. `scripts/seed-owner.mjs`
 * derives the owner's username from the email local part, so this list also
 * guards that: if the configured local part were reserved the script would
 * fail on the unique index instead of being quietly hijacked.
 *
 * Stored as JSON in `content.reserved_usernames` (seed/0001_platform-defaults.sql)
 * so an owner can extend it at runtime; keep the two lists in sync. Compared
 * case-insensitively, after normalisation.
 */
export const DEFAULT_RESERVED_USERNAMES = [
  'owner',
  'admin',
  'administrator',
  'root',
  'system',
  'sysadmin',
  'staff',
  'support',
  'help',
  'moderator',
  'security',
  'abuse',
  'billing',
  'postmaster',
  'webmaster',
  'noreply',
  'no-reply',
  'mail',
  'email',
  'api',
  'onelink',
  'official',
  'me',
  'settings',
  'login',
  'logout',
  'register',
  'signup',
  'dashboard',
  'account',
  'anonymous',
  'guest',
  'null',
  'undefined',
] as const

/**
 * Slugs nobody may claim for a link page.
 *
 * Guarded for the same reason as reserved usernames: a freshly seeded page
 * must never be able to squat a path the platform itself serves (`api`,
 * `login`, `health` …) or a page an administrator deleted (`slug_reservations`).
 * Stored as JSON in `content.reserved_slugs`
 * (seed/0001_platform-defaults.sql) so an owner can extend it at runtime; keep
 * the two lists in sync. Compared case-insensitively, after normalisation.
 */
export const DEFAULT_RESERVED_SLUGS = [
  'admin',
  'api',
  // Console namespace (S3): the SPA console lives under /app/*, so /app and
  // everything beneath it is unreachable to a user-chosen slug forever.
  'app',
  'settings',
  'login',
  'logout',
  'signup',
  'register',
  'dashboard',
  'about',
  'terms',
  'privacy',
  'support',
  'help',
  'static',
  'assets',
  'health',
  'favicon.ico',
  'robots.txt',
  'sitemap.xml',
] as const

/**
 * Higher = more privileged. Authorisation requires a *strictly* higher rank to
 * act on someone, so peers can never sanction each other.
 */
export const ROLE_RANK: Record<Role, number> = {
  owner: 50,
  admin: 40,
  moderator: 30,
  support: 20,
  user: 10,
}

/** Everyone whose job is moderation/administration (i.e. can reach /admin). */
export const STAFF_ROLES = ['owner', 'admin', 'moderator', 'support'] as const

export const USER_STATUSES = [
  'active',
  'pending',
  'suspended',
  'banned',
  'deleted',
] as const
export type UserStatus = (typeof USER_STATUSES)[number]

// ------------------------------------------------------------------ session --
/**
 * `__Host-` prefix: the browser refuses to set it unless it is Secure, has
 * Path=/, and carries no Domain attribute. That makes subdomain cookie
 * injection impossible. Requires HTTPS (localhost counts as a secure context).
 */
export const SESSION_COOKIE_NAME = '__Host-onelink_session'

/** The lifetime a freshly minted session is given, and its sliding window. */
export const SESSION_TTL_MS = 8 * HOUR
/**
 * Hard ceiling on TOTAL session age, counted from creation. It is set to the
 * same value as the window above, so a session is never renewed: it ends eight
 * hours after it was minted regardless of how much it is used.
 */
export const SESSION_ABSOLUTE_TTL_MS = 8 * HOUR
/** Throttle: activity extends the window this often, never past the ceiling. */
export const SESSION_TOUCH_AFTER_MS = 5 * MINUTE

export const PASSWORD_RESET_TTL_MS = 60 * MINUTE
export const INVITATION_TTL_MS = 7 * DAY

// --------------------------------------------------------------- passwords --
export const MIN_PASSWORD_LENGTH = 8
export const MAX_PASSWORD_LENGTH = 200
export const MAX_FAILED_LOGINS = 10
export const LOCKOUT_MS = 15 * MINUTE

// -------------------------------------------------------------- pagination --
export const DEFAULT_PAGE_SIZE = 25
export const MAX_PAGE_SIZE = 100

// ------------------------------------------------------------------- cache --
/** How long the settings snapshot stays cached inside a Worker isolate. */
export const SETTINGS_CACHE_TTL_MS = 30_000
/** How long rate-limit rule rows stay cached inside a Worker isolate. */
export const RATE_LIMIT_CONFIG_TTL_MS = 60_000

// ---------------------------------------------------------------- defaults --
export const DEFAULT_PLATFORM_NAME = 'OneLink'
export const MAX_LINKS_PER_PAGE_HARD_CAP = 200
export const MAX_NOTE_LENGTH = 4_000
export const MAX_REASON_LENGTH = 1_000
export const MAX_URL_LENGTH = 2_048
export const MAX_SLUG_LENGTH = 48

// ---------------------------------------------------------------- identity caps --
/**
 * Write caps for a profile (D12).
 *
 * STRICT ON WRITE, LENIENT ON READ: these bound what an owner may SAVE. Rows
 * written before the caps existed may exceed them — up to the pre-R1.1 limits of
 * 80/500, which `user.service.ts` still uses on the staff-edit path — and are
 * read back verbatim rather than truncated, because silently shortening somebody's
 * bio on the way out is a data-loss bug disguised as validation.
 */
export const MAX_DISPLAY_NAME_LENGTH = 50
export const MAX_BIO_LENGTH = 160

/**
 * `location` and `pronouns` (R1.2).
 *
 * The spec pins only `displayName` (50) and `bio` (160); these two are ours. Both
 * are deliberately small because both render as a single line beside the display
 * name — on a public page and in a link preview — so a longer value would be
 * clipped by every consumer anyway. Same rule as above: strict on write, lenient
 * on read, never truncated on the way out.
 */
export const MAX_LOCATION_LENGTH = 100
export const MAX_PRONOUNS_LENGTH = 40

/**
 * Platforms a profile social link may claim (R1.2).
 *
 * Same shape of policy as `DEFAULT_RESERVED_SLUGS`: a compiled-in list applied in
 * two places — the zod schema (`validation/profile.schema.ts`), which is what
 * turns an unknown platform into a `422`, and the service
 * (`services/profile.service.ts`), which re-checks it as the last line of
 * defence for a caller that skips the schema. 0003 creates `user_social_links`
 * as a STRICT table, so this enum *could* have been a CHECK — but 0003 also
 * ALTERs `users`, and the rule settled by `0002`'s `layout` is that an enum
 * arriving with a migration lives in code, never in SQL.
 *
 * Lower-cased, and compared after normalisation. Deliberately NOT seeded into
 * `settings`, unlike the two reserved lists: a platform is a rendering contract
 * (a name and an icon shipped in `apps/web`), not policy an owner tunes, so
 * widening this list is a code change by design. Narrowing it is not supported
 * either — a row holding a platform that later left this list still reads back
 * whole, because reads stay lenient.
 */
export const SOCIAL_PLATFORMS = [
  'website',
  'x',
  'twitter',
  'bluesky',
  'threads',
  'mastodon',
  'instagram',
  'facebook',
  'linkedin',
  'github',
  'gitlab',
  'youtube',
  'tiktok',
  'twitch',
  'vimeo',
  'spotify',
  'soundcloud',
  'discord',
  'telegram',
  'whatsapp',
  'reddit',
  'pinterest',
  'dribbble',
  'behance',
  'medium',
  'substack',
  'patreon',
  'ko-fi',
] as const

export type SocialPlatform = (typeof SOCIAL_PLATFORMS)[number]

/**
 * How many social links one profile may hold (R1.2).
 *
 * The profile is a short list of places to find a person, and this API is its
 * only writer, so the cap is what keeps an authenticated write surface from
 * turning one account into an unbounded link farm. `MAX_LINKS_PER_PAGE_HARD_CAP`
 * is the same idea one level up; this one has no settings row because nothing has
 * asked to tune it yet.
 */
export const MAX_SOCIAL_LINKS_PER_USER = 20
