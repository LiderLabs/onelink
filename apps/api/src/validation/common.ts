import { z } from 'zod'
import {
  MAX_PASSWORD_LENGTH,
  MAX_REASON_LENGTH,
  MIN_PASSWORD_LENGTH,
  ROLES,
} from '../lib/constants'

// ============================================================================
// Reusable Zod pieces.
//
// Zod 4's `z.email()` etc. are avoided in favour of explicit regexes so that
// error messages stay under our control and the schemas do not depend on
// string-format APIs that have moved between major versions.
// ============================================================================

export const ULID_PATTERN = /^[0-9A-HJKMNP-TV-Z]{26}$/

/** Route-param schema for every `/:id` — 26-char Crockford Base32 ULID. */
export const idParamSchema = z.object({
  id: z.string().regex(ULID_PATTERN, 'A valid 26-character id is required.'),
})

export const emailSchema = z
  .string()
  .trim()
  .min(3, 'An email address is required.')
  .max(320, 'That email address is too long.')
  .regex(/^[^@\s]+@[^@\s]+\.[^@\s]+$/, 'A valid email address is required.')

export const usernameSchema = z
  .string()
  .trim()
  .min(3, 'Usernames must be at least 3 characters.')
  .max(32, 'Usernames must be at most 32 characters.')
  .regex(/^[a-zA-Z0-9._-]+$/, 'Usernames may only contain letters, numbers, ., _ and -.')

export const passwordSchema = z
  .string()
  .min(MIN_PASSWORD_LENGTH, `Passwords must be at least ${MIN_PASSWORD_LENGTH} characters.`)
  .max(MAX_PASSWORD_LENGTH, `Passwords must be at most ${MAX_PASSWORD_LENGTH} characters.`)

/** Single-line text: titles, display names, labels. */
export const shortTextSchema = (max: number, label = 'Value') =>
  z.string().trim().min(1, `${label} is required.`).max(max, `${label} is too long.`)

export const reasonSchema = z
  .string()
  .trim()
  .min(3, 'A reason of at least 3 characters is required.')
  .max(MAX_REASON_LENGTH, 'That reason is too long.')

export const optionalReasonSchema = z
  .string()
  .trim()
  .max(MAX_REASON_LENGTH, 'That reason is too long.')
  .optional()

export const roleSchema = z.enum(ROLES)

export const reportCategorySchema = z.enum([
  'spam',
  'abuse',
  'nsfw',
  'impersonation',
  'copyright',
  'malware',
  'harassment',
  'other',
])

// Request bodies use `z.strictObject`, so an unexpected key is a 400 rather
// than a silently ignored typo.
