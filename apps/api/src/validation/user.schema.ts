import { z } from 'zod'
import { MAX_NOTE_LENGTH } from '../lib/constants'
import {
  emailSchema,
  passwordSchema,
  reasonSchema,
  reportCategorySchema,
  roleSchema,
  usernameSchema,
} from './common'
// ============================================================================
// Request bodies for /api/v1/admin/users.
//
// Every user-mutating route carries one of these; the moderation routes all
// require a reason, which is enforced here as well as in the service so the
// error surfaces as a 400 validation failure rather than a service error.
// ============================================================================

export const createUserSchema = z.strictObject({
  email: emailSchema,
  username: usernameSchema.optional(),
  displayName: z.string().trim().max(80).optional(),
  role: roleSchema,
  password: passwordSchema,
  requirePasswordChange: z.boolean().optional(),
  emailVerified: z.boolean().optional(),
})

export const updateUserSchema = z
  .strictObject({
    displayName: z.string().trim().max(80).optional(),
    bio: z.string().trim().max(500).nullable().optional(),
    email: emailSchema.optional(),
    username: usernameSchema.optional(),
    role: roleSchema.optional(),
  })
  .refine((value) => Object.keys(value).length > 0, {
    error: 'Supply at least one field to update.',
  })

export const sanctionBodySchema = z.strictObject({
  reason: reasonSchema,
  category: reportCategorySchema.optional(),
  durationHours: z.number().int().min(1).max(24 * 365 * 10).optional(),
  reportId: z.string().regex(/^[0-9A-HJKMNP-TV-Z]{26}$/).optional(),
})

export const suspendBodySchema = sanctionBodySchema.extend({
  permanent: z.boolean().optional(),
})

export const reactivateBodySchema = z.strictObject({
  reason: reasonSchema,
})

export const revokeSessionsBodySchema = z.strictObject({
  reason: z.string().trim().min(3).max(200),
})

export const createNoteSchema = z.strictObject({
  body: z.string().trim().min(1, 'A note body is required.').max(MAX_NOTE_LENGTH),
})

/**
 * Admin-initiated password reset.
 *
 * `email` mints a single-use link and sends it (the safe default);
 * `temp` sets a shared secret the admin reads out of band, and forces a change
 * on first login. Both are supported because both are genuinely needed: email
 * for a normal user, temp for someone who has lost access to their inbox.
 */
export const adminResetPasswordSchema = z
  .strictObject({
    mode: z.enum(['email', 'temp']),
    tempPassword: passwordSchema.optional(),
  })
  .refine((value) => value.mode !== 'temp' || Boolean(value.tempPassword), {
    error: 'tempPassword is required when mode is "temp".',
  })

export type CreateUserBody = z.infer<typeof createUserSchema>
export type UpdateUserBody = z.infer<typeof updateUserSchema>
export type SanctionBody = z.infer<typeof sanctionBodySchema>
export type SuspendBody = z.infer<typeof suspendBodySchema>
export type ReactivateBody = z.infer<typeof reactivateBodySchema>
export type RevokeSessionsBody = z.infer<typeof revokeSessionsBodySchema>
export type CreateNoteBody = z.infer<typeof createNoteSchema>
