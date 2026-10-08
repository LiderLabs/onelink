import { useEffect, useRef } from 'react'
import { Link, Outlet, useLocation, useMatch } from 'react-router-dom'
import { SquaresFour, PencilSimple, Link as LinkIcon, ChartBar, ShareNetwork, Gear, SignOut, List, UserCircle } from '@phosphor-icons/react'
import { AuthIcon } from '../../components/AuthPage'
import { SuspendedNotice } from '../../components/SuspendedNotice'
import { ProfileAvatar } from '../profile/ProfileAvatar'
import { useSession } from '../../lib/session'

export function CreatorShell() {
  const session = useSession()
  const setup = Boolean(useMatch('/app/onboarding'))
  const editorMatch = useMatch('/app/pages/:id')
  const editor = Boolean(editorMatch && editorMatch.params.id !== 'new')
  const location = useLocation()
  const mobileMenu = useRef<HTMLDetailsElement>(null)
  useEffect(() => { if (mobileMenu.current) mobileMenu.current.open = false }, [location.pathname])
  const nav = [
    { to: '/app/dashboard', label: 'Overview', icon: SquaresFour },
    { to: '/app/editor', label: 'Page editor', icon: PencilSimple },
    { to: '/app/links', label: 'My links', icon: LinkIcon },
    { to: '/app/analytics', label: 'Analytics', icon: ChartBar },
    { to: '/app/share', label: 'Share & QR', icon: ShareNetwork },
    { to: '/app/profile', label: 'Profile & security', icon: UserCircle },
    { to: '/app/settings', label: 'Settings', icon: Gear },
  ]
  const maintenance = session.settings?.settings['platform.maintenance_mode']
  const isCurrent = (to: string) => location.pathname === to || (to === '/app/editor' && editor)
  const currentTitle = editor ? 'Page editor' : location.pathname === '/app/pages' ? 'My pages' : nav.find(item => item.to === location.pathname)?.label ?? 'Your workspace'
  const name = session.user?.displayName || session.user?.username || 'Your account'
  const brand = <Link to="/app" className="creator-brand" aria-label={`${session.platformName} home`}><span className="creator-brand-mark"><AuthIcon name="brand" /></span><span>{session.platformName === 'OneLink' ? <>One<span className="creator-accent">Link</span></> : session.platformName}</span></Link>
  return <div className={`creator-shell${setup ? ' creator-shell-setup' : ''}`}>
    <a href="#main" className="creator-skip">Skip to content</a>
    {!setup ? <aside className="creator-sidebar">
      {brand}
      <p className="creator-nav-label">Workspace</p>
      <nav aria-label="Creator workspace">{nav.map(({ to, label, icon: Icon }) => <Link key={to} to={to} className={isCurrent(to) ? 'is-current' : ''} aria-current={isCurrent(to) ? 'page' : undefined}><Icon size={20} weight="light" />{label}</Link>)}</nav>
      <div className="creator-sidebar-account"><ProfileAvatar avatarKey={session.user?.avatarKey ?? null} displayName={name} className="creator-avatar" /><div><strong>{name}</strong><span>Creator workspace</span></div></div>
    </aside> : null}
    <div className="creator-workspace">
      <header className={`creator-topbar${editor ? ' creator-topbar-editor' : ''}`}>
        {setup ? brand : <div className="creator-breadcrumb"><span>Workspace</span><span aria-hidden="true">›</span><strong>{currentTitle}</strong></div>}
        {setup ? <span className="creator-setup-context">Setting up your page</span> : <details ref={mobileMenu} className="creator-mobile-nav"><summary aria-label="Open navigation"><List size={23} /></summary><nav aria-label="Mobile workspace">{nav.map(item => <Link key={item.to} to={item.to}>{item.label}</Link>)}</nav></details>}
        {editor ? <div id="creator-page-actions" className="creator-page-actions" /> : null}
        <div className="creator-topbar-account">
          {setup ? <Link to="/app/dashboard" className="creator-muted-link">Exit setup</Link> : null}
          <Link to="/app/profile" className="creator-account-link" aria-label={`Profile for @${session.user?.username ?? ''}`}><ProfileAvatar avatarKey={session.user?.avatarKey ?? null} displayName={name} className="creator-avatar" /><span>@{session.user?.username}</span></Link>
          <button type="button" className="creator-icon-button" aria-label="Sign out" title="Sign out" onClick={() => void session.logout()}><SignOut size={20} weight="light" /></button>
        </div>
      </header>
      {maintenance === true || maintenance === 'true' ? <div className="creator-advisory" role="status">{String(session.settings?.settings['platform.maintenance_message'] || 'OneLink is in maintenance mode. Changes are paused.')}</div> : null}
      {session.user ? <SuspendedNotice user={session.user} /> : null}
      <main id="main" className="creator-main"><Outlet /></main>
    </div>
  </div>
}
