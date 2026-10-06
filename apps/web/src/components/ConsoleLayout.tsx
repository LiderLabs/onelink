import { Outlet } from 'react-router-dom'
import { ConsoleNav } from './ConsoleNav'

// ============================================================================
// Inside the console: a rail and the screen.
//
// Separate from `AppShell` (which owns the masthead, advisories and footer)
// because these two nested layouts change for different reasons — the shell is
// the platform's chrome, this is the signed-in product's furniture — and because
// a future full-width console screen (the page editor, U3) can opt out of the
// rail by being routed outside this layout.
//
// `min-w-0` on the content column is load-bearing: without it a wide child (a
// long URL in a list row) pushes the grid wider than the viewport instead of
// scrolling inside itself.
// ============================================================================

export function ConsoleLayout() {
  return (
    <div className="grid gap-8 lg:grid-cols-[9rem_minmax(0,1fr)] lg:gap-14">
      <ConsoleNav />
      <div className="min-w-0">
        <Outlet />
      </div>
    </div>
  )
}