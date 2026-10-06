import { PublicLayout } from './features/public/PublicLayout'
import { PublicPageRoute } from './features/public/PublicPageRoute'
import { ConsoleLayout } from './components/ConsoleLayout'
import { AppShell } from './components/AppShell'
import { RequireAnonymous, RequireAuth } from './components/Guards'
import { ConsoleNotFoundRoute } from './routes/console-not-found'
import { ForgotPasswordRoute } from './routes/forgot-password'
import { LoginRoute } from './routes/login'
import { NotFoundRoute } from './routes/not-found'
import { ProfileRoute } from './routes/profile'
import { RegisterRoute } from './routes/register'
import { ResetPasswordRoute } from './routes/reset-password'
import { Navigate } from 'react-router-dom'
import type { RouteObject } from 'react-router-dom'

// ============================================================================
// The route table.
//
// Exported as data rather than as a <Routes> tree because the console needs
// React Router's data router: `useBlocker` — the only way to hold back in-app
// navigation when a form is dirty (UI-ROADMAP U0/UD2) — exists only there, and
// migrating later would mean touching every route.
//
// Two top-level branches, and that split is the security-relevant part:
//
//   * everything under `AppShell` gets the platform chrome, the maintenance
//     banner, the suspension notice and the session guards;
//   * everything under `PublicLayout` gets none of it and requires no session.
//
// Route ranking, not declaration order, decides the match. That is what makes
// `/:slug` safe: `/app/profile` and `/login` are static segments and therefore
// outrank a dynamic one, so a public slug can never shadow a console screen.
// Within `/app`, a `*` child catches every unmatched console path, which is what
// keeps `/app/typo` from falling through to a slug lookup — the fall-through the
// spec calls out in §3.
// ============================================================================

export const routes: RouteObject[] = [
  {
    element: <AppShell />,
    children: [
      {
        element: <RequireAnonymous />,
        children: [
          { path: '/login', element: <LoginRoute /> },
          { path: '/register', element: <RegisterRoute /> },
        ],
      },

      { path: '/forgot-password', element: <ForgotPasswordRoute /> },
      { path: '/reset-password', element: <ResetPasswordRoute /> },

      {
        path: '/app',
        // A session is all `/app` needs. What a screen may DO inside it is
        // decided per screen, because the API's answers differ per action:
        // identity edits need a usable, unimpersonated account, and the password
        // form must stay reachable by the one session the interlock admits.
        element: <RequireAuth />,
        children: [
          {
            element: <ConsoleLayout />,
            children: [
              // U2 turns this into "My pages"; until that screen exists, sending
              // someone to a list that is not there would be a worse start.
              { index: true, element: <Navigate to="/app/profile" replace /> },
              { path: 'profile', element: <ProfileRoute /> },
              { path: '*', element: <ConsoleNotFoundRoute /> },
            ],
          },
        ],
      },

      // Kept for bookmarks: `/profile` was the account screen before the console
      // namespace existed. A `profile` slug is still served at `/p/profile`, so
      // this alias costs one public address, not every one of them.
      { path: '/profile', element: <Navigate to="/app/profile" replace /> },
      { path: '/', element: <Navigate to="/app" replace /> },
      { path: '*', element: <NotFoundRoute /> },
    ],
  },

  {
    element: <PublicLayout />,
    children: [
      { path: '/p/:slug', element: <PublicPageRoute /> },
      { path: '/:slug', element: <PublicPageRoute /> },
    ],
  },
]
