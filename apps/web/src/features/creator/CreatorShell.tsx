import { useEffect, useRef, useState } from 'react'
import { Link, Outlet, useLocation, useMatch } from 'react-router-dom'
import { SquaresFour, Files, PencilSimple, Link as LinkIcon, ChartBar, ShareNetwork, Gear, SignOut, DotsThree, X, SidebarSimple } from '@phosphor-icons/react'
import { AuthIcon } from '../../components/AuthPage'
import { SuspendedNotice } from '../../components/SuspendedNotice'
import { ProfileAvatar } from '../profile/ProfileAvatar'
import { useSession } from '../../lib/session'
import { useWorkspaceAppearance } from './workspace-appearance'
import './creator-settings.css'

const SIDEBAR_PREFERENCE = 'onelink:creator-sidebar-hidden'

export function CreatorShell() {
  const session = useSession()
  const { appearance } = useWorkspaceAppearance(session.user?.id)
  const setup = Boolean(useMatch('/app/onboarding'))
  const editorMatch = useMatch('/app/pages/:id')
  const editor = Boolean(editorMatch && editorMatch.params.id !== 'new')
  const location = useLocation()
  const [sidebarHidden, setSidebarHidden] = useState(() => {
    try { return localStorage.getItem(SIDEBAR_PREFERENCE) === 'true' } catch { return false }
  })
  const mobileMenu = useRef<HTMLDialogElement>(null)
  const [moreOpen, setMoreOpen] = useState(false)
  const closeMobileMenu = () => {
    mobileMenu.current?.close()
    setMoreOpen(false)
  }
  const toggleSidebar = () => {
    const hidden = !sidebarHidden
    // Save before updating the UI so an immediate refresh keeps this choice.
    try { localStorage.setItem(SIDEBAR_PREFERENCE, String(hidden)) } catch { /* The current page can still toggle without browser storage. */ }
    setSidebarHidden(hidden)
  }
  useEffect(() => {
    mobileMenu.current?.close()
    setMoreOpen(false)
  }, [location.pathname])
  useEffect(() => {
    const mobile = window.matchMedia('(max-width: 999px)')
    const handleResize = () => {
      if (!mobile.matches) {
        mobileMenu.current?.close()
        setMoreOpen(false)
      }
    }
    mobile.addEventListener('change', handleResize)
    return () => mobile.removeEventListener('change', handleResize)
  }, [])
  const nav = [
    { to: '/app/dashboard', label: 'Overview', icon: SquaresFour },
    { to: '/app/pages', label: 'My pages', icon: Files },
    { to: '/app/editor', label: 'Page editor', icon: PencilSimple },
    { to: '/app/links', label: 'My links', icon: LinkIcon },
    { to: '/app/analytics', label: 'Analytics', icon: ChartBar },
    { to: '/app/share', label: 'Share & QR', icon: ShareNetwork },
    { to: '/app/settings', label: 'Settings', icon: Gear },
  ]
  const maintenance = session.settings?.settings['platform.maintenance_mode']
  const settings = location.pathname === '/app/settings' || location.pathname.startsWith('/app/settings/')
  const isCurrent = (to: string) => location.pathname === to || (to === '/app/editor' && editor) || (to === '/app/settings' && settings)
  const mobilePrimary = nav.filter(item => ['/app/dashboard', '/app/editor', '/app/links', '/app/analytics'].includes(item.to))
  const mobileSecondary = nav.filter(item => ['/app/pages', '/app/share', '/app/settings'].includes(item.to))
  const moreCurrent = mobileSecondary.some(item => isCurrent(item.to))
  const currentTitle = settings ? 'Account settings' : editor ? 'Page editor' : location.pathname === '/app/pages' ? 'My pages' : nav.find(item => item.to === location.pathname)?.label ?? 'Your workspace'
  const name = session.user?.displayName || session.user?.username || 'Your account'
  const brand = <Link to="/app" className="creator-brand" aria-label={`${session.platformName} home`}><span className="creator-brand-mark"><AuthIcon name="brand" /></span><span>{session.platformName === 'OneLink' ? <>One<span className="creator-accent">Link</span></> : session.platformName}</span></Link>
  return <div className={`creator-shell${setup ? ' creator-shell-setup' : ''}${!setup && sidebarHidden ? ' creator-shell-sidebar-hidden' : ''}`} data-workspace-tone={appearance.tone} data-workspace-density={appearance.density} data-workspace-motion={appearance.motion}>
    <a href="#main" className="creator-skip">Skip to content</a>
    {!setup ? <aside className="creator-sidebar" id="creator-sidebar">
      {brand}
      <p className="creator-nav-label">Workspace</p>
      <nav aria-label="Creator workspace">{nav.map(({ to, label, icon: Icon }) => <Link key={to} to={to} className={isCurrent(to) ? 'is-current' : ''} aria-current={isCurrent(to) ? 'page' : undefined}><Icon size={20} weight="light" />{label}</Link>)}</nav>
      <div className="creator-sidebar-account"><ProfileAvatar avatarKey={session.user?.avatarKey ?? null} displayName={name} className="creator-avatar" /><div><strong>{name}</strong><span>Creator workspace</span></div></div>
    </aside> : null}
    <div className="creator-workspace">
      <header className={`creator-topbar${editor ? ' creator-topbar-editor' : ''}`}>
        {setup ? brand : <div className="creator-topbar-navigation">
          <button type="button" className="creator-icon-button creator-sidebar-toggle" aria-controls="creator-sidebar" aria-expanded={!sidebarHidden} aria-label={sidebarHidden ? 'Show sidebar' : 'Hide sidebar'} title={sidebarHidden ? 'Show sidebar' : 'Hide sidebar'} onClick={toggleSidebar}><SidebarSimple size={21} weight="light" aria-hidden="true" /></button>
          <div className="creator-breadcrumb"><span>Workspace</span><span aria-hidden="true">›</span><strong>{currentTitle}</strong></div>
        </div>}
        {setup ? <span className="creator-setup-context">Setting up your page</span> : null}
        {editor ? <div id="creator-page-actions" className="creator-page-actions" /> : null}
        <div className="creator-topbar-account">
          {setup ? <Link to="/app/dashboard" className="creator-muted-link">Exit setup</Link> : null}
          <Link to="/app/settings/profile" className="creator-account-link" aria-label={`Account settings for @${session.user?.username ?? ''}`}><ProfileAvatar avatarKey={session.user?.avatarKey ?? null} displayName={name} className="creator-avatar" /><span>@{session.user?.username}</span></Link>
          <button type="button" className="creator-icon-button" aria-label="Sign out" title="Sign out" onClick={() => void session.logout()}><SignOut size={20} weight="light" /></button>
        </div>
      </header>
      {maintenance === true || maintenance === 'true' ? <div className="creator-advisory" role="status">{String(session.settings?.settings['platform.maintenance_message'] || 'OneLink is in maintenance mode. Changes are paused.')}</div> : null}
      {session.user ? <SuspendedNotice user={session.user} /> : null}
      <main id="main" className="creator-main"><Outlet /></main>
    </div>
    {!setup ? <>
      <nav className="creator-bottom-nav" aria-label="Mobile workspace">
        {mobilePrimary.map(({ to, label, icon: Icon }) => <Link key={to} to={to} className={isCurrent(to) ? 'is-current' : ''} aria-current={isCurrent(to) ? 'page' : undefined}><Icon size={23} weight={isCurrent(to) ? 'fill' : 'regular'} aria-hidden="true" /><span>{label === 'Page editor' ? 'Editor' : label === 'My links' ? 'Links' : label}</span></Link>)}
        <button type="button" className={moreCurrent || moreOpen ? 'is-current' : ''} aria-current={moreCurrent ? 'true' : undefined} aria-haspopup="dialog" aria-controls="creator-mobile-more" aria-expanded={moreOpen} onClick={() => { mobileMenu.current?.showModal(); setMoreOpen(true) }}><DotsThree size={23} weight="bold" aria-hidden="true" /><span>More</span></button>
      </nav>
      <dialog ref={mobileMenu} id="creator-mobile-more" className="creator-mobile-sheet" aria-labelledby="creator-mobile-more-title" onClose={() => setMoreOpen(false)} onClick={event => { if (event.target === event.currentTarget) closeMobileMenu() }}>
        <div className="creator-mobile-sheet-heading"><div><h2 id="creator-mobile-more-title">More from your workspace</h2><p>Your pages, sharing, and account.</p></div><button type="button" className="creator-icon-button" aria-label="Close menu" onClick={closeMobileMenu}><X size={20} aria-hidden="true" /></button></div>
        <nav aria-label="More workspace pages">{mobileSecondary.map(({ to, label, icon: Icon }) => <Link key={to} to={to} className={isCurrent(to) ? 'is-current' : ''} aria-current={isCurrent(to) ? 'page' : undefined} onClick={closeMobileMenu}><Icon size={24} aria-hidden="true" /><span>{label}</span></Link>)}</nav>
      </dialog>
    </> : null}
  </div>
}
