import { useEffect, useId, useRef } from 'react'
import type { ReactNode } from 'react'
import { Button } from './Button'

// ============================================================================
// The one confirmation dialog.
//
// Built on the native <dialog> with `showModal()`, which is not a shortcut — it
// is the decision. The browser supplies the parts a hand-rolled overlay gets
// wrong: focus is trapped inside the dialog, the rest of the page is inert to
// screen readers, Escape closes it, and focus returns to whatever opened it.
// Rebuilding those by hand is how a confirmation becomes a trap.
//
// What is ours: the copy (which must name the thing and the actual effect), the
// default focus, and refusing to close while a request is in flight.
// ============================================================================

export interface ConfirmDialogProps {
  open: boolean
  title: string
  /** What is about to happen, in the reader's terms. Never "Are you sure?". */
  children: ReactNode
  confirmLabel: string
  cancelLabel?: string
  /** `danger` for anything irreversible. */
  tone?: 'neutral' | 'danger'
  /** A request is in flight: both buttons lock and Escape is ignored. */
  pending?: boolean
  onConfirm: () => void
  onCancel: () => void
}

export function ConfirmDialog({
  open,
  title,
  children,
  confirmLabel,
  cancelLabel = 'Cancel',
  tone = 'neutral',
  pending = false,
  onConfirm,
  onCancel,
}: ConfirmDialogProps) {
  const ref = useRef<HTMLDialogElement>(null)
  const titleId = useId()

  useEffect(() => {
    const dialog = ref.current
    if (!dialog) return
    if (open && !dialog.open) dialog.showModal()
    if (!open && dialog.open) dialog.close()
  }, [open])

  return (
    <dialog
      ref={ref}
      aria-labelledby={titleId}
      // Escape fires `cancel`; preventing the default keeps the dialog up while
      // a write is in flight, so the request cannot be abandoned mid-air.
      onCancel={(event) => {
        event.preventDefault()
        if (!pending) onCancel()
      }}
      className="m-auto w-[min(34rem,calc(100vw-2rem))] bg-transparent p-0"
    >
      <div className="plate p-6">
        <p className={tone === 'danger' ? 'eyebrow text-danger' : 'eyebrow'}>
          {tone === 'danger' ? 'This cannot be undone' : 'Confirm'}
        </p>
        <h2 id={titleId} className="mt-2 font-display text-2xl font-medium leading-snug">
          {title}
        </h2>
        <div className="mt-3 text-sm leading-relaxed text-ink-soft">{children}</div>

        <div className="mt-7 flex flex-wrap items-center justify-end gap-3">
          {/* Focus starts on cancel: the safe answer is the one a hurried Enter
              should land on. */}
          <Button variant="outline" onClick={onCancel} disabled={pending} autoFocus>
            {cancelLabel}
          </Button>
          <Button
            variant={tone === 'danger' ? 'danger' : 'solid'}
            onClick={onConfirm}
            pending={pending}
            pendingLabel="Working"
          >
            {confirmLabel}
          </Button>
        </div>
      </div>
    </dialog>
  )
}
