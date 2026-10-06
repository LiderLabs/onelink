import { z } from 'zod'
import {
  MAX_BIO_LENGTH,
  MAX_DISPLAY_NAME_LENGTH,
  MAX_LOCATION_LENGTH,
  MAX_PRONOUNS_LENGTH,
  MAX_SOCIAL_LINKS_PER_USER,
  MAX_URL_LENGTH,
  SOCIAL_PLATFORMS,
} from '../lib/constants'
// The key bound and the key shape come from `lib/media.ts`, beside the pattern that
// defines them: a bound on a media key belongs with the code that mints one, not
// with the constants that describe the profile around it.
import { AVATAR_KEY_PATTERN, MAX_MEDIA_KEY_LENGTH } from '../lib/media'
import { idParamSchema, usernameSchema } from './common'

// ============================================================================
// The caller's own profile — the body behind `PATCH /api/v1/auth/me` (R1.1) and
// the social-link bodies behind `/api/v1/profile/socials` (R1.2).
//
// A file of its own rather than another export in `auth.schema.ts`: signing in
// and editing the identity behind an account change at different rates, for
// different reasons, and behind different guards (these bodies sit behind
// `requireUnimpersonated` + a rate limit that login does not have).
//
// The identity half was WRITTEN IN R1.1 SHAPED FOR R1.2 rather than finished by
// it, and R1.2 kept that promise: `location` and `pronouns` arrived as two more
// optional keys beside `displayName`/`bio`, and the socials as three more
// schemas at the bottom of this same file. No existing body was re-cut.
//
// Caps are **D12**: the spec's 50 / 160 are enforced on WRITE and nothing is
// truncated on READ, so a row written before the caps existed still reads back
// whole. `lib/constants.ts` holds the numbers; `user.service.ts` is what applies
// them, because zod bounds the shape and the service owns the policy.
// ============================================================================

/** Optional non-empty display name: `""` is a client bug, not "clear my name". */
export const displayNameSchema = z
  .string()
  .trim()
  .min(1, 'A display name is required.')
  .max(
    MAX_DISPLAY_NAME_LENGTH,
    `Display names must be at most ${MAX_DISPLAY_NAME_LENGTH} characters.`,
  )

/** `null` clears the bio; `""` says the same thing and the service folds the two together. */
export const bioSchema = z
  .string()
  .trim()
  .max(MAX_BIO_LENGTH, `Bios must be at most ${MAX_BIO_LENGTH} characters.`)

/**
 * `location` and `pronouns` (R1.2). Single-line and both clearable. Bounded
 * rather than trimmed: a value over the cap is a `422`, so what the owner typed
 * is stored whole or not at all. The control-character pass happens in the
 * service (`sanitizeSingleLine`), where an emptied string becomes `null` instead
 * of an empty column — the same reading `bio` gets.
 */
export const locationSchema = z
  .string()
  .trim()
  .max(MAX_LOCATION_LENGTH, `Locations must be at most ${MAX_LOCATION_LENGTH} characters.`)

export const pronounsSchema = z
  .string()
  .trim()
  .max(MAX_PRONOUNS_LENGTH, `Pronouns must be at most ${MAX_PRONOUNS_LENGTH} characters.`)

/**
 * The avatar an account points at (R1.3).
 *
 * `null` clears it, and that is the whole "remove my avatar" action. A string must
 * LOOK like an avatar key this API minted — `avatars/{userId}/{ulid}.{ext}`, the
 * shape `lib/media.ts` builds and serves — so a client that sends a URL, a bare
 * filename, or another kind's key is told immediately instead of storing a key that
 * would render as a broken image.
 *
 * The shape is only half the check. Ownership is answered in the service
 * (`updateOwnProfile` asks `media_assets` whether this caller owns that key), because
 * no pattern can prove ownership and the service should not have to parse a key in
 * order to reject `"nyancat.gif"`.
 */
export const avatarKeySchema = z
  .string()
  .trim()
  .max(MAX_MEDIA_KEY_LENGTH, `Avatar keys must be at most ${MAX_MEDIA_KEY_LENGTH} characters.`)
  .regex(AVATAR_KEY_PATTERN, 'That is not an avatar key.')

/**
 * `username` is optional but never nullable: an account always has one, and
 * "no username" is not a state `users.username` can hold.
 *
 * `role`, `status` and `email` are absent by design, and `strictObject` turns
 * any of them into a 422 — a self-service profile write must not be able to
 * escalate a role or move an account's address (which would also have to reset
 * `email_verified`, a flow that belongs to a staff edit).
 */
