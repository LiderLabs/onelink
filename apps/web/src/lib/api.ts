import type {
  AuthResponse,
  ChangePasswordResponse,
  ForgotPasswordResponse,
  MeResponse,
  PublicSettings,
  ResetPasswordResponse,
  UpdateProfileInput,
  UpdateProfileResponse,
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
 * One field-level problem from a `422 VALIDATION_ERROR`.
 *
 * The API answers a failed body with `details.issues`, each naming the path that
 * failed (`"url"`, `"socialIds.2"`, `"(root)"`), so a form can attach the server's
 * own message to the control it belongs to instead of dumping a paragraph above
 * the whole form.
 */
export interface ValidationIssue {
  path: string
  message: string
  code: string
}

/** The `details.issues` of a 422, or `[]` for every other kind of failure. */
export function validationIssues(error: unknown): ValidationIssue[] {
  if (!(error instanceof ApiError) || error.code !== 'VALIDATION_ERROR') return []
  const issues = (error.details as { issues?: unknown } | null | undefined)?.issues
  if (!Array.isArray(issues)) return []

  const parsed: ValidationIssue[] = []
  for (const issue of issues) {
    if (typeof issue !== 'object' || issue === null) continue
    const candidate = issue as { path?: unknown; message?: unknown; code?: unknown }
    if (typeof candidate.message !== 'string') continue
    parsed.push({
      path: typeof candidate.path === 'string' ? candidate.path : '(root)',
      message: candidate.message,
      code: typeof candidate.code === 'string' ? candidate.code : '',
    })
  }
  return parsed
}

/**
 * The same issues keyed by field name, for binding onto inputs.
 *
 * First message per field wins: a field with two complaints does not have room
 * for both, and the first is the one the schema checks first.
 */
export function fieldErrorsFrom(error: unknown): Record<string, string> {
  const map: Record<string, string> = {}
  for (const issue of validationIssues(error)) {
    if (issue.path === '(root)' || issue.path in map) continue
    map[issue.path] = issue.message
  }
  return map
}

/**
 * `fetch` with the shared envelope handling and a hard timeout, so a stalled
 * request cannot leave a screen spinning forever.
 *
 * Exported because feature clients (`features/<name>/api.ts`) build their own
 * endpoints on top of it rather than every resource being bolted into this file.
 */
export async function request<T>(path: string, init: RequestInit = {}): Promise<T> {
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

  /**
   * Self-service identity edit (R1.1, extended by R1.2).
   *
   * Answers `{ user }` and nothing else: the body that can change here cannot
   * change a role, so capabilities are not echoed — the caller keeps its own.
   * The `user` is an `ApiUser`, NOT an `AuthUser`, which is why the session
   * merges it over the live session user instead of replacing it.
   */
  updateProfile: (input: UpdateProfileInput) =>
    request<UpdateProfileResponse>('/auth/me', {
      method: 'PATCH',
      body: JSON.stringify(input),
    }),

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
