import { useEffect, useRef, useState } from 'react'
import type { FormEvent } from 'react'
import { useSearchParams } from 'react-router-dom'
import { errorMessageFor } from '../../lib/api'
import type { ListResponse } from '../../lib/api'
import { useSession } from '../../lib/session'
import type { PublicUser, Role, UserStatus } from '../../lib/types'
import { AdminBadge, AdminForbidden, AdminHeading, AdminLoading, AdminNotice, AdminPagination } from './AdminUI'
import { CreateUserDialog, EditUserDialog, UserActionDialog } from './AdminUserDialogs'
import type { UserAction } from './AdminUserDialogs'
import { adminUserDate, canEditUser, canModerateUser, USER_ROLES, USER_STATUSES, usersApi } from './users-api'
import type { UserDetail, UserNote, UsersQuery, UserSession } from './users-api'
import './admin-users.css'

const initialQuery: UsersQuery = { q: '', role: '', status: '', sort: 'newest', page: 1, limit: 20, includeDeleted: false }

export function AdminUsersRoute() {
  const { can } = useSession()
  const canRead = can('users.read')
  const [params, setParams] = useSearchParams()
  const selectedId = params.get('user') ?? params.get('id')
  const [query, setQuery] = useState<UsersQuery>(initialQuery)
  const [search, setSearch] = useState('')
  const [result, setResult] = useState<ListResponse<PublicUser> | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<unknown>(null)
  const [reload, setReload] = useState(0)
  const [createOpen, setCreateOpen] = useState(false)
  const [notice, setNotice] = useState('')
  useEffect(() => {
    if (!canRead) return
    let current = true
    setLoading(true); setError(null)
    void usersApi.list(query).then(data => { if (current) setResult(data) }).catch(failure => { if (current) setError(failure) }).finally(() => { if (current) setLoading(false) })
    return () => { current = false }
  }, [canRead, query, reload])
  function select(id: string | null) {
    const next = new URLSearchParams(params)
    next.delete('id')
    if (id) next.set('user', id)
    else next.delete('user')
    setParams(next, { replace: true })
  }
  function changed(user: PublicUser, message?: string) {
    setResult(previous => previous ? { ...previous, items: previous.items.map(item => item.id === user.id ? user : item) } : previous)
    setReload(value => value + 1)
    if (message) setNotice(message)
  }
  if (!canRead) return <AdminForbidden />
  return <div className="admin-stack">
    <AdminHeading title="Users" description="Manage accounts, access and account history." eyebrow="WORKSPACE / USERS">
      {can('users.create') && <button className="admin-button admin-button-primary" onClick={() => setCreateOpen(true)}>Create user</button>}
    </AdminHeading>
    {notice && <AdminNotice tone="success">{notice}</AdminNotice>}
    <div className={`admin-users-layout${selectedId ? ' has-detail' : ''}`}>
      <section className="admin-card admin-users-list" aria-label="User directory">
        <form className="admin-toolbar admin-user-search" onSubmit={(event: FormEvent<HTMLFormElement>) => { event.preventDefault(); setQuery(previous => ({ ...previous, q: search.trim(), page: 1 })) }}>
          <label className="admin-field admin-user-search-input"><span>Search users</span><input aria-label="Search users" type="search" placeholder="Name, email or username" value={search} maxLength={200} onChange={event => setSearch(event.target.value)} /></label>
          <button className="admin-button">Search</button>
        </form>
        <div className="admin-toolbar admin-user-filters">
          <label className="admin-field">Role<select aria-label="Role filter" value={query.role} onChange={event => setQuery(previous => ({ ...previous, role: event.target.value as Role | '', page: 1 }))}><option value="">All roles</option>{USER_ROLES.map(value => <option key={value} value={value}>{value}</option>)}</select></label>
          <label className="admin-field">Status<select aria-label="Status filter" value={query.status} onChange={event => setQuery(previous => ({ ...previous, status: event.target.value as UserStatus | '', page: 1 }))}><option value="">All statuses</option>{USER_STATUSES.map(value => <option key={value} value={value}>{value}</option>)}</select></label>
          <label className="admin-field">Sort<select aria-label="Sort users" value={query.sort} onChange={event => setQuery(previous => ({ ...previous, sort: event.target.value, page: 1 }))}><option value="newest">Newest first</option><option value="oldest">Oldest first</option><option value="updated">Recently updated</option><option value="name">Username A–Z</option><option value="last-login">Last login</option></select></label>
        </div>
        <div className="admin-user-list-meta"><span>{result ? `${result.meta.total.toLocaleString()} accounts` : 'Accounts'}</span><label className="admin-user-check"><input type="checkbox" checked={query.includeDeleted} onChange={event => setQuery(previous => ({ ...previous, includeDeleted: event.target.checked, page: 1 }))} />Include deleted</label></div>
        {Boolean(error) && <AdminNotice tone="error"><p>{errorMessageFor(error)}</p><button className="admin-button" onClick={() => setReload(value => value + 1)}>Retry user list</button></AdminNotice>}
        {loading && <AdminLoading label="Loading users…" />}
        {!loading && !error && result?.items.length === 0 && <div className="admin-empty"><h2>No matching users</h2><p>Try a different search or filter.</p></div>}
        {result && !error && <div className="admin-table-scroll" aria-busy={loading}>
          <table className="admin-users-table"><thead><tr><th scope="col">Account</th><th scope="col">Role</th><th scope="col">Status</th><th scope="col">Joined</th><th scope="col" aria-label="Details" /></tr></thead>
            <tbody>{result.items.map(item => <tr key={item.id} className={item.id === selectedId ? 'is-selected' : ''} onClick={event => { if (!(event.target as HTMLElement).closest('button, a, input, select, textarea')) select(item.id) }}>
              <td><div className="admin-user-identity"><span className="admin-user-avatar" aria-hidden="true">{item.avatarUrl ? <img src={item.avatarUrl} alt="" /> : item.displayName.slice(0, 2).toUpperCase()}</span><span><strong>{item.displayName}</strong><small>{item.email}</small></span></div></td>
              <td><AdminBadge value={item.role} /></td><td><AdminBadge value={item.status} /></td><td className="admin-user-date">{new Date(item.createdAt).toLocaleDateString(undefined, { dateStyle: 'medium' })}</td>
              <td><button className="admin-button" aria-label={`View ${item.displayName}`} aria-pressed={item.id === selectedId} onClick={() => select(item.id)}>View</button></td>
            </tr>)}</tbody>
          </table>
        </div>}
        {result && <AdminPagination meta={result.meta} disabled={loading} onPage={page => setQuery(previous => ({ ...previous, page }))} />}
      </section>
      {selectedId && <UserDetailPanel key={selectedId} id={selectedId} onClose={() => select(null)} onChanged={changed} />}
    </div>
    <CreateUserDialog open={createOpen} onClose={() => setCreateOpen(false)} onCreated={() => { setReload(value => value + 1); setNotice('Account created. A password change is required on first login.') }} />
  </div>
}

