import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react'
import type { ReactNode } from 'react'
import { ApiError, api, isUnauthenticated } from './api'
import type { PublicSettings, SessionUser, UpdateProfileInput } from './types'

// ============================================================================
// Session + platform state for the whole app.
//
// `status` distinguishes four situations that a naive `user | null` would
// collapse into one, and the difference matters to the user:
//
//   loading       the pre-auth bootstrap is in flight — render a splash, not a
//                 login form, or a signed-in user sees a login flash
//   anonymous     the API answered 401: genuinely signed out
//   authenticated a session cookie is live and /auth/me returned a user
//   unavailable   the API could not be reached at all — NOT the same as signed
//                 out, and it must never silently become a login form with a
//                 "wrong password" message on it
// ============================================================================

export type SessionStatus = 'loading' | 'anonymous' | 'authenticated' | 'unavailable'

export interface SessionState {
  status: SessionStatus
  user: SessionUser | null
  capabilities: string[]
  platformName: string
  settings: PublicSettings | null
  /** Set when the bootstrap failed, so recovery screens can explain why. */
  bootstrapError: ApiError | null
}

export interface RegisterInput {
  username: string
  email: string
  password: string
  displayName?: string
}

export interface SessionContextValue extends SessionState {
  /** Re-reads the session. Used by guards, after login, and by retry screens. */
  refresh: () => Promise<void>
  /** Refresh profile/session without turning a transient read failure into a route unmount. */
  refreshProfile: () => Promise<SessionUser>
  login: (identifier: string, password: string) => Promise<SessionUser>
  register: (input: RegisterInput) => Promise<SessionUser>
  logout: () => Promise<void>
  changePassword: (currentPassword: string, newPassword: string) => Promise<number>
  /**
   * `PATCH /auth/me` (R1.1/R1.2) and adoption of the answer.
   *
   * Resolves with the server's normalized identity, so the caller can reset its
   * dirty baseline to what was actually stored rather than to what was typed.
   */
  updateProfile: (input: UpdateProfileInput) => Promise<SessionUser>
  can: (capability: string) => boolean
  /** True while the signed-in user must rotate their password before doing
   *  anything else — mirrors the API's MUST_CHANGE_PASSWORD interlock. */
  mustChangePassword: boolean
}

const SessionContext = createContext<SessionContextValue | null>(null)

const EMPTY: SessionState = {
  status: 'loading',
  user: null,
  capabilities: [],
  platformName: 'OneLink',
  settings: null,
  bootstrapError: null,
}

