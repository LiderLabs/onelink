import { Outlet, useMatch } from 'react-router-dom'

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
  const overview = useMatch('/app/dashboard')
  const setup = useMatch('/app/onboarding')
  const links = useMatch('/app/links')
  const analytics = useMatch('/app/analytics')
  const share = useMatch('/app/share')
  const settings = useMatch('/app/settings')
  const editor = useMatch('/app/pages/:id')
  const editorEntry = useMatch('/app/editor')
  return (
    <div className={overview || setup || links || analytics || share || settings || editorEntry || (editor && editor.params.id !== 'new') ? 'min-w-0' : 'creator-legacy min-w-0'}>
      <Outlet />
    </div>
  )
}
