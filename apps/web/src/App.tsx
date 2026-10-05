import { Navigate, Route, Routes } from 'react-router-dom'
import { AppShell } from './components/AppShell'
import { RequireAnonymous, RequireAuth } from './components/Guards'
import { ForgotPasswordRoute } from './routes/forgot-password'
import { LoginRoute } from './routes/login'
import { NotFoundRoute } from './routes/not-found'
import { ProfileRoute } from './routes/profile'
import { RegisterRoute } from './routes/register'
import { ResetPasswordRoute } from './routes/reset-password'



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
