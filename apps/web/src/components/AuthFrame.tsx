import type { ReactNode } from 'react'
import { stagger } from '../lib/css'

// ============================================================================
// The frame every pre-auth screen sits in.
//
// Two columns: a broadsheet left side that states what the screen is for, and a
// single "plate" on the right holding the actual form. The heading is display
// type at a size that is only comfortable because there is nothing else on that
// side — the asymmetry is the layout, not a decoration bolted onto a centred
// card.
// ============================================================================

export interface AuthFrameProps {
  eyebrow: string
  title: ReactNode
  lede: ReactNode
  /** Folio-style marker, e.g. "01 — Sign in". */
  folio: string
  /** Optional facts rendered as a small ruled list under the lede. */
  facts?: Array<{ label: string; value: string }>
  children: ReactNode
  footer?: ReactNode
}

export function AuthFrame({
  eyebrow,
  title,
  lede,
  folio,
  facts,
  children,
  footer,
}: AuthFrameProps) {
  return (
    <div className="grid gap-12 lg:grid-cols-[1.05fr_minmax(0,26rem)] lg:items-start lg:gap-16">
      <header className="lg:sticky lg:top-12">
        <p className="eyebrow reveal" style={stagger(0)}>
          {eyebrow}
        </p>

        <h1
          className="reveal mt-4 font-display text-[2.75rem] font-medium leading-[0.95] tracking-[-0.02em] sm:text-6xl"
          style={stagger(1)}
        >
          {title}
        </h1>

        <div
          className="sweep mt-7 h-[3px] w-24 origin-left bg-vermilion"
          style={stagger(2)}
          aria-hidden="true"
        />

        <p className="reveal mt-7 max-w-md text-[1.0625rem] leading-relaxed text-ink-soft" style={stagger(3)}>
          {lede}
        </p>

        <p className="reveal mt-9" style={stagger(4)}>
          <span className="stamp text-ink-faint">{folio}</span>
        </p>

        {facts && facts.length > 0 ? (
          <dl className="reveal mt-10 max-w-md border-t border-rule" style={stagger(5)}>
            {facts.map((fact) => (
              <div
                key={fact.label}
                className="flex items-baseline justify-between gap-6 border-b border-rule py-2.5"
              >
                <dt className="eyebrow">{fact.label}</dt>
                <dd className="font-mono text-sm text-ink">{fact.value}</dd>
              </div>
            ))}
          </dl>
        ) : null}
      </header>

      <section className="plate reveal p-6 sm:p-8" style={stagger(2)}>
        {children}
        {footer ? <footer className="mt-8 border-t border-rule pt-5 text-sm">{footer}</footer> : null}
      </section>
    </div>
  )
}
