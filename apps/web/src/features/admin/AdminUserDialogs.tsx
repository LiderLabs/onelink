import { useEffect, useRef, useState } from 'react'
import type { FormEvent } from 'react'
import { errorMessageFor, fieldErrorsFrom } from '../../lib/api'
import { useSession } from '../../lib/session'
import type { PublicUser, Role } from '../../lib/types'
import { AdminDialog, AdminNotice } from './AdminUI'
import { canEditUser, canModerateUser, grantableRoles, usersApi } from './users-api'
import type { UpdateUserInput } from './users-api'

function FormError({ error }: { error: unknown }) {
  if (!error) return null
  const issues = fieldErrorsFrom(error)
  return <AdminNotice tone="error"><p>{errorMessageFor(error)}</p>{Object.entries(issues).map(([field, message]) => <p key={field}>{field}: {message}</p>)}</AdminNotice>
}

export function CreateUserDialog({ open, onClose, onCreated }: { open: boolean; onClose: () => void; onCreated?: () => void }) {
  const { can, user } = useSession()
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [username, setUsername] = useState('')
  const [displayName, setDisplayName] = useState('')
  const [role, setRole] = useState<Role>('user')
  const [pending, setPending] = useState(false)
  const [error, setError] = useState<unknown>(null)
  const lock = useRef(false)
  useEffect(() => { if (open) { setEmail(''); setPassword(''); setUsername(''); setDisplayName(''); setRole('user'); setError(null) } }, [open])
  const allowed = can('users.create') && Boolean(user && grantableRoles(user.role).includes(role))
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (lock.current || !allowed) return
    lock.current = true; setPending(true); setError(null)
    try {
      await usersApi.create({ email: email.trim(), password, ...(username.trim() ? { username: username.trim() } : {}), ...(displayName.trim() ? { displayName: displayName.trim() } : {}), role, requirePasswordChange: true })
      setPassword(''); onCreated?.(); onClose()
    } catch (failure) { setError(failure) }
    finally { lock.current = false; setPending(false) }
  }
  return <AdminDialog open={open && can('users.create')} title="Create user" description="Provision an account with a temporary password." onClose={onClose} pending={pending}>
    <form className="admin-stack" onSubmit={submit}>
      <FormError error={error} />
      <label className="admin-field">Email<input autoFocus type="email" autoComplete="off" value={email} onChange={event => setEmail(event.target.value)} required maxLength={320} disabled={pending} /></label>
      <label className="admin-field">Temporary password<input type="password" autoComplete="new-password" value={password} onChange={event => setPassword(event.target.value)} required minLength={8} maxLength={200} disabled={pending} /></label>
      <div className="admin-split">
        <label className="admin-field">Username (optional)<input value={username} onChange={event => setUsername(event.target.value)} minLength={3} maxLength={32} pattern="[a-zA-Z0-9._\-]+" disabled={pending} /></label>
        <label className="admin-field">Display name (optional)<input value={displayName} onChange={event => setDisplayName(event.target.value)} maxLength={80} disabled={pending} /></label>
      </div>
      <label className="admin-field">Role<select value={role} onChange={event => setRole(event.target.value as Role)} disabled={pending}>{user && grantableRoles(user.role).map(value => <option key={value} value={value}>{value}</option>)}</select></label>
      <p className="admin-help">The user must change this password on first login. Share their sign-in details securely. Creating an account does not send an invitation email.</p>
      <div className="admin-actions"><button type="button" className="admin-button" onClick={onClose} disabled={pending}>Cancel</button><button className="admin-button admin-button-primary" disabled={pending || !allowed}>{pending ? 'Creating…' : 'Create user'}</button></div>
    </form>
  </AdminDialog>
}