export function SessionProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<SessionState>(EMPTY)
  // Invalidates in-flight loads when a newer one starts (React StrictMode's
  // double-invoke in development, or a login landing mid-bootstrap).
  const loadIdRef = useRef(0)
  /**
   * The latest state, readable from an async callback without making that
   * callback depend on it. `updateProfile` needs the current user to merge the
   * PATCH response over; re-creating the callback on every state change would
   * invalidate every memo downstream for no reason.
   */
  const stateRef = useRef(state)
  useEffect(() => {
    stateRef.current = state
  }, [state])

  /**
   * One bootstrap pass: platform settings (valid signed in or out) plus the
   * session. They are independent, so they use `allSettled` — a settings failure
   * must not be reported as a session failure, or vice versa.
   */
  const load = useCallback(async () => {
    const loadId = ++loadIdRef.current

    const [settingsResult, meResult] = await Promise.allSettled([api.publicSettings(), api.me()])

    if (loadId !== loadIdRef.current) return

    const settings = settingsResult.status === 'fulfilled' ? settingsResult.value : null

    if (meResult.status === 'fulfilled') {
      setState({
        status: 'authenticated',
        user: meResult.value.user,
        capabilities: meResult.value.capabilities,
        platformName: meResult.value.platformName,
        settings,
        bootstrapError: null,
      })
      return
    }

    const error = meResult.reason

    if (isUnauthenticated(error)) {
      setState({
        status: 'anonymous',
        user: null,
        capabilities: [],
        platformName: settings?.platformName ?? 'OneLink',
        settings,
        bootstrapError: null,
      })
      return
    }

    setState((previous) => ({
      status: 'unavailable',
      user: previous.user,
      capabilities: previous.capabilities,
      platformName: settings?.platformName ?? previous.platformName,
      settings,
      bootstrapError: error instanceof ApiError ? error : null,
    }))
  }, [])

  useEffect(() => {
    void load()
  }, [load])

  /**
   * Runs an authenticated call and, if the API reports the session is gone,
   * drops local identity too. Sessions have a hard 8-hour ceiling, so without
   * this an idle tab would keep rendering a user who no longer has a session.
   */
  const runAuthenticated = useCallback(async <T,>(action: () => Promise<T>): Promise<T> => {
    try {
      return await action()
    } catch (error) {
      if (isUnauthenticated(error)) {
        loadIdRef.current += 1
        setState((previous) => ({
          status: 'anonymous',
          user: null,
          capabilities: [],
          platformName: previous.platformName,
          settings: previous.settings,
          bootstrapError: null,
        }))
      }
      throw error
    }
  }, [])

  /**
   * Adopts an /auth/login or /auth/register response directly, so the next paint
   * is already signed in rather than waiting on a second round trip.
   */
  const adopt = useCallback((auth: { user: SessionUser; capabilities: string[] }): SessionUser => {
    loadIdRef.current += 1
    setState((previous) => ({
      status: 'authenticated',
      user: auth.user,
      capabilities: auth.capabilities,
      platformName: previous.platformName,
      settings: previous.settings,
      bootstrapError: null,
    }))
    return auth.user
  }, [])

  const login = useCallback(
    async (identifier: string, password: string) => adopt(await api.login(identifier, password)),
    [adopt],
  )

  const register = useCallback(
    async (input: RegisterInput) => adopt(await api.register(input)),
    [adopt],
  )

  const logout = useCallback(async () => {
    // Best effort: even a failed logout must drop local identity, otherwise the
    // user is stuck on a signed-in screen they cannot leave.
    try {
      await api.logout()
    } finally {
      loadIdRef.current += 1
      setState((previous) => ({
        ...EMPTY,
        status: 'anonymous',
        settings: previous.settings,
        platformName: previous.platformName,
      }))
    }
  }, [])

  const changePassword = useCallback(
    async (currentPassword: string, newPassword: string) => {
      const result = await runAuthenticated(() => api.changePassword(currentPassword, newPassword))
      // A self-service change keeps the caller's own session, so only the
      // `requirePasswordChange` flag moves — re-reading is what clears it
      // truthfully rather than optimistically.
      await load()
      return result.revokedSessions
    },
    [load, runAuthenticated],
  )

  /**
   * Adopts the identity the API just stored.
   *
   * The PATCH response is an `ApiUser`: it carries no `sessionId`,
   * `sessionExpiresAt` or `impersonatedBy`, because those belong to the session
   * and not to the account. Spreading it OVER the current session user keeps
   * those three truthful — replacing the user with the response would silently
   * blank the session expiry the account record prints and drop the
   * impersonation flag the shell warns about.
   *
   * No second `GET /auth/me` afterwards: the write is already confirmed, and a
   * failed follow-up read would look like a failed save and invite a duplicate
   * submission. The server's normalized values are exactly what came back here.
   */
  const updateProfile = useCallback(
    async (input: UpdateProfileInput): Promise<SessionUser> => {
      const current = stateRef.current.user
      if (!current) throw new ApiError(401, 'UNAUTHENTICATED', 'Authentication required.')

      const result = await runAuthenticated(() => api.updateProfile(input))
      const merged: SessionUser = { ...current, ...result.user }
      setState((previous) => (previous.user ? { ...previous, user: merged } : previous))
      return merged
    },
    [runAuthenticated],
  )

  const refreshProfile = useCallback(async (): Promise<SessionUser> => {
    const result = await runAuthenticated(() => api.me())
    setState(previous => ({ ...previous, status: 'authenticated', user: result.user,
      capabilities: result.capabilities, platformName: result.platformName, bootstrapError: null }))
    return result.user
  }, [runAuthenticated])

  const value = useMemo<SessionContextValue>(
    () => ({
      ...state,
      refresh: load,
      refreshProfile,
      login,
      register,
      logout,
      changePassword,
      updateProfile,
      can: (capability: string) => state.capabilities.includes(capability),
      mustChangePassword: state.user?.requirePasswordChange === true,
    }),
    [state, load, refreshProfile, login, register, logout, changePassword, updateProfile],
  )

  return <SessionContext.Provider value={value}>{children}</SessionContext.Provider>
}

export function useSession(): SessionContextValue {
  const context = useContext(SessionContext)
  if (!context) throw new Error('useSession must be used inside <SessionProvider>')
  return context
}
