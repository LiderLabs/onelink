import type { MediaKind } from './constants'

// ============================================================================
// Where a media object lives, and how it is addressed (R1.3).
//
// Two decisions are made here, and both are contracts the rest of the API leans on.
//
// **1. The key is built, never received.** `avatars/{userId}/{ulid}.webp` — the
// owner's id first, so two accounts uploading the same filename can never collide,
// and so no account can reach into another's namespace even by guessing a name. The
// uploaded filename is a label on the audit row and appears in no path.
//
// **2. The URL *is* the key.** `url` and `avatarUrl` are `/api/v1/media/<key>`,
// a root-relative path. The console and the public page are served from the same
// origin as this API by design (one origin is what `__Host-` cookies and
// `APP_ORIGIN` require), so a relative URL is correct in development, in tests and
// in production with no configuration at all — and it is derivable from a stored
// key by a pure function, which is what lets `toApiUser` build `avatarUrl` without
// a database read per user in a listing.
//
// Deriving a URL from a key is also what keeps the door open: moving the public
// bucket to an R2 custom domain later changes `mediaUrlFor` and nothing else, since
// nothing else knows the shape of a media URL.
//
// The serving route is public — an avatar is on a public page (R1.7) — so the
// whitelist below is the only thing standing between a URL and the bucket. It is a
// whitelist and not a blacklist on purpose: a key that does not match this shape is
// not served, whether it names private evidence, a future prefix, or a path that
// merely looks like one of ours.
// ============================================================================

export const MEDIA_URL_PREFIX = '/api/v1/media'

/** The storage root of each kind — the first segment of every key this API mints. */
const KEY_ROOTS: Record<MediaKind, string> = {
  avatar: 'avatars',
  page_image: 'page-images',
}

/** One owner segment: a user id. Bounded and character-restricted; never a path. */
const OWNER_SEGMENT = '[A-Za-z0-9_-]{1,64}'
/** Mirrors `ULID_REGEX` in `lib/ids.ts` — the same id the row and the object share. */
const ID_SEGMENT = '[0-9A-HJKMNP-TV-Z]{26}'
/** Mirrors `IMAGE_MIME_TYPES` in `lib/image.ts`; kept as a literal so a regex is readable. */
const EXTENSION_SEGMENT = '(?:webp|png|jpg|gif)'

const KEY_SHAPE = `${OWNER_SEGMENT}/${ID_SEGMENT}\\.${EXTENSION_SEGMENT}`
const KEY_ROOT_ALTERNATION = Object.values(KEY_ROOTS).join('|')

/**
 * Every key this API will serve from `PUBLIC_BUCKET`.
 *
 * Anchored, and closed over the two roots and the four extensions, so
 * `report_evidence/…`, `avatars/../../report_evidence/…` and a bare
 * `some/other/object.webp` are all simply not ours.
 */
export const MEDIA_KEY_PATTERN = new RegExp(`^(?:${KEY_ROOT_ALTERNATION})/${KEY_SHAPE}$`)

/** The same shape, narrowed to the one kind an avatar field may name. */
export const AVATAR_KEY_PATTERN = new RegExp(`^${KEY_ROOTS.avatar}/${KEY_SHAPE}$`)

/** Bound for a key arriving in a request body, before any pattern check. */
export const MAX_MEDIA_KEY_LENGTH = 128

/**
 * The key one upload will be stored under.
 *
 * `id` is the row's own id, which makes the object and the row two faces of one
 * identifier: an operator holding either can find the other, and a ULID is unique per
 * call, so a key is never reused even by the same owner uploading the same file twice.
 */
export function mediaObjectKey(
  kind: MediaKind,
  ownerId: string,
  id: string,
  extension: string,
): string {
  return `${KEY_ROOTS[kind]}/${ownerId}/${id}.${extension}`
}

/**
 * The public URL of a stored object.
 *
 * No pattern check: this maps a stored key to its address and nothing more. The one
 * writer of `media_assets.r2_key` and `users.avatar_key` is this API, and reads stay
 * lenient everywhere else in the codebase — a value that somehow predates the current
 * shape is better echoed than silently nulled.
 */
export function mediaUrlFor(key: string): string {
  return `${MEDIA_URL_PREFIX}/${key}`
}

/**
 * The key a serving request asked for, or `null` when the path is not a key this API
 * could have minted.
 *
 * No percent-decoding: every character a key is built from is URL-safe, so a path that
 * needs decoding is not one of ours — which also means a malformed escape cannot reach
 * a decoder that would throw on it.
 */
export function servableKeyFrom(urlPath: string): string | null {
  const prefix = `${MEDIA_URL_PREFIX}/`
  if (!urlPath.startsWith(prefix)) return null
  const key = urlPath.slice(prefix.length)
  return MEDIA_KEY_PATTERN.test(key) ? key : null
}
