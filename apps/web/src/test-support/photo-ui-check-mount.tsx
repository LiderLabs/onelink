// Test-only mount for `scripts/browser/profile-photo-ui-check.mjs`.
//
// Browser `page.evaluate` cannot `import('react')`: Vite resolves bare
// specifiers only inside files it transforms, not from an evaluated string. So
// the check's "disposable runtime React mount" lives here, where `react`,
// `react-dom/client`, and the dialog resolve normally through the dev server.
//
// Nothing in production imports this file — `vite build` bundles from the
// entry, so it ships zero bytes — and it mounts nothing on import: the check
// calls `mountPhotoCheckDialog` explicitly, drives it through the returned
// handles, and unmounts when done.
import { useState } from 'react'
import type { ComponentProps } from 'react'
import { createRoot } from 'react-dom/client'
import type { Root } from 'react-dom/client'
import { PhotoCropDialog } from '../features/media/PhotoCropDialog'
import type { DecodedPhoto } from '../features/media/types'

/** The dialog's own phase union, read off its props so the two cannot drift. */
type PhotoSavePhase = ComponentProps<typeof PhotoCropDialog>['phase']

export interface PhotoCheckEvents {
  saves: number
  cancels: number
}

export interface PhotoCheckMount {
  events: PhotoCheckEvents
  setPending: (pending: boolean) => void
  setPhase: (phase: PhotoSavePhase) => void
  setProgress: (progress: number | null) => void
  setError: (error: string | null) => void
  unmount: () => void
}

export function mountPhotoCheckDialog(photo: DecodedPhoto): PhotoCheckMount {
  const events: PhotoCheckEvents = { saves: 0, cancels: 0 }

  let setPending: (pending: boolean) => void = () => undefined
  let setPhase: (phase: PhotoSavePhase) => void = () => undefined
  let setProgress: (progress: number | null) => void = () => undefined
  let setError: (error: string | null) => void = () => undefined

  function Mount() {
    const [open, setOpenState] = useState(false)
    const [pending, setPendingState] = useState(false)
    const [phase, setPhaseState] = useState<PhotoSavePhase>('idle')
    const [progress, setProgressState] = useState<number | null>(null)
    const [error, setErrorState] = useState<string | null>(null)

    setPending = setPendingState
    setPhase = setPhaseState
    setProgress = setProgressState
    setError = setErrorState

    return (
      <>
        <button type="button" onClick={() => setOpenState(true)}>
          Open crop
        </button>
        <PhotoCropDialog
          photo={photo}
          open={open}
          pending={pending}
          phase={phase}
          progress={progress}
          error={error}
          onSave={() => {
            events.saves += 1
          }}
          onCancel={() => {
            events.cancels += 1
            setOpenState(false)
          }}
        />
      </>
    )
  }

  const host = document.createElement('div')
  host.id = 'photo-ui-check-mount'
  document.body.appendChild(host)
  const root: Root = createRoot(host)
  root.render(<Mount />)

  return {
    events,
    setPending: (pending) => setPending(pending),
    setPhase: (phase) => setPhase(phase),
    setProgress: (progress) => setProgress(progress),
    setError: (error) => setError(error),
    unmount: () => {
      root.unmount()
      host.remove()
    },
  }
}
