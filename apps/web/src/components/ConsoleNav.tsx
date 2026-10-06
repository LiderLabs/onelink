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

const CONSOLE_LINKS: ConsoleLink[] = [{ to: '/app/profile', label: 'Profile' }]

function Links({ className }: { className?: string }) {
  return (
    <ul className={cx('space-y-0.5', className)}>
      {CONSOLE_LINKS.map((link) => (
        <li key={link.to}>
          <NavLink
            to={link.to}
            end
            className={({ isActive }) =>
              cx(
                'block border-l-2 py-1.5 pl-2 font-mono text-[0.6875rem] uppercase tracking-[0.16em] transition-colors',
                isActive
                  ? 'border-l-ink text-ink'
                  : 'border-l-transparent text-ink-soft hover:border-l-rule hover:text-ink',
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
    <nav aria-label="Console" className="lg:sticky lg:top-12">
      <details className="lg:hidden">
        <summary className="eyebrow cursor-pointer list-none select-none">
          Console menu <span aria-hidden="true">▾</span>
        </summary>
        <Links className="mt-3" />
      </details>

      <div className="hidden lg:block">
        <p className="eyebrow">Console</p>
        <Links className="mt-4" />
      </div>
    </nav>
  )
}