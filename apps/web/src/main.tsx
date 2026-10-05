import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { BrowserRouter } from 'react-router-dom'
import { App } from './App'
import { SessionProvider } from './lib/session'
import './styles.css'

const container = document.getElementById('root')
if (!container) throw new Error('The #root element is missing from index.html')

// BrowserRouter, not a hash router: the Worker serves index.html for any
// unknown path (`assets.not_found_handling: single-page-application`), so
// `/reset-password?token=…` is a real URL that survives a reload and can be
// pasted into an email — which is the whole point of a reset link.
createRoot(container).render(
  <StrictMode>
    <BrowserRouter>
      <SessionProvider>
        <App />
      </SessionProvider>
    </BrowserRouter>
  </StrictMode>,
)
