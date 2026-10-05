import { Navigate, Route, Routes } from 'react-router-dom'
import { AppShell } from './components/AppShell'
import { RequireAnonymous, RequireAuth } from './components/Guards'
import { ForgotPasswordRoute } from './routes/forgot-password'
import { LoginRoute } from './routes/login'
import { NotFoundRoute } from './routes/not-found'
import { ProfileRoute } from './routes/profile'
import { RegisterRoute } from './routes/register'
import { ResetPasswordRoute } from './routes/reset-password'

// ============================================================================
// Routes.
//
// Everything is nested inside the shell so the masthead, maintenance advisory
// and suspension notice cannot be forgotten by a screen.
//
// The two reset screens are deliberately unguarded: someone following a reset
// link may or may not still have a session, and consuming the token is what
// determines the outcome. Only the sign-in and sign-up screens are hidden from
// an authenticated visitor, because rendering a login form to someone who is
// already signed in is the classic pre-auth bootstrap flash.
// ============================================================================

export function App() {
  return (
    <Routes>
      <Route element={<AppShell />}>
        <Route element={<RequireAnonymous />}>
          <Route path="/login" element={<LoginRoute />} />
          <Route path="/register" element={<RegisterRoute />} />
        </Route>

        <Route path="/forgot-password" element={<ForgotPasswordRoute />} />
        <Route path="/reset-password" element={<ResetPasswordRoute />} />

        <Route element={<RequireAuth />}>
          <Route path="/profile" element={<ProfileRoute />} />
        </Route>

        <Route path="/" element={<Navigate to="/profile" replace />} />
        <Route path="*" element={<NotFoundRoute />} />
      </Route>
    </Routes>
  )
}
