import { PublicLayout } from './features/public/PublicLayout'
import { PublicPageRoute } from './features/public/PublicPageRoute'
import { ConsoleLayout } from './components/ConsoleLayout'
import { AppShell } from './components/AppShell'
import { RequireAnonymous, RequireAuth } from './components/Guards'
import { ConsoleNotFoundRoute } from './routes/console-not-found'
import { ForgotPasswordRoute } from './routes/forgot-password'
import { LoginRoute } from './routes/login'
import { NotFoundRoute } from './routes/not-found'
import { RegisterRoute } from './routes/register'
import { ResetPasswordRoute } from './routes/reset-password'
import { PageCreateRoute } from './features/pages/PageCreateRoute'
import { PageListRoute } from './features/pages/PageListRoute'
import { DashboardRoute } from './features/console/DashboardRoute'
import { SubmissionsRoute } from './features/console/R2Routes'
import { EditorLayout } from './features/editor/EditorLayout'
import { ProfileTab } from './features/editor/ProfileTab'
import { LinksTab } from './features/editor/LinksTab'
import { DesignTab } from './features/editor/DesignTab'
import { AnalyticsTab } from './features/editor/AnalyticsTab'
import { SettingsTab } from './features/editor/SettingsTab'
import { Navigate, useLocation, useParams } from 'react-router-dom'
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
// `/:slug` safe: `/app` and `/login` are static segments and therefore
// outrank a dynamic one, so a public slug can never shadow a console screen.
// Within `/app`, a `*` child catches every unmatched console path, which is what
// keeps `/app/typo` from falling through to a slug lookup — the fall-through the
// spec calls out in §3.
// ============================================================================

// ---------------------------------------------------------------------------
// Compatibility redirects.
//
// The console used to edit in place on the dashboard (`/app#profile-editor`) and
// on a separate page-editor screen (`/app/pages/:id`). Editing now lives on the
// merged editor tabs, so the old addresses forward there — bookmarks and links
// keep working, and a hash deep-link (`#links-heading`) still lands on the right
// tab rather than the top of the editor.
// ---------------------------------------------------------------------------

function DashboardIndex() {
  const { hash } = useLocation()
  if (hash === '#profile-editor' || hash === '#socials') return <Navigate to="/app/editor/profile" replace />
  return <DashboardRoute />
}

function PageEditorRedirect() {
  const { id } = useParams()
  const { hash } = useLocation()
  const tab = hash === '#appearance-heading' ? 'design' : hash === '#page-address' ? 'settings' : 'links'
  const search = id ? `?page=${encodeURIComponent(id)}` : ''
  return <Navigate to={`/app/editor/${tab}${search}`} replace />
}

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
            // The merged editor is full-width and owns its own chrome, so it opts
            // out of the console rail entirely rather than nesting inside it.
            path: 'editor',
            element: <EditorLayout />,
            children: [
              { index: true, element: <Navigate to="/app/editor/profile" replace /> },
              { path: 'profile', element: <ProfileTab /> },
              { path: 'links', element: <LinksTab /> },
              { path: 'design', element: <DesignTab /> },
              { path: 'analytics', element: <AnalyticsTab /> },
              { path: 'settings', element: <SettingsTab /> },
              { path: '*', element: <ConsoleNotFoundRoute /> },
            ],
          },
          {
            element: <ConsoleLayout />,
            children: [
              { index: true, element: <DashboardIndex /> },
              // Retired addresses forward to the merged editor tabs.
              { path: 'profile', element: <Navigate to="/app/editor/profile" replace /> },
              { path: 'socials', element: <Navigate to="/app/editor/profile" replace /> },
              { path: 'analytics', element: <Navigate to="/app/editor/analytics" replace /> },
              { path: 'settings', element: <Navigate to="/app/editor/settings" replace /> },
              { path: 'submissions', element: <SubmissionsRoute /> },
              { path: 'pages', element: <PageListRoute /> },
              { path: 'pages/new', element: <PageCreateRoute /> },
              { path: 'pages/:id', element: <PageEditorRedirect /> },
              { path: '*', element: <ConsoleNotFoundRoute /> },
            ],
          },
        ],
      },

      // Kept for bookmarks: `/profile` was the account screen before the console
      // namespace existed. A `profile` slug is still served at `/p/profile`, so
      // this alias costs one public address, not every one of them.
      { path: '/profile', element: <Navigate to="/app/editor/profile" replace /> },
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