export function EditUserDialog({ target, onClose, onUpdated }: { target: PublicUser | null; onClose: () => void; onUpdated: (user: PublicUser) => void }) {
  const { can, user } = useSession()
  const [email, setEmail] = useState('')
  const [username, setUsername] = useState('')
  const [displayName, setDisplayName] = useState('')
  const [bio, setBio] = useState('')
  const [role, setRole] = useState<Role>('user')
  const [pending, setPending] = useState(false)
  const [error, setError] = useState<unknown>(null)
  const lock = useRef(false)
  useEffect(() => { if (target) { setEmail(target.email); setUsername(target.username); setDisplayName(target.displayName); setBio(target.bio ?? ''); setRole(target.role); setError(null) } }, [target])
  const allowed = Boolean(user && target && can('users.update') && canEditUser(user, target))
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (lock.current || !target || !allowed) return
    const input: UpdateUserInput = {}
    if (email.trim() !== target.email) input.email = email.trim()
    if (username.trim() !== target.username) input.username = username.trim()
    if (displayName.trim() !== target.displayName) input.displayName = displayName.trim()
    if ((bio.trim() || null) !== target.bio) input.bio = bio.trim() || null
    if (role !== target.role && can('users.role.assign') && user && grantableRoles(user.role).includes(role)) input.role = role
    if (!Object.keys(input).length) { onClose(); return }
    lock.current = true; setPending(true); setError(null)
    try { const updated = await usersApi.update(target.id, input); onUpdated(updated); onClose() }
    catch (failure) { setError(failure) }
    finally { lock.current = false; setPending(false) }
  }
  return <AdminDialog open={Boolean(target) && allowed} title="Edit user" description={target ? `Update ${target.displayName}'s account details.` : undefined} onClose={onClose} pending={pending}>
    <form className="admin-stack" onSubmit={submit}>
      <FormError error={error} />
      <label className="admin-field">Display name<input autoFocus value={displayName} maxLength={80} onChange={event => setDisplayName(event.target.value)} disabled={pending} /></label>
      <label className="admin-field">Email<input type="email" value={email} required maxLength={320} onChange={event => setEmail(event.target.value)} disabled={pending} /></label>
      <label className="admin-field">Username<input value={username} required minLength={3} maxLength={32} pattern="[a-zA-Z0-9._\-]+" onChange={event => setUsername(event.target.value)} disabled={pending} /></label>
      <label className="admin-field">Bio<textarea value={bio} maxLength={500} rows={3} onChange={event => setBio(event.target.value)} disabled={pending} /></label>
      {can('users.role.assign') && user && <label className="admin-field">Role<select value={role} onChange={event => setRole(event.target.value as Role)} disabled={pending}>{target && !grantableRoles(user.role).includes(target.role) && <option value={target.role}>{target.role} (current)</option>}{grantableRoles(user.role).map(value => <option key={value} value={value}>{value}</option>)}</select></label>}
      <div className="admin-actions"><button type="button" className="admin-button" onClick={onClose} disabled={pending}>Cancel</button><button className="admin-button admin-button-primary" disabled={pending || !allowed}>{pending ? 'Saving…' : 'Save changes'}</button></div>
    </form>
  </AdminDialog>
}

