import { useEffect, useRef, useState } from 'react'
import { Link, NavLink, Outlet, useLocation } from 'react-router-dom'
import { ArrowLeft, ClockCounterClockwise, Flag, Gear, List, ShieldCheck, SidebarSimple, SignOut, SquaresFour, Users, X } from '@phosphor-icons/react'
import { AuthIcon } from '../../components/AuthPage'
import { ProfileAvatar } from '../profile/ProfileAvatar'
import { useSession } from '../../lib/session'
import './admin.css'

export function AdminShell() {
  const session = useSession()
  const location = useLocation()
  const [hidden, setHidden] = useState(false)
  const [menu, setMenu] = useState(false)
  const sheet = useRef<HTMLDialogElement>(null)
  const nav = [
    { to: '/admin', label: 'Overview', icon: SquaresFour, capability: null },
    { to: '/admin/users', label: 'Users', icon: Users, capability: 'users.read' },
    { to: '/admin/reports', label: 'Reports', icon: Flag, capability: 'reports.read' },
    { to: '/admin/appeals', label: 'Appeals', icon: ShieldCheck, capability: 'appeals.read' },
    { to: '/admin/settings', label: 'System Settings', icon: Gear, capability: 'settings.read' },
    { to: '/admin/audit', label: 'Audit Log', icon: ClockCounterClockwise, capability: 'audit.read' },
  ].filter(item => !item.capability || session.can(item.capability))
  const current = nav.find(item => item.to === location.pathname)?.label ?? 'Admin'
  const close = () => { sheet.current?.close(); setMenu(false) }
  useEffect(() => { sheet.current?.close(); setMenu(false); document.title = `${current} · OneLink Admin` }, [location.pathname, current])
  useEffect(() => {
    const query = matchMedia('(min-width: 1000px)')
    const change = () => { if (query.matches) close() }
    query.addEventListener('change', change)
    return () => query.removeEventListener('change', change)
  }, [])
  const navigation = <nav aria-label="Admin pages">{nav.map(({ to, label, icon: Icon }) => <NavLink key={to} to={to} end={to === '/admin'} onClick={close} className={({ isActive }) => isActive ? 'is-current' : ''}><Icon size={21} aria-hidden="true" />{label}</NavLink>)}</nav>
  const name = session.user?.displayName || session.user?.username || 'Administrator'
  return <div className={`admin-shell${hidden ? ' admin-sidebar-hidden' : ''}`}>
    <a className="admin-skip" href="#admin-main">Skip to content</a>
    <aside className="admin-sidebar" id="admin-sidebar"><Link to="/admin" className="admin-brand"><span className="admin-brand-mark"><AuthIcon name="brand" /></span><span>One<span>Link</span></span></Link><p className="admin-nav-label">Workspace</p>{navigation}<div className="admin-sidebar-footer"><ShieldCheck size={22} /><strong>Administrator access</strong><p>Sensitive operations require permission and are recorded.</p><Link to="/app/dashboard"><ArrowLeft size={15} />Creator dashboard</Link></div></aside>
    <div className="admin-workspace"><header className="admin-topbar"><div className="admin-topbar-navigation"><button type="button" className="admin-icon-button admin-desktop-toggle" aria-controls="admin-sidebar" aria-expanded={!hidden} aria-label={hidden ? 'Show sidebar' : 'Hide sidebar'} onClick={() => setHidden(value => !value)}><SidebarSimple size={22} /></button><button type="button" className="admin-icon-button admin-mobile-toggle" aria-haspopup="dialog" aria-expanded={menu} aria-label="Open admin navigation" onClick={() => { sheet.current?.showModal(); setMenu(true) }}><List size={22} /></button><div className="admin-breadcrumb"><Link to="/admin">Admin</Link><span aria-hidden="true">/</span><strong>{current}</strong></div></div><div className="admin-account"><span className="admin-role"><ShieldCheck size={14} />{session.user?.role}</span><Link to="/app/settings/profile" className="admin-account-link" aria-label="Account settings"><ProfileAvatar avatarKey={session.user?.avatarKey ?? null} displayName={name} className="admin-avatar" /><span>{name}</span></Link><button type="button" className="admin-icon-button" aria-label="Sign out" onClick={() => void session.logout()}><SignOut size={20} /></button></div></header><main className="admin-main" id="admin-main"><Outlet /></main></div>
    <dialog ref={sheet} className="admin-mobile-sheet" aria-labelledby="admin-mobile-title" onClose={() => setMenu(false)} onClick={event => { if (event.target === event.currentTarget) close() }}><header><h2 id="admin-mobile-title">Admin navigation</h2><button type="button" className="admin-icon-button" aria-label="Close navigation" onClick={close}><X size={20} /></button></header>{navigation}<Link to="/app/dashboard" className="admin-button" onClick={close}><ArrowLeft size={17} />Creator dashboard</Link></dialog>
  </div>
}
