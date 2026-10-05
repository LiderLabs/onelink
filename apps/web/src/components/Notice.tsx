import type { ReactNode } from 'react'
import { cx, stagger } from '../lib/css'

// ============================================================================
// Inline notices.
//
// `error` and `warning` are assertive (`role="alert"`), `success` and `info` are
// polite (`role="status"`). That distinction is deliberate: a rejected form must
// interrupt a screen reader, while "your password was changed" should not.
// ============================================================================

export type NoticeTone = 'error' | 'warning' | 'success' | 'info'

const TONES: Record<NoticeTone, { border: string; label: string; text: string }> = {
  error: { border: 'border-l-vermilion', label: 'text-vermilion', text: 'Check this' },
  warning: { border: 'border-l-amber', label: 'text-amber', text: 'Heads up' },
  success: { border: 'border-l-sage', label: 'text-sage', text: 'Done' },
  info: { border: 'border-l-ink-faint', label: 'text-ink-soft', text: 'Note' },
}

export interface NoticeProps {
  tone: NoticeTone
  /** Overrides the default eyebrow label for the tone. */
  label?: string
  children: ReactNode
  delay?: number
  className?: string
}

export function Notice({ tone, label, children, delay = 0, className }: NoticeProps) {
  const styles = TONES[tone]

  return (
    <div
      role={tone === 'error' || tone === 'warning' ? 'alert' : 'status'}
      style={stagger(delay)}
      className={cx(
        'reveal border-l-2 bg-paper-deep/60 py-3 pl-4 pr-3 text-sm leading-relaxed',
        styles.border,
        className,
      )}
    >
      <p className={cx('eyebrow mb-1', styles.label)}>{label ?? styles.text}</p>
      <div className="text-ink-soft">{children}</div>
    </div>
  )
}