export const updateProfileSchema = z
  .strictObject({
    displayName: displayNameSchema.optional(),
    bio: bioSchema.nullable().optional(),
    location: locationSchema.nullable().optional(),
    pronouns: pronounsSchema.nullable().optional(),
    avatarKey: avatarKeySchema.nullable().optional(),
    username: usernameSchema.optional(),
    // R1.2 added `location` and `pronouns` above, exactly as R1.1 promised.
    // R1.3 lands `avatarKey`: the SHAPE is checked here, ownership against
    // `media_assets` is checked in the service before the key is ever trusted.
  })
  .refine((value) => Object.keys(value).length > 0, {
    error: 'Supply at least one field to update.',
  })

export type UpdateProfileBody = z.infer<typeof updateProfileSchema>

// ------------------------------------------------------------------- socials --
//
// Socials are their own resource (**D9** — a table, not a JSON column on
// `users`), so they get their own bodies here rather than a nested array on
// `PATCH /auth/me`. That is what makes one of them individually addressable
// (`PATCH`/`DELETE .../:id`) and orderable (the order route), neither of which a
// JSON blob could offer without rewriting the whole list on every touch.

/**
 * The platform a social link points at.
 *
 * Normalised — trimmed and lower-cased — *before* the enum check, so `"GitHub"`
 * from a client is the same platform as `github`: what gets stored is always one
 * of `SOCIAL_PLATFORMS` verbatim, which is what makes the list renderable as
 * icons. An unknown platform is a `422`, because the body named something outside
 * the contract — a shape problem, not a content refusal.
 *
 * The service re-checks the same list (`assertKnownPlatform` in
 * `services/profile.service.ts`) as the last line of defence: this schema is the
 * edge, and the enum lives in code precisely because a migration cannot add a
 * CHECK to `users` alongside the two `ADD COLUMN`s 0003 makes there.
 */
export const socialPlatformSchema = z
  .string()
  .trim()
  .toLowerCase()
  .pipe(
    z.enum(SOCIAL_PLATFORMS, `Unsupported platform. Supported: ${SOCIAL_PLATFORMS.join(', ')}.`),
  )

/**
 * A social URL as typed: bounded here, normalised in the service
 * (`normalizeUrl`, which insists on http/https and strips any embedded
 * credentials, so `https://user:pass@host/` is stored as `https://host/`).
 * Not nullable — a social link with no URL is a row that should not exist, so the
 * way to remove one is `DELETE`.
 */
const socialUrlSchema = z
  .string()
  .trim()
  .min(1, 'A URL is required.')
  .max(MAX_URL_LENGTH, `Social URLs must be at most ${MAX_URL_LENGTH} characters.`)

/**
 * `position` is deliberately absent: a new social is appended last, exactly as
 * `createPageLink` appends a link, and the order route is the only way to move
 * one. `strictObject` turns a client that sends its own position into a `422`
 * instead of a silently misordered profile.
 */
export const createSocialLinkSchema = z.strictObject({
  platform: socialPlatformSchema,
  url: socialUrlSchema,
  isVisible: z.boolean().optional(),
})

export const updateSocialLinkSchema = z
  .strictObject({
    platform: socialPlatformSchema.optional(),
    url: socialUrlSchema.optional(),
    isVisible: z.boolean().optional(),
  })
  .refine((value) => Object.keys(value).length > 0, {
    error: 'Supply at least one field to update.',
  })

/**
 * Explicit ordering, mirroring `reorderPageLinksSchema`. There is no
 * "no duplicates" refinement because the service re-checks membership instead —
 * a strict body alone cannot prove the ids belong to this caller, and a repeated
 * id would collide with `UNIQUE(user_id, position)`.
 */
export const reorderSocialLinksSchema = z.strictObject({
  socialIds: z
    .array(idParamSchema.shape.id)
    .min(1, 'Supply at least one social id.')
    .max(MAX_SOCIAL_LINKS_PER_USER, 'Too many social ids in one request.'),
})

export type CreateSocialLinkBody = z.infer<typeof createSocialLinkSchema>
export type UpdateSocialLinkBody = z.infer<typeof updateSocialLinkSchema>
export type ReorderSocialLinksBody = z.infer<typeof reorderSocialLinksSchema>
