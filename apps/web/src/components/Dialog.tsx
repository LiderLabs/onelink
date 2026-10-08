import { useEffect, useId, useRef } from 'react'
import type { ReactNode } from 'react'
import { cx } from '../lib/css'
import { Icon } from './Icon'
import type { IconName } from './Icon'

// ============================================================================
// The general modal.
//
// Built on the native <dialog> + showModal(), exactly like ConfirmDialog and for
// the same reason: the browser supplies focus trapping, background inertness,
// Escape-to-close and focus restoration, which a hand-rolled overlay gets wrong.
//
// What this adds over ConfirmDialog is a *form body*: the Add Link and Share
// modals own their own fields, actions and pending state, so this is the shell
// (title, subtitle, icon, scroll area, footer slot) and nothing else. The dialog
// refuses to close while a request is in flight, so a slow save cannot be
// abandoned by an impatient Escape.
// ============================================================================

export interface DialogProps {
  open: boolean
  onClose: () => void
  title: string
  /** One line under the title describing what the modal is for. */
  description?: ReactNode
  icon?: IconName
  /** The modal body. */
  children: ReactNode
  /** Pinned to the bottom, outside the scroll area. */
  footer?: ReactNode
  /** A request is in flight: Escape is ignored and the close button locks. */
  pending?: boolean
  className?: string
}

export function Dialog({
  open,
  onClose,
  title,
  description,
  icon,
  children,
  footer,
  pending = false,
  className,
}: DialogProps) {
  const ref = useRef<HTMLDialogElement>(null)
  const closeHandled = useRef(false)
  const titleId = useId()

  useEffect(() => {
    const dialog = ref.current
    if (!dialog) return
    if (open && !dialog.open) dialog.showModal()
    if (!open && dialog.open) dialog.close()
  }, [open])

  const requestClose = () => {
    if (pending || closeHandled.current) return
    closeHandled.current = true
    onClose()
    window.setTimeout(() => { closeHandled.current = false }, 0)
  }

  return (
    <dialog
      ref={ref}
      aria-labelledby={titleId}
      onCancel={(event) => {
        if (pending) event.preventDefault()
        else requestClose()
      }}
      onKeyDown={(event) => {
        if (event.key !== 'Escape') return
        event.preventDefault()
        requestClose()
      }}
      className={cx('m-auto w-[min(34rem,calc(100vw-2rem))] bg-transparent p-0', className)}
    >
      <div className="max-h-[calc(100dvh-2rem)] overflow-y-auto border border-rule bg-paper">
        <div className="flex items-start gap-4 border-b border-rule px-5 py-5 sm:px-6">
          {icon ? (
            <span className="mt-0.5 grid h-10 w-10 shrink-0 place-items-center rounded-md border border-rule text-ink">
              <Icon name={icon} size={20} />
            </span>
          ) : null}
          <div className="min-w-0 flex-1">
            <h2 id={titleId} className="font-display text-2xl font-medium leading-tight">
              {title}
            </h2>
            {description ? (
              <p className="mt-1.5 text-sm leading-relaxed text-ink-soft">{description}</p>
            ) : null}
          </div>
          <button
            type="button"
            onClick={requestClose}
            disabled={pending}
            aria-label="Close"
            className="grid h-9 w-9 shrink-0 place-items-center rounded-md text-ink-soft transition-colors hover:bg-paper-deep hover:text-ink disabled:cursor-not-allowed disabled:opacity-45"
          >
            <Icon name="close" size={18} />
          </button>
        </div>

        <div className="px-5 py-5 sm:px-6">{children}</div>

        {footer ? (
          <div className="flex flex-wrap items-center justify-end gap-3 border-t border-rule px-5 py-4 sm:px-6">
            {footer}
          </div>
        ) : null}
      </div>
    </dialog>
  )
}
