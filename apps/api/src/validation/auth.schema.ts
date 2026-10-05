import { z } from 'zod'
import { MAX_PASSWORD_LENGTH } from '../lib/constants'
import { emailSchema, idParamSchema, passwordSchema, usernameSchema } from './common'

// ============================================================================
// Request bodies for /api/v1/auth.
//
// Login deliberately validates the identifier only loosely: a malformed value
// cannot match an account anyway, and there is no reason to help an attacker
// distinguish "bad format" from "no such account" beyond what is required.
// Reusing the strict `usernameSchema` here would undo that — it would turn login
// into a format oracle and would lock out any account whose username predates
// the current rules.
// ============================================================================

/**
 * Sign-in takes a username OR an email address in a single field.
 *
 * A username can never contain `@` (see `usernameSchema`) and an email always
 * does, so the service branches on that one character and probes a single
 * unique index instead of an `OR` across two columns.
 */
export const loginSchema = z.strictObject({
  identifier: z.string().trim().min(3, 'A username or email address is required.').max(320),
  password: z.string().min(1, 'A password is required.').max(MAX_PASSWORD_LENGTH),
})

/**
 * Public sign-up.
 *
 * Strict, so `{username, email, password, role: "owner"}` is a 400 rather than a
 * silently ignored privilege-escalation attempt. There is deliberately no role
 * field: the service hard-codes `user`.
 */
export const registerSchema = z.strictObject({
  username: usernameSchema,
  email: emailSchema,
  password: passwordSchema,
  displayName: z.string().trim().max(80).optional(),
})

export const changePasswordSchema = z.strictObject({
  currentPassword: z.string().min(1, 'Your current password is required.').max(MAX_PASSWORD_LENGTH),
  newPassword: passwordSchema,
})

export const forgotPasswordSchema = z.strictObject({
  email: emailSchema,
})

export const resetPasswordSchema = z.strictObject({
  token: z.string().min(16, 'A reset token is required.').max(256),
  newPassword: passwordSchema,
})

export const userParamSchema = idParamSchema

export type LoginBody = z.infer<typeof loginSchema>
export type RegisterBody = z.infer<typeof registerSchema>
export type ChangePasswordBody = z.infer<typeof changePasswordSchema>
export type ForgotPasswordBody = z.infer<typeof forgotPasswordSchema>
export type ResetPasswordBody = z.infer<typeof resetPasswordSchema>
