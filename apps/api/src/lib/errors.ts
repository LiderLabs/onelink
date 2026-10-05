import type { ContentfulStatusCode } from 'hono/utils/http-status'

// ============================================================================
// Application errors.
//
// Anything thrown that is not an AppError is treated as a bug: the real message
// is logged and a generic message is returned, so internal details (SQL text,
// binding names) never leak to a client.
// ============================================================================

export type ErrorCode =
  | 'BAD_REQUEST'
  | 'VALIDATION_ERROR'
  | 'UNAUTHENTICATED'
  | 'FORBIDDEN'
  | 'NOT_FOUND'
  | 'CONFLICT'
  | 'RATE_LIMITED'
  | 'ACCOUNT_LOCKED'
  | 'ACCOUNT_DISABLED'
  | 'MUST_CHANGE_PASSWORD'
  | 'PRECONDITION_FAILED'
  | 'MAINTENANCE'
  | 'INTERNAL'

export interface AppErrorOptions {
  details?: unknown
  cause?: unknown
  /** Extra headers (e.g. Retry-After, WWW-Authenticate). */
  headers?: Record<string, string>
}

export class AppError extends Error {
  readonly status: ContentfulStatusCode
  readonly code: ErrorCode
  readonly details: unknown
  readonly headers: Record<string, string> | undefined

  constructor(
    status: ContentfulStatusCode,
    code: ErrorCode,
    message: string,
    options: AppErrorOptions = {},
  ) {
    super(message, options.cause === undefined ? undefined : { cause: options.cause })
    this.name = 'AppError'
    this.status = status
    this.code = code
    this.details = options.details
    this.headers = options.headers
  }

  toJSON(): { code: ErrorCode; message: string; details?: unknown } {
    return this.details === undefined
      ? { code: this.code, message: this.message }
      : { code: this.code, message: this.message, details: this.details }
  }
}

export function isAppError(error: unknown): error is AppError {
  return error instanceof AppError
}

export const badRequest = (message: string, details?: unknown): AppError =>
  new AppError(400, 'BAD_REQUEST', message, { details })

export const validationError = (message: string, details?: unknown): AppError =>
  new AppError(422, 'VALIDATION_ERROR', message, { details })

export const unauthenticated = (message = 'Authentication required.'): AppError =>
  new AppError(401, 'UNAUTHENTICATED', message)

export const forbidden = (message = 'You do not have permission to do that.'): AppError =>
  new AppError(403, 'FORBIDDEN', message)

export const notFound = (resource = 'Resource'): AppError =>
  new AppError(404, 'NOT_FOUND', `${resource} not found.`)

export const conflict = (message: string, details?: unknown): AppError =>
  new AppError(409, 'CONFLICT', message, { details })

export const rateLimited = (message: string, retryAfterSeconds: number): AppError =>
  new AppError(429, 'RATE_LIMITED', message, {
    headers: { 'retry-after': String(Math.max(1, Math.ceil(retryAfterSeconds))) },
  })

export const accountLocked = (message: string, retryAfterSeconds: number): AppError =>
  new AppError(423, 'ACCOUNT_LOCKED', message, {
    headers: { 'retry-after': String(Math.max(1, Math.ceil(retryAfterSeconds))) },
  })

export const accountDisabled = (message: string): AppError =>
  new AppError(403, 'ACCOUNT_DISABLED', message)

export const passwordChangeRequired = (): AppError =>
  new AppError(
    403,
    'MUST_CHANGE_PASSWORD',
    'You must change your password before continuing.',
  )

export const preconditionFailed = (message: string, details?: unknown): AppError =>
  new AppError(412, 'PRECONDITION_FAILED', message, { details })

export const maintenance = (message: string, retryAfterSeconds = 300): AppError =>
  new AppError(503, 'MAINTENANCE', message, {
    headers: { 'retry-after': String(retryAfterSeconds) },
  })

export const internal = (message = 'Something went wrong on our end.'): AppError =>
  new AppError(500, 'INTERNAL', message)
