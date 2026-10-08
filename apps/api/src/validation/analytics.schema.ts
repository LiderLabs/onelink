import { z } from 'zod'
import { ULID_PATTERN } from './common'

export const publicPageEventSchema = z
  .strictObject({
    type: z.enum(['view', 'click']),
    linkId: z.string().regex(ULID_PATTERN).optional(),
  })
  .refine((event) => event.type === 'click' ? event.linkId !== undefined : event.linkId === undefined, {
    message: 'A click needs a linkId; a view must not include one.',
    path: ['linkId'],
  })

export type PublicPageEvent = z.infer<typeof publicPageEventSchema>