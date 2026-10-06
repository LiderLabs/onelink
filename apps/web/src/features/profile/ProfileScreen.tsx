import { stagger } from '../../lib/css'
import { useSession } from '../../lib/session'
import { Notice } from '../../components/Notice'
import { Splash } from '../../components/StatusScreens'
import { AccountRecord } from './AccountRecord'
import { ChangePasswordForm } from './ChangePasswordForm'
import { IdentityForm } from './IdentityForm'
import { SocialsEditor } from './SocialsEditor'

// ============================================================================
// `/app/profile` — identity, social links, security and the account record
// (spec §5).
//
// This screen is a composition, and the reason is the three session states that
// are not "normal". They are not edge cases to bolt on later; each one changes
// what may be ASKED FOR, so the decision belongs above the sections rather than
// inside them:
//
//   impersonated      reads identity and socials, writes neither, and says so
//                     prominently — the point of a support session is to see,
//                     not to become
//   forced rotation   the API's interlock closes everything except the password
//                     form, which is exactly why the form stays reachable
//   suspended/banned  `/auth/me` still answers (that is what lets this screen
//                     explain itself), every write and `/profile/socials` are
//                     refused outright, so that request is never made
//
// The capability list decides none of this: it describes staff permissions, and
// the server is the authority on what this session may do (ground rule 4).
// ============================================================================

export function ProfileScreen() {
  const session = useSession()
  const user = session.user

  // `RequireAuth` has already established that there is a user; this covers the
  // single render between a session ending and the redirect taking over.
  if (!user) return <Splash label="Loading your account" />

  const forced = session.mustChangePassword
  const impersonated = user.impersonatedBy !== null
  const usable = user.status === 'active'

  // The exact preconditions `GET /profile/socials` enforces on the server.
  const readable = usable && !forced

  const blockedReason = !usable ? (
    <>
      Nothing is loaded here because the API refuses this endpoint for a{' '}
      <span className="font-mono text-xs">{user.status}</span> account rather than answering it.
      That is a policy, not a fault — the notice above says what happened to the account.
    </>
  ) : (
    <>
      A password change is outstanding, and the API closes every endpoint except this screen's
      security form until it is done. Set a new password below and the links appear.
    </>
  )

  return (
    <div className="space-y-12">
      <header>
        <p className="eyebrow reveal" style={stagger(0)}>
          Profile
        </p>
        <h1
          className="reveal mt-3 font-display text-4xl font-medium leading-tight tracking-[-0.02em] sm:text-5xl"
          style={stagger(1)}
        >
          {user.displayName}
        </h1>
        <p className="reveal mt-4 max-w-xl leading-relaxed text-ink-soft" style={stagger(2)}>
          Your identity, your links, and the record behind them. There is no background refresh to
          wait for: a save is sent and confirmed while you watch.
        </p>
      </header>

      {impersonated ? (
        <Notice tone="warning" label="Read-only · impersonated session" delay={2}>
          An administrator is acting as this account. Identity and links are readable here so
          support can see what you see, and every write on this screen is refused by the API — so
          the forms below are read-only on purpose.
        </Notice>
      ) : null}

      {forced ? (
        <Notice tone="warning" label="Password change required" delay={2}>
          An owner (or a password reset) marked this password as temporary. Every other endpoint
          answers <span className="font-mono text-xs">403 MUST_CHANGE_PASSWORD</span> until it is
          replaced — including the links below. Setting a new one unblocks the account without
          signing you out of this browser.
        </Notice>
      ) : null}

      {!usable ? (
        <Notice tone="error" label={`Account ${user.status}`} delay={2}>
          The API still answers <span className="font-mono text-xs">GET /auth/me</span> for this
          account, which is what lets this screen explain itself — and refuses everything else. The
          forms below are closed, not broken.
        </Notice>
      ) : null}

      <IdentityForm user={user} disabled={!usable || forced || impersonated} />

      <SocialsEditor
        readable={readable}
        writable={readable && !impersonated}
        blockedReason={blockedReason}
      />

      <div className="grid gap-12 lg:grid-cols-[minmax(0,1fr)_minmax(0,22rem)] lg:gap-14">
        <AccountRecord user={user} capabilities={session.capabilities} />

        <section className="plate h-fit p-6" aria-labelledby="security">
          <h2 id="security" className="eyebrow">
            Security
          </h2>
          <p className="mb-6 mt-3 text-sm leading-relaxed text-ink-soft">
            Changing this signs your other sessions out. This browser stays signed in, so nobody is
            thrown out mid-task.
          </p>
          <ChangePasswordForm forced={forced} />
        </section>
      </div>

      <footer className="flex flex-wrap items-center justify-between gap-4 border-t border-rule pt-6">
        <p className="eyebrow">Signed in as {user.username}</p>
        <button
          type="button"
          onClick={() => void session.logout()}
          className="border-b border-transparent font-mono text-[0.6875rem] uppercase tracking-[0.16em] text-ink-soft transition-colors hover:border-ink hover:text-ink"
        >
          Sign out
        </button>
      </footer>
    </div>
  )
}