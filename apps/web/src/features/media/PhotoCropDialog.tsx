import { useEffect, useId, useRef, useState } from 'react'
import { Button } from '../../components/Button'
import { clampCrop, initialCrop, zoomCrop } from './crop'
import type { Crop, DecodedPhoto } from './types'

export interface PhotoCropDialogProps {
  photo: DecodedPhoto
  open: boolean
  pending: boolean
  phase: 'idle' | 'encoding' | 'uploading' | 'saving'
  progress: number | null
  error: string | null
  onSave: (crop: Crop) => void
  onCancel: () => void
  onCropChange?: (crop: Crop) => void
}

export function PhotoCropDialog({ photo, open, pending, phase, progress, error, onSave, onCancel, onCropChange }: PhotoCropDialogProps) {
  const id = useId()
  const dialogRef = useRef<HTMLDialogElement>(null)
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const opener = useRef<HTMLElement | null>(null)
  const drag = useRef<{ id: number; x: number; y: number } | null>(null)
  const saveStarted = useRef(false)
  const [crop, setCrop] = useState(() => initialCrop(photo.width, photo.height))
  const [zoom, setZoom] = useState(1)
  useEffect(() => { onCropChange?.(crop) }, [crop, onCropChange])
  useEffect(() => {
    setCrop(initialCrop(photo.width, photo.height)); setZoom(1); saveStarted.current = false
  }, [photo])
  useEffect(() => { if (!pending) saveStarted.current = false }, [pending])
  useEffect(() => {
    const dialog = dialogRef.current
    if (!dialog) return
    if (open && !dialog.open) {
      opener.current = document.activeElement instanceof HTMLElement ? document.activeElement : null
      dialog.showModal(); canvasRef.current?.focus()
    } else if (!open && dialog.open) {
      dialog.close(); opener.current?.focus()
    }
    return () => { if (dialog.open) { dialog.close(); opener.current?.focus() } }
  }, [open])
  useEffect(() => {
    const canvas = canvasRef.current
    const context = canvas?.getContext('2d')
    if (canvas && context) {
      context.clearRect(0, 0, 512, 512)
      context.drawImage(photo.source, crop.x, crop.y, crop.size, crop.size, 0, 0, 512, 512)
    }
  }, [photo, crop])

  return (
    <dialog ref={dialogRef} className="photo-crop-dialog" aria-labelledby={`${id}-title`} aria-describedby={`${id}-help`}
      onCancel={event => { event.preventDefault(); if (!pending) onCancel() }}>
      <div className="photo-crop-content">
        <p className="profile-kicker">Profile photo</p>
        <h2 id={`${id}-title`}>Crop your photo</h2>
        <p id={`${id}-help`}>Drag to position your photo, or use the arrow keys. Zoom in to find your frame.</p>
        <div className="photo-crop-frame">
          <canvas ref={canvasRef} width={512} height={512} tabIndex={pending ? -1 : 0} role="img" aria-label="Photo crop"
            aria-describedby={`${id}-help`} aria-disabled={pending}
            onKeyDown={event => {
              if (pending) return
              const step = crop.size / (event.shiftKey ? 20 : 100)
              const deltas: Record<string, [number, number]> = { ArrowLeft: [-step, 0], ArrowRight: [step, 0], ArrowUp: [0, -step], ArrowDown: [0, step] }
              const delta = deltas[event.key]
              if (delta) { event.preventDefault(); setCrop(value => clampCrop({ ...value, x: value.x + delta[0], y: value.y + delta[1] }, photo.width, photo.height)) }
            }}
            onPointerDown={event => {
              if (pending || (event.pointerType === 'mouse' && event.button !== 0)) return
              event.currentTarget.focus()
              drag.current = { id: event.pointerId, x: event.clientX, y: event.clientY }
              if (event.currentTarget.hasPointerCapture(event.pointerId) || event.nativeEvent.isTrusted) event.currentTarget.setPointerCapture(event.pointerId)
            }}
            onPointerMove={event => {
              const previous = drag.current
              if (pending || !previous || previous.id !== event.pointerId) return
              const width = event.currentTarget.getBoundingClientRect().width
              const dx = (previous.x - event.clientX) * crop.size / width, dy = (previous.y - event.clientY) * crop.size / width
              drag.current = { id: event.pointerId, x: event.clientX, y: event.clientY }
              setCrop(value => clampCrop({ ...value, x: value.x + dx, y: value.y + dy }, photo.width, photo.height))
            }}
            onPointerUp={() => { drag.current = null }} onPointerCancel={() => { drag.current = null }} onLostPointerCapture={() => { drag.current = null }} />
          <span className="photo-crop-grid" aria-hidden="true" />
        </div>
        <div className="photo-crop-zoom">
          <label htmlFor={`${id}-zoom`}>Zoom</label>
          <input id={`${id}-zoom`} type="range" min="1" max="4" step="0.05" value={zoom} disabled={pending}
            onChange={event => { const value = Number(event.target.value); setZoom(value); setCrop(current => zoomCrop(current, value, photo.width, photo.height)) }} />
          <span aria-hidden="true">{zoom.toFixed(1)}×</span>
        </div>
        {error ? <p className="photo-error" role="alert">{error}</p> : null}
        {pending ? <div className="photo-upload-status" role="status">
          <p>{phase === 'encoding' ? 'Preparing your photo…' : phase === 'uploading' ? 'Uploading your photo…' : 'Saving your photo…'}</p>
          {phase === 'uploading' ? <progress aria-label="Photo upload" max={100} value={progress === null ? undefined : Math.round(progress * 100)} /> : null}
        </div> : <p className="photo-crop-note">Saved as a crisp 512 × 512 photo.</p>}
        <div className="photo-crop-actions">
          <button type="button" className="photo-reset" disabled={pending} onClick={() => { setZoom(1); setCrop(initialCrop(photo.width, photo.height)) }}>Reset crop</button>
          <Button variant="outline" type="button" disabled={pending} onClick={onCancel}>Cancel</Button>
          <Button type="button" disabled={pending} aria-busy={pending} onClick={() => {
            if (pending || saveStarted.current) return
            saveStarted.current = true; onSave(crop)
          }}>Save photo</Button>
        </div>
      </div>
    </dialog>
  )
}
