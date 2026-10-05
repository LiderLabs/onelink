import type { z } from 'zod'
import { unauthenticated, validationError } from '../lib/errors'
import type { AppContext } from '../lib/http'
import type { AuthUser } from '../types'

// ============================================================================
// Route helpers.
//
// `readJson` exists instead of using @hono/zod-validator because it throws a
// plain AppError, which means validation failures flow through the SAME
// onError handler as every other error and therefore produce an identical
// envelope. One error shape, one code path.
// ============================================================================

/**
 * The authenticated user.
 *
 * `c.get('user')` is `AuthUser | null` because `loadSession` never rejects —
 * routes behind `requireCapability` are guaranteed non-null, but the type
 * system cannot know that, and casting at each call site is how a null check
 * eventually gets skipped.
 */
export function currentUser(c: AppContext): AuthUser {
  const user = c.get('user')
  if (!user) throw unauthenticated()
  return user
}

function formatIssues(error: z.ZodError): { path: string; message: string; code: string }[] {
  return error.issues.map((issue) => ({
    path: issue.path.length > 0 ? issue.path.map(String).join('.') : '(root)',
    message: issue.message,
    code: String(issue.code),
  }))
}

/** Parses and validates a JSON request body, or throws a 422 AppError. */
export async function readJson<T extends z.ZodType>(
  c: AppContext,
  schema: T,
): Promise<z.infer<T>> {
  let raw: unknown
  try {
    raw = await c.req.json()
  } catch {
    throw validationError('The request body must be valid JSON.')
  }

  const parsed = schema.safeParse(raw)
  if (!parsed.success) {
    throw validationError('The request is invalid.', { issues: formatIssues(parsed.error) })
  }
  return parsed.data as z.infer<T>
}
