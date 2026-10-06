import type { SocialPlatform } from '../../lib/types'

// ============================================================================
// Social platforms, rendered from the API's contract.
//
// The list is `SOCIAL_PLATFORMS` in `apps/api/src/lib/constants.ts`, verbatim and
// in the same order: the platform IS the icon, and the server rejects anything
// outside this list with a `422`. The `satisfies` clause is the guard — if the
// server list and `SocialPlatform` (lib/types.ts) drift, this file stops
// compiling rather than shipping a select box that offers a rejected platform.
//
// Labels are display only: the wire value stays the lower-case platform, because
// that is what is stored and what the API compares against.
// ============================================================================

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
] as const satisfies readonly SocialPlatform[]

const LABELS: Record<SocialPlatform, string> = {
  website: 'Website',
  x: 'X',
  twitter: 'Twitter',
  bluesky: 'Bluesky',
  threads: 'Threads',
  mastodon: 'Mastodon',
  instagram: 'Instagram',
  facebook: 'Facebook',
  linkedin: 'LinkedIn',
  github: 'GitHub',
  gitlab: 'GitLab',
  youtube: 'YouTube',
  tiktok: 'TikTok',
  twitch: 'Twitch',
  vimeo: 'Vimeo',
  spotify: 'Spotify',
  soundcloud: 'SoundCloud',
  discord: 'Discord',
  telegram: 'Telegram',
  whatsapp: 'WhatsApp',
  reddit: 'Reddit',
  pinterest: 'Pinterest',
  dribbble: 'Dribbble',
  behance: 'Behance',
  medium: 'Medium',
  substack: 'Substack',
  patreon: 'Patreon',
  'ko-fi': 'Ko-fi',
}

/**
 * A platform's display name.
 *
 * Takes a `string`, not a `SocialPlatform`, because reads stay lenient: a row
 * holding a platform that later left the server's list still reads back whole
 * (D12), and it must render as something rather than as `undefined`.
 */
export function platformLabel(platform: string): string {
  return LABELS[platform as SocialPlatform] ?? platform
}

/** The same list, ready for a `<select>`. */
export const SOCIAL_PLATFORM_OPTIONS = SOCIAL_PLATFORMS.map((platform) => ({
  value: platform,
  label: LABELS[platform],
}))

// ---------------------------------------------------------------- the caps ---

/** `MAX_URL_LENGTH` in the API's `lib/constants.ts`. */
export const MAX_SOCIAL_URL_LENGTH = 2_048

/**
 * `MAX_SOCIAL_LINKS_PER_USER`.
 *
 * Public so the editor can stop offering the add form at the cap and say why,
 * instead of letting the API answer `400` "A profile may hold at most 20 social
 * links." after the fact. The server remains the authority: the check is a
 * courtesy, and its refusal is what the form would render.
 */
export const MAX_SOCIALS_PER_PROFILE = 20