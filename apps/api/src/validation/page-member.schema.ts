import { z } from 'zod'
import { emailSchema } from './common'

export const PAGE_MEMBER_ROLES = ['viewer', 'editor'] as const

export const pageMemberRoleSchema = z.strictObject({
  role: z.enum(PAGE_MEMBER_ROLES),
})

export const createPageInvitationSchema = z.strictObject({
  email: emailSchema,
  role: z.enum(PAGE_MEMBER_ROLES).default('viewer'),
})
