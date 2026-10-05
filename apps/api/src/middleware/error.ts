import type { ErrorHandler, NotFoundHandler } from 'hono'
import { AppError, isAppError } from '../lib/errors'
import type { AppEnv } from '../types'

// ============================================================================
// The only place an error becomes a response body.
//
// Anything that is not an AppError is treated as a bug: it is logged with full
// detail server-side and reported to the client as a generic 500, so SQL text,
// binding names and stack traces never reach a browser.
// ============================================================================

function errorBody(
  code: string,
  message: string,
  details: unknown,
  requestId: string,
): Record<string, unknown> {
  const error: Record<string, unknown> = { code, message }
  if (details !== undefined && details !== null) error.details = details
  return { error, meta: { requestId } }
}

/**
 * Maps SQLite constraint failures onto HTTP semantics.
 *
 * Without this, a duplicate email surfaces as an opaque 500 instead of the 409
 * the API contract promises. The unique/foreign-key cases are the only ones a
 * client can actually cause.
 */
function mapDatabaseError(message: string): AppError | null {
  if (!message.includes('SQLITE_CONSTRAINT')) return null
  if (message.includes('SQLITE_CONSTRAINT_UNIQUE') || message.includes('UNIQUE constraint failed')) {
    return new AppError(409, 'CONFLICT', 'That value is already taken.', {
      cause: message,
    })
  }
  if (message.includes('FOREIGN KEY constraint failed')) {
    return new AppError(409, 'CONFLICT', 'That operation conflicts with related data.', {
      cause: message,
    })
  }
  if (message.includes('CHECK constraint failed')) {
    return new AppError(409, 'CONFLICT', 'That value is not allowed.', { cause: message })
  }
  return null
}

function normalize(error: unknown): { appError: AppError; unexpected: boolean } {
  if (isAppError(error)) return { appError: error, unexpected: false }

  if (error instanceof Error) {
    const mapped = mapDatabaseError(error.message)
    if (mapped) return { appError: mapped, unexpected: true }
  }

  return {
    appError: new AppError(500, 'INTERNAL', 'Something went wrong on our end.'),
    unexpected: true,
  }
}

export const onError: ErrorHandler<AppEnv> = (error, c) => {
  const requestId = c.get('requestId') ?? 'unknown'
  const { appError, unexpected } = normalize(error)

  if (unexpected) {
    const cause = error instanceof Error ? error : new Error(String(error))
    console.error(
      JSON.stringify({
        level: 'error',
        msg: 'unhandled_error',
        requestId,
        method: c.req.method,
        path: c.req.path,
        name: cause.name,
        message: cause.message,
        stack: cause.stack,
      }),
    )
  }

  for (const [header, value] of Object.entries(appError.headers ?? {})) {
    c.header(header, value)
  }

  return c.json(
    errorBody(appError.code, appError.message, appError.details, requestId),
    appError.status,
  )
}

export const notFoundHandler: NotFoundHandler<AppEnv> = (c) =>
  c.json(
    errorBody('NOT_FOUND', `No route matches ${c.req.method} ${c.req.path}.`, undefined, c.get('requestId') ?? 'unknown'),
    404,
  )
