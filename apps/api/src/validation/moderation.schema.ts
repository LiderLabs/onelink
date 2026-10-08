import { z } from 'zod'
import { reportCategorySchema, shortTextSchema } from './common'

export const createPageReportSchema = z.strictObject({
  category: reportCategorySchema,
  targetType: z.enum(['page', 'link', 'user']).optional(),
  linkId: z.string().regex(/^[0-9A-HJKMNP-TV-Z]{26}$/).optional(),
  description: z.string().trim().max(2000).optional(),
  email: z.string().trim().max(320).email().optional(),
}).refine((value) => (value.targetType === 'link') === (value.linkId !== undefined), {
  message: 'Supply linkId only when reporting a link.',
  path: ['linkId'],
})

export const resolveReportSchema = z.strictObject({
  status: z.enum(['resolved', 'dismissed', 'duplicate']),
  notes: z.string().trim().max(2000).optional(),
})

export const reportQueueFilters = {
  statuses: ['open', 'reviewing', 'resolved', 'dismissed', 'duplicate'] as const,
  categories: ['spam', 'abuse', 'nsfw', 'impersonation', 'copyright', 'malware', 'harassment', 'other'] as const,
}

export const reportNoteSchema = z.strictObject({ notes: shortTextSchema(2000, 'A note') })

export const createAppealSchema = z.strictObject({
  sanctionId: z.string().regex(/^[0-9A-HJKMNP-TV-Z]{26}$/),
  message: z.string().trim().min(20).max(4000),
})

export const decideAppealSchema = z.strictObject({
  decision: z.enum(['uphold', 'overturn', 'reduce']),
  notes: z.string().trim().min(3).max(2000),
  reducedDurationHours: z.number().int().min(1).max(24 * 365 * 10).optional(),
}).refine((value) => value.decision === 'reduce'
  ? value.reducedDurationHours !== undefined
  : value.reducedDurationHours === undefined, {
  message: 'A reduced duration is required only for a reduce decision.',
  path: ['reducedDurationHours'],
})

export const reviewContentFlagSchema = z.strictObject({
  status: z.enum(['cleared', 'actioned', 'escalated']),
  notes: z.string().trim().min(3).max(2000),
})

export const moderatePageSchema = z.strictObject({
  reason: z.string().trim().min(3).max(2000),
  reportId: z.string().regex(/^[0-9A-HJKMNP-TV-Z]{26}$/).optional(),
})