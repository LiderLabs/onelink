import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { RouterProvider, createBrowserRouter } from 'react-router-dom'
import { routes } from './App'
import { SessionProvider } from './lib/session'
import './styles.css'

// ============================================================================
// Bootstrap.
//
// `createBrowserRouter` rather than `<BrowserRouter>`: the data router is what
// provides `useBlocker`, which is the only in-app unsaved-changes guard React
// Router offers (UI-ROADMAP U0/UD2). Session state wraps the provider, because
// the guards are routes and they read the session.
//
// No data-router loaders are used. Resources are read by the screens through
// `useResource`, so a failed read is a rendered state with a retry rather than a
// route-level error boundary, and nothing fetches for a route that is not shown.
// ============================================================================

const container = document.getElementById('root')
if (!container) throw new Error('The #root element is missing from index.html')

const router = createBrowserRouter(routes)

createRoot(container).render(
  <StrictMode>
    <SessionProvider>
      <RouterProvider router={router} />
    </SessionProvider>
  </StrictMode>,
)
