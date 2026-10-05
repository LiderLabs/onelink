import { z } from 'zod'
import { MAX_SLUG_LENGTH, MAX_URL_LENGTH } from '../lib/constants'
import { idParamSchema } from './common'

// ============================================================================
// Request bodies for /api/v1/pages and the page half of /api/v1/public.
//
// Slugs arrive raw (mixed case, dots, underscores, stray punctuation) and are
// NORMALISED server-side with `normalizeSlug` before any policy check: what
// the owner typed is a suggestion, what the database stores is canonical. An
// input that normalises to nothing is refused with a 400 by the service — the
// same split as everywhere else in this codebase, where 422 means the body did
// not match the schema and 400 means the content was refused. It is never
// silently turned into an empty slug: the column is NOT NULL UNIQUE, and
// inventing a value would divorce the page from the URL its owner chose.
//
// Link URLs follow the same split the codebase uses everywhere: the schema
// rejects the structurally wrong (not a string, too long), while policy
// (wrong scheme, credentials embedded) is refused by the service with a 400,
// because the shape was fine and the content was refused.
// ============================================================================

/** Raw slug input as typed by the owner: at least something must survive normalisation. */
export const slugInputSchema = z
  .string()
  .trim()
  .min(1, 'A slug is required.')
  .max(MAX_SLUG_LENGTH, `Slugs must be at most ${MAX_SLUG_LENGTH} characters.`)

/** Link display text — the `title` column. Single-line. */
const linkTitleSchema = z
  .string()
  .trim()
  .min(1, 'A link title is required.')
  .max(140, 'Link titles must be at most 140 characters.')

const themeSchema = z.enum(['light', 'dark'])
const layoutSchema = z.enum(['list', 'grid'])

/** Optional `#rrggbb` page accent. */
const accentColorSchema = z
  .string()
  .trim()
  .regex(/^#[0-9a-fA-F]{6}$/, 'The accent colour must be a #rrggbb hex value.')

export const createPageSchema = z.strictObject({
  slug: slugInputSchema.optional(),
  title: z.string().trim().max(120).optional(),
  bio: z.string().trim().max(500).optional(),
  theme: themeSchema.optional(),
  layout: layoutSchema.optional(),
  accentColor: accentColorSchema.nullable().optional(),
  showBranding: z.boolean().optional(),
})

export const updatePageSchema = z
  .strictObject({
    title: z.string().trim().max(120).nullable().optional(),
    bio: z.string().trim().max(500).nullable().optional(),
    theme: themeSchema.optional(),
    layout: layoutSchema.optional(),
    accentColor: accentColorSchema.nullable().optional(),
    showBranding: z.boolean().optional(),
  })
  .refine((value) => Object.keys(value).length > 0, {
    error: 'Supply at least one field to update.',
  })

const linkUrlSchema = z
  .string()
  .trim()
  .min(1, 'A link URL is required.')
  .max(MAX_URL_LENGTH, `Link URLs must be at most ${MAX_URL_LENGTH} characters.`)

const scheduleRefinement = {
  error: 'The link window ends before it starts.',
} as const

function windowIsOrdered(value: {
  startsAt?: number | null | undefined
  endsAt?: number | null | undefined
}): boolean {
  return value.startsAt == null || value.endsAt == null || value.startsAt <= value.endsAt
}

export const createPageLinkSchema = z
  .strictObject({
    title: linkTitleSchema,
    url: linkUrlSchema,
    description: z.string().trim().max(280).nullable().optional(),
    icon: z
      .string()
      .trim()
      .max(80, 'Icon keys must be at most 80 characters.')
      .nullable()
      .optional(),
    isVisible: z.boolean().optional(),
    startsAt: z.number().int().min(0).nullable().optional(),
    endsAt: z.number().int().min(0).nullable().optional(),
  })
  .refine(windowIsOrdered, scheduleRefinement)

export const updatePageLinkSchema = z
  .strictObject({
    title: linkTitleSchema.optional(),
    url: linkUrlSchema.optional(),
    description: z.string().trim().max(280).nullable().optional(),
    icon: z
      .string()
      .trim()
      .max(80, 'Icon keys must be at most 80 characters.')
      .nullable()
      .optional(),
    isVisible: z.boolean().optional(),
    startsAt: z.number().int().min(0).nullable().optional(),
    endsAt: z.number().int().min(0).nullable().optional(),
  })
  .refine((value) => Object.keys(value).length > 0, {
    error: 'Supply at least one field to update.',
  })
  .refine(windowIsOrdered, scheduleRefinement)

/**
 * Explicit link ordering: no duplicates, and the service re-checks membership
 * because a strict body alone cannot prove the ids belong to this page.
 */
export const reorderPageLinksSchema = z.strictObject({
  linkIds: z
    .array(idParamSchema.shape.id)
    .min(1, 'Supply at least one link id.')
    .max(200, 'Too many link ids in one request.'),
})

export type CreatePageBody = z.infer<typeof createPageSchema>
export type UpdatePageBody = z.infer<typeof updatePageSchema>
export type CreatePageLinkBody = z.infer<typeof createPageLinkSchema>
export type UpdatePageLinkBody = z.infer<typeof updatePageLinkSchema>
export type ReorderPageLinksBody = z.infer<typeof reorderPageLinksSchema>
