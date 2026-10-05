import tailwindcss from '@tailwindcss/vite'
import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

// ============================================================================
// Dev server proxies /api to `wrangler dev` so the browser only ever sees ONE
// origin (localhost:5173).
//
// That is deliberate, not a convenience. The session cookie is `__Host-…`:
// the browser only accepts it when it is Secure, Path=/ and Domain-less, and it
// is scoped to the host that set it. Going through a proxy in development means
// the SPA is exercised against exactly the same-origin, credentialed path that
// production uses — no CORS preflights, no SameSite negotiation, and no
// "works in dev, fails behind the CDN" class of bug.
//
// The API allows `http://localhost:5173` as a CORS origin for tooling that
// bypasses the proxy, but nothing here depends on it.
// ============================================================================
export default defineConfig({
  plugins: [react(), tailwindcss()],
  server: {
    port: 5173,
    proxy: {
      '/api': {
        target: 'http://localhost:8787',
        changeOrigin: false,
      },
    },
  },
  build: {
    outDir: 'dist',
    // Readable stack traces in production; the bundle is small and the depth is
    // shallow enough that the size cost is irrelevant next to the debugging win.
    sourcemap: true,
  },
})