function UserDetailPanel({ id, onClose, onChanged }: { id: string; onClose: () => void; onChanged: (user: PublicUser, message?: string) => void }) {
  const { can, user: actor, refreshProfile } = useSession()
  const canRead = can('users.read')
  const canReadNotes = can('users.notes.read')
  const [detail, setDetail] = useState<UserDetail | null>(null)
  const [error, setError] = useState<unknown>(null)
  const [loading, setLoading] = useState(true)
  const [reload, setReload] = useState(0)
  const [notes, setNotes] = useState<ListResponse<UserNote> | null>(null)
  const [notePage, setNotePage] = useState(1)
  const [noteReload, setNoteReload] = useState(0)
  const [noteError, setNoteError] = useState<unknown>(null)
  const [notesLoading, setNotesLoading] = useState(false)
  const [note, setNote] = useState('')
  const [notePending, setNotePending] = useState(false)
  const [sessions, setSessions] = useState<UserSession[] | null>(null)
  const [sessionError, setSessionError] = useState<unknown>(null)
  const [editOpen, setEditOpen] = useState(false)
  const [action, setAction] = useState<UserAction | null>(null)
  const noteLock = useRef(false)
  const mounted = useRef(true)
  useEffect(() => { mounted.current = true; return () => { mounted.current = false } }, [])
  useEffect(() => {
    if (!canRead) return
    let current = true
    setLoading(true); setError(null); setSessionError(null)
    void usersApi.detail(id).then(data => { if (current) setDetail(data) }).catch(failure => { if (current) setError(failure) }).finally(() => { if (current) setLoading(false) })
    void usersApi.sessions(id).then(data => { if (current) setSessions(data.sessions) }).catch(failure => { if (current) setSessionError(failure) })
    return () => { current = false }
  }, [id, reload, canRead])
  useEffect(() => {
    if (!canReadNotes) return
    let current = true
    setNotesLoading(true); setNoteError(null)
    void usersApi.notes(id, notePage).then(data => { if (current) setNotes(data) }).catch(failure => { if (current) setNoteError(failure) }).finally(() => { if (current) setNotesLoading(false) })
    return () => { current = false }
  }, [id, notePage, noteReload, canReadNotes])
  function updated(user: PublicUser, message?: string) {
    if (!mounted.current) return
    setDetail(previous => previous ? { ...previous, user } : previous)
    onChanged(user, message)
    setReload(value => value + 1)
    // Editing the current staff account may change its role. Re-read the session
    // so capability grants are adopted from the API before enabling more work.
    if (user.id === actor?.id) void refreshProfile().catch(failure => { if (mounted.current) setError(failure) })
  }
  async function addNote(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (!can('users.notes.write') || noteLock.current || !note.trim()) return
    noteLock.current = true; setNotePending(true); setNoteError(null)
    try {
      await usersApi.addNote(id, note.trim())
      if (mounted.current) { setNote(''); setNotePage(1); setNoteReload(value => value + 1); setDetail(previous => previous ? { ...previous, counts: { ...previous.counts, notes: previous.counts.notes + 1 } } : previous) }
    } catch (failure) { if (mounted.current) setNoteError(failure) }
    finally { noteLock.current = false; if (mounted.current) setNotePending(false) }
  }
  const target = detail?.user
  const mayEdit = Boolean(actor && target && canEditUser(actor, target))
  const mayModerate = Boolean(actor && target && canModerateUser(actor, target))
  return <aside className="admin-card admin-user-detail admin-stack" aria-label="User details">
    <div className="admin-user-section-head"><span className="admin-user-kicker">ACCOUNT DETAILS</span><button className="admin-button" onClick={onClose} aria-label="Close user details">Close</button></div>
    {loading && !detail && <AdminLoading label="Loading user details…" />}
    {Boolean(error) && <AdminNotice tone="error"><p>{errorMessageFor(error)}</p><button className="admin-button" onClick={() => setReload(value => value + 1)}>Retry user details</button></AdminNotice>}
    {target && <>
      <header className="admin-user-profile"><span className="admin-user-avatar admin-user-avatar-large" aria-hidden="true">{target.avatarUrl ? <img src={target.avatarUrl} alt="" /> : target.displayName.slice(0, 2).toUpperCase()}</span><h2>{target.displayName}</h2><p>{target.email}</p><div className="admin-actions"><AdminBadge value={target.role} /><AdminBadge value={target.status} /></div></header>
      <dl className="admin-detail-list"><div><dt>Account username</dt><dd>@{target.username}</dd></div><div><dt>Account ID</dt><dd>{target.id}</dd></div><div><dt>Joined</dt><dd>{adminUserDate(target.createdAt)}</dd></div><div><dt>Last login</dt><dd>{adminUserDate(target.lastLoginAt)}</dd></div><div><dt>Email verified</dt><dd>{target.emailVerified ? 'Yes' : 'No'}</dd></div><div><dt>Password change required</dt><dd>{target.requirePasswordChange ? 'Yes' : 'No'}</dd></div>{target.statusReason && <div><dt>Status reason</dt><dd>{target.statusReason}</dd></div>}{target.status === 'suspended' && <div><dt>Suspension ends</dt><dd>{target.suspendedPermanently ? 'Until manually reactivated' : adminUserDate(target.suspendedUntil)}</dd></div>}{target.bio && <div><dt>Bio</dt><dd>{target.bio}</dd></div>}</dl>
      <div className="admin-user-counts" aria-label="Account activity counts">{Object.entries(detail.counts).map(([key, value]) => <div key={key}><strong>{value.toLocaleString()}</strong><span>{{ pages: 'Pages', sessions: 'Sessions', sanctions: 'Sanctions', notes: 'Notes', reportsAgainst: 'Reports against', reportsFiled: 'Reports filed' }[key]}</span></div>)}</div>
      <section className="admin-stack"><h3>Account actions</h3>
        <div className="admin-actions">
          {can('users.update') && <button className="admin-button" disabled={!mayEdit} onClick={() => setEditOpen(true)}>Edit user</button>}
          {can('users.sanction') && <><button className="admin-button" disabled={!mayModerate || target.status === 'deleted'} onClick={() => setAction('warn')}>Warn</button><button className="admin-button" disabled={!mayModerate || target.status === 'deleted'} onClick={() => setAction('suspend')}>Suspend</button><button className="admin-button admin-button-danger" disabled={!mayModerate || target.status === 'deleted' || target.status === 'banned'} onClick={() => setAction('ban')}>Ban</button>{['suspended', 'banned', 'pending'].includes(target.status) && <button className="admin-button admin-button-primary" disabled={!mayModerate} onClick={() => setAction('reactivate')}>Reactivate</button>}</>}
          {can('users.delete') && <button className="admin-button admin-button-danger" disabled={!mayModerate || target.status === 'deleted'} onClick={() => setAction('delete')}>Delete</button>}
          {can('users.impersonate') && <button className="admin-button" disabled title="Account impersonation is unavailable: no supported API endpoint.">Impersonate</button>}
        </div>
        {!mayModerate && (can('users.sanction') || can('users.delete') || can('users.sessions.revoke')) && <p className="admin-help">{actor?.id === target.id ? 'You cannot moderate your own account.' : 'Moderation requires a lower-ranked account. Owners may moderate another owner.'}</p>}
        {can('users.impersonate') && <p className="admin-help">Impersonation is unavailable on this platform.</p>}
      </section>
      <section className="admin-stack"><div className="admin-user-section-head"><h3>Active sessions</h3>{can('users.sessions.revoke') && <button className="admin-button" disabled={!mayModerate || !sessions?.length} onClick={() => setAction('sessions')}>Revoke all sessions</button>}</div>
        {Boolean(sessionError) && <AdminNotice tone="error"><p>{errorMessageFor(sessionError)}</p><button className="admin-button" onClick={() => setReload(value => value + 1)}>Retry sessions</button></AdminNotice>}
        {!sessions && !sessionError && <AdminLoading label="Loading sessions…" />}
        {sessions?.length === 0 && <p className="admin-help">No active sessions.</p>}
        {sessions?.map(session => <div className="admin-user-record" key={session.id}><strong>{session.deviceLabel ?? session.userAgent ?? 'Unknown device'}</strong><p>{session.ip ?? 'IP unavailable'} · Last used {adminUserDate(session.lastUsedAt)}</p><small>Expires {adminUserDate(session.expiresAt)}</small>{session.impersonatedBy && <p>Impersonated by {session.impersonatedBy}</p>}</div>)}
      </section>
      {canReadNotes && <section className="admin-stack"><h3>Internal notes</h3>
        {Boolean(noteError) && <AdminNotice tone="error"><p>{errorMessageFor(noteError)}</p><button className="admin-button" onClick={() => setNoteReload(value => value + 1)}>Retry notes</button></AdminNotice>}
        {can('users.notes.write') && <form className="admin-stack" onSubmit={addNote}><label className="admin-field">Internal note<textarea rows={3} value={note} maxLength={4000} required onChange={event => setNote(event.target.value)} disabled={notePending} /></label><div className="admin-actions"><button className="admin-button" disabled={notePending || !note.trim()}>{notePending ? 'Adding…' : 'Add note'}</button></div></form>}
        {notesLoading && <AdminLoading label="Loading notes…" />}
        {!notesLoading && notes?.items.length === 0 && <p className="admin-help">No notes yet.</p>}
        {notes?.items.map(item => <article className="admin-user-record" key={item.id}><p className="admin-user-note-body">{item.body}</p><small>{item.authorLabel ?? 'Staff'} · {adminUserDate(item.createdAt)}</small></article>)}
        {notes && notes.meta.totalPages > 1 && <AdminPagination meta={notes.meta} disabled={notesLoading} onPage={setNotePage} />}
      </section>}
      <section className="admin-stack"><h3>Recent sanctions</h3>{detail.sanctions.length === 0 && <p className="admin-help">No sanctions recorded.</p>}{detail.sanctions.map(sanction => <article className="admin-user-record" key={sanction.id}><div className="admin-user-section-head"><strong>{sanction.type}</strong><AdminBadge value={sanction.status} /></div><p>{sanction.reason}</p><small>{sanction.issuedByLabel ?? 'Staff'} · {adminUserDate(sanction.createdAt)}</small>{sanction.expiresAt !== null && <p>Expires {adminUserDate(sanction.expiresAt)}</p>}</article>)}</section>
      <EditUserDialog target={editOpen ? target : null} onClose={() => setEditOpen(false)} onUpdated={updated} />
      <UserActionDialog action={action} target={action ? target : null} onClose={() => setAction(null)} onDone={updated} />
    </>}
  </aside>
}
