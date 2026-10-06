import { Link, useParams } from 'react-router-dom'
import { stagger } from '../../lib/css'

// ============================================================================
// The slug screen (`/:slug`, and `/p/:slug` for a slug that collides with a fixed
// root route).
//
// U0 introduces the route and the layout, NOT the renderer: drawing a page means
// the public projection, theming, link scheduling, the owner's identity and the
// unavailable states, which is U4 and depends on R1.7. Until that lands this
// screen says exactly that and shows nothing it cannot verify — it does not call
// a protected endpoint, does not fabricate a title from the address, and does not
// guess whether a page exists. Ground rule 3 is what keeps it this short.
// ============================================================================

export function PublicPageRoute() {
  const { slug } = useParams<{ slug: string }>()

  return (
    <article className="mx-auto max-w-xl">
      <p className="eyebrow reveal" style={stagger(0)}>
        /{slug}
      </p>
      <h1
        className="reveal mt-3 font-display text-4xl font-medium leading-tight tracking-[-0.02em] sm:text-5xl"
        style={stagger(1)}
      >
        Not rendered yet
      </h1>
      <p className="reveal mt-6 leading-relaxed text-ink-soft" style={stagger(2)}>
        This is the public side of OneLink: no session, no console. The renderer that draws a
        published page from the public projection is not switched on yet, so there is nothing to
        show — and rather than invent a title from the address, this page says so.
      </p>
      <p className="reveal mt-6" style={stagger(3)}>
        <Link
          to="/login"
          className="border-b border-transparent font-mono text-[0.6875rem] uppercase tracking-[0.16em] text-ink-soft transition-colors hover:border-ink hover:text-ink"
        >
          Go to the console
        </Link>
      </p>
    </article>
  )
}