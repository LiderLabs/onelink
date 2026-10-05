import type {
  AuthResponse,
  ChangePasswordResponse,
  ForgotPasswordResponse,
  MeResponse,
  PublicSettings,
  ResetPasswordResponse,
} from './types'

// ============================================================================
// The typed API client.
//
// Two rules shape everything here:
//
//   1. The session is a cookie, not a token. Every call therefore goes out with
//      `credentials: 'include'`, and no code in this app ever sees or stores the
//      session token. That is what makes an XSS bug non-fatal for the session.
//
//   2. Failures are values, not surprises. The API answers with a consistent
//      `{ error: { code, message, details } }` envelope, so this converts that
//      into an ApiError carrying the machine-readable code and any Retry-After,
//      and the screens decide what to say.
// ============================================================================

const BASE = '/api/v1'

/** Codes the API itself emits (mirrors src/lib/errors.ts on the server). */
export type ApiErrorCode =
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
  // Client-side only: the request never reached the API.
  | 'NETWORK'
  | 'UNKNOWN'

export class ApiError extends Error {
  readonly status: number
  readonly code: ApiErrorCode
  readonly details: unknown
  /** Seconds until retrying makes sense, when the API sent `retry-after`. */
  readonly retryAfterSeconds: number | null

  constructor(
    status: number,
    code: ApiErrorCode,
    message: string,
    options: { details?: unknown; retryAfterSeconds?: number | null } = {},
  ) {
    super(message)
    this.name = 'ApiError'
    this.status = status
    this.code = code
    this.details = options.details
    this.retryAfterSeconds = options.retryAfterSeconds ?? null
  }
}

/** True when the caller simply has no valid session (the usual signed-out case). */
export function isUnauthenticated(error: unknown): boolean {
  return error instanceof ApiError && error.code === 'UNAUTHENTICATED'
}

/**
 * A short, human sentence for any failure.
 *
 * The API's `message` is already written for end users, so it is preferred; the
 * fallbacks cover what the API cannot describe (it was never reached, or
 * something non-JSON came back).
 */
export function errorMessageFor(error: unknown): string {
  if (!(error instanceof ApiError)) return 'Something went wrong. Please try again.'

  if (error.code === 'NETWORK') {
    return 'Could not reach OneLink. Check your connection and try again.'
  }
  if (error.code === 'UNKNOWN' && error.status > 0) {
    return `Unexpected response from the server (HTTP ${error.status}).`
  }
  if (error.retryAfterSeconds !== null && error.retryAfterSeconds > 0) {
    const seconds = Math.ceil(error.retryAfterSeconds)
    const wait = seconds < 60 ? `${seconds}s` : `${Math.ceil(seconds / 60)} min`
    return `${error.message} Try again in ${wait}.`
  }
  return error.message
}

interface ErrorEnvelope {
  error?: { code?: string; message?: string; details?: unknown }
}

/**
 * `fetch` with the shared envelope handling and a hard timeout, so a stalled
 * request cannot leave a screen spinning forever.
 */
async function request<T>(path: string, init: RequestInit = {}): Promise<T> {
  let response: Response
  try {
    response = await fetch(`${BASE}${path}`, {
      ...init,
      credentials: 'include',
      signal: AbortSignal.timeout(20_000),
      headers: {
        Accept: 'application/json',
        ...(init.body === undefined ? {} : { 'Content-Type': 'application/json' }),
        ...init.headers,
      },
    })
  } catch {
    throw new ApiError(0, 'NETWORK', 'OneLink could not be reached.')
  }

  if (response.status === 204) return undefined as T

  const raw = await response.text()
  let payload: unknown = null
  if (raw.length > 0) {
    try {
      payload = JSON.parse(raw)
    } catch {
      payload = null
    }
  }

  if (!response.ok) {
    const envelope = (payload ?? {}) as ErrorEnvelope
    const retryAfter = Number(response.headers.get('retry-after'))
    throw new ApiError(
      response.status,
      (envelope.error?.code as ApiErrorCode | undefined) ?? 'UNKNOWN',
      envelope.error?.message ?? 'The request could not be completed.',
      {
        details: envelope.error?.details,
        retryAfterSeconds: Number.isFinite(retryAfter) ? retryAfter : null,
      },
    )
  }

  if (payload === null) {
    throw new ApiError(response.status, 'UNKNOWN', 'The server returned an unreadable body.')
  }

  // Every successful response is `{ data, meta }`; unwrap it here so callers
  // only ever deal with the resource itself.
  return (payload as { data: T }).data
}

export const api = {
  publicSettings: () => request<PublicSettings>('/public/settings'),

  me: () => request<MeResponse>('/auth/me'),

  login: (identifier: string, password: string) =>
    request<AuthResponse>('/auth/login', {
      method: 'POST',
      body: JSON.stringify({ identifier, password }),
    }),

  register: (input: {
    username: string
    email: string
    password: string
    displayName?: string
  }) =>
    request<AuthResponse>('/auth/register', {
      method: 'POST',
      body: JSON.stringify(input),
    }),

  logout: () => request<void>('/auth/logout', { method: 'POST' }),

  changePassword: (currentPassword: string, newPassword: string) =>
    request<ChangePasswordResponse>('/auth/change-password', {
      method: 'POST',
      body: JSON.stringify({ currentPassword, newPassword }),
    }),

  forgotPassword: (email: string) =>
    request<ForgotPasswordResponse>('/auth/forgot-password', {
      method: 'POST',
      body: JSON.stringify({ email }),
    }),

  resetPassword: (token: string, newPassword: string) =>
    request<ResetPasswordResponse>('/auth/reset-password', {
      method: 'POST',
      body: JSON.stringify({ token, newPassword }),
    }),
}
