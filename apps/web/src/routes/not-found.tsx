import { Link } from 'react-router-dom'
import { useSession } from '../lib/session'
import { AuthFrame } from '../components/AuthFrame'
import { Notice } from '../components/Notice'

/** Anything that is not a route. Kept in the same frame as the auth screens so
 *  a stale link does not land on a bare page. */
export function NotFoundRoute() {
  const session = useSession()

  return (
    <AuthFrame
      eyebrow={`${session.platformName} · 404`}
      title={
        <>
          Nothing <em className="font-light italic">here</em>
        </>
      }
      lede={<>That address does not match a page in this console.</>}
      folio="—"
      footer={
        <Link
          to="/app#profile-editor"
          className="border-b border-transparent font-mono text-[0.6875rem] uppercase tracking-[0.16em] text-ink-soft transition-colors hover:border-ink hover:text-ink"
        >
          Go to your account
        </Link>
      }
    >
      <Notice tone="info" label="Wrong turn" delay={1}>
        Check the address, or start again from your account page.
      </Notice>
    </AuthFrame>
  )
}
