import { NavLink } from 'react-router-dom'
import { cx } from '../lib/css'

// ============================================================================
// The console's navigation.
//
// It lists only screens that EXIST. A nav entry that 404s is worse than a nav
// that grows one row per phase, so "My pages" arrives with U2 and the staff
// sections arrive when their capabilities can actually be granted (R2+).
//
// Desktop gets a fixed rail; small screens get a native `<details>` disclosure,
// which is keyboard- and touch-operable and needs no state of ours to keep in
// sync with the route.
// ============================================================================

interface ConsoleLink {
  to: string
  label: string
}

const CONSOLE_LINKS: ConsoleLink[] = [
  { to: '/app', label: 'Dashboard' },
  { to: '/app/pages', label: 'My pages' },
  { to: '/app/editor', label: 'Editor' },
]

function Links({ className }: { className?: string }) {
  return (
    <ul className={cx('flex min-w-max items-center gap-5 sm:gap-8', className)}>
      {CONSOLE_LINKS.map((link) => (
        <li key={link.to}>
          <NavLink
            to={link.to}
            end={link.to === '/app'}
            className={({ isActive }) =>
              cx(
                'flex shrink-0 items-center border-b-2 border-transparent px-0 py-3 font-sans text-sm normal-case tracking-normal transition-colors duration-150',
                isActive
                  ? 'border-ink font-semibold text-ink'
                  : 'text-ink-soft hover:text-ink',
              )
            }
          >
            {link.label}
          </NavLink>
        </li>
      ))}
    </ul>
  )
}

export function ConsoleNav() {
  return (
    <nav aria-label="Console" className="border-b border-rule">
      <Links className="w-max min-w-full overflow-x-auto" />
    </nav>
  )
}