export type UserAction = 'warn' | 'suspend' | 'ban' | 'reactivate' | 'delete' | 'sessions'
const actionText: Record<UserAction, { title: string; submit: string; description: string }> = {
  warn: { title: 'Warn user', submit: 'Confirm warning', description: 'Record a warning. The account stays in its current status.' },
  suspend: { title: 'Suspend user', submit: 'Confirm suspension', description: 'Restrict this account and revoke its active sessions.' },
  ban: { title: 'Ban user', submit: 'Confirm ban', description: 'Ban this account and revoke its active sessions.' },
  reactivate: { title: 'Reactivate user', submit: 'Confirm reactivation', description: 'Lift active bans and suspensions and restore account access.' },
  delete: { title: 'Delete user', submit: 'Confirm deletion', description: 'Soft-delete the account and revoke its sessions. Deleted accounts cannot be reactivated here.' },
  sessions: { title: 'Revoke all sessions', submit: 'Confirm revocation', description: 'Sign the user out on every device. Their account remains available.' },
}
export function UserActionDialog({ action, target, onClose, onDone }: { action: UserAction | null; target: PublicUser | null; onClose: () => void; onDone: (user: PublicUser, message: string) => void }) {
  const { can, user } = useSession()
  const [reason, setReason] = useState('')
  const [duration, setDuration] = useState('24')
  const [permanent, setPermanent] = useState(false)
  const [confirmed, setConfirmed] = useState(false)
  const [pending, setPending] = useState(false)
  const [error, setError] = useState<unknown>(null)
  const lock = useRef(false)
  useEffect(() => { setReason(''); setDuration('24'); setPermanent(false); setConfirmed(false); setError(null) }, [action, target?.id])
  const capability = action === 'delete' ? 'users.delete' : action === 'sessions' ? 'users.sessions.revoke' : 'users.sanction'
  const allowed = Boolean(target && user && action && can(capability) && canModerateUser(user, target))
  const hours = Number(duration)
  const validDuration = action !== 'suspend' || permanent || (Number.isInteger(hours) && hours >= 1 && hours <= 87600)
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (lock.current || !target || !action || !allowed || !confirmed || reason.trim().length < 3 || !validDuration) return
    lock.current = true; setPending(true); setError(null)
    try {
      let updated = target
      let message = `${actionText[action].title.replace(' user', '')} completed for ${target.displayName}.`
      if (action === 'sessions') { const result = await usersApi.revokeSessions(target.id, reason.trim()); message = `${result.revoked} session${result.revoked === 1 ? '' : 's'} revoked for ${target.displayName}.` }
      else if (action === 'delete') { const result = await usersApi.delete(target.id, reason.trim()); updated = result.sanction.user }
      else { const result = await usersApi.moderate(target.id, action, { reason: reason.trim(), ...(action === 'suspend' ? { permanent, ...(permanent ? {} : { durationHours: hours }) } : {}) }); updated = result.user ?? result.sanction?.user ?? target }
      onDone(updated, message); onClose()
    } catch (failure) { setError(failure) }
    finally { lock.current = false; setPending(false) }
  }
  const text = action ? actionText[action] : actionText.warn
  return <AdminDialog open={Boolean(action && target) && allowed} title={text.title} description={text.description} onClose={onClose} pending={pending}>
    <form className="admin-stack" onSubmit={submit}>
      <FormError error={error} />
      {target && <p>Account: <strong>{target.displayName}</strong> · {target.email}</p>}
      <label className="admin-field">Reason<textarea autoFocus required minLength={3} maxLength={action === 'sessions' ? 200 : 1000} rows={4} value={reason} onChange={event => setReason(event.target.value)} disabled={pending} /></label>
      {action === 'suspend' && <><label className="admin-user-check"><input type="checkbox" checked={permanent} onChange={event => setPermanent(event.target.checked)} disabled={pending} />Suspend until manually reactivated</label><label className="admin-field">Duration (hours)<input type="number" min={1} max={87600} step={1} required={!permanent} value={duration} onChange={event => setDuration(event.target.value)} disabled={pending || permanent} /></label>{!validDuration && <p className="admin-help">Enter a whole number of hours from 1 to 87,600.</p>}</>}
      <label className="admin-user-check"><input type="checkbox" checked={confirmed} onChange={event => setConfirmed(event.target.checked)} disabled={pending} />I confirm this action for {target?.displayName}</label>
      <div className="admin-actions"><button type="button" className="admin-button" onClick={onClose} disabled={pending}>Cancel</button><button className={`admin-button ${action === 'reactivate' ? 'admin-button-primary' : 'admin-button-danger'}`} disabled={pending || !confirmed || reason.trim().length < 3 || !validDuration || !allowed}>{pending ? 'Applying…' : text.submit}</button></div>
    </form>
  </AdminDialog>
}
