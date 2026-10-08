import { useCallback, useEffect, useRef, useState } from 'react'
import type { ChangeEvent } from 'react'
import { Trash, UploadSimple } from '@phosphor-icons/react'
import { Button } from '../../components/Button'
import { ConfirmDialog } from '../../components/ConfirmDialog'
import { ApiError, errorMessageFor } from '../../lib/api'
import { useSession } from '../../lib/session'
import type { SessionUser } from '../../lib/types'
import { deleteAvatar, getCurrentAvatar, uploadAvatar } from '../media/api'
import { decodePhoto, encodeAvatar } from '../media/image'
import { PhotoCropDialog } from '../media/PhotoCropDialog'
import type { Crop, DecodedPhoto, MediaAsset } from '../media/types'
import { ProfileAvatar } from './ProfileAvatar'
import { initialCrop } from '../media/crop'
import type { PreviewPhoto } from './ProfilePreview'

export function ProfilePhotoEditor({ user, readable, writable, onBusyChange, onPreviewChange, compact = false }: {
  user: SessionUser; readable: boolean; writable: boolean; onBusyChange: (busy: boolean) => void; onPreviewChange?: (photo: PreviewPhoto | null) => void; compact?: boolean
}) {
  const session = useSession()
  const input = useRef<HTMLInputElement>(null)
  const mounted = useRef(true)
  const generation = useRef(0)
  const image = useRef<DecodedPhoto | null>(null)
  const busy = useRef(false)
  const uploadController = useRef<AbortController | null>(null)
  const [media, setMedia] = useState<MediaAsset | null>(null)
  const [loaded, setLoaded] = useState(false)
  const [metadataError, setMetadataError] = useState<string | null>(null)
  const [photo, setPhoto] = useState<DecodedPhoto | null>(null)
  const [decoding, setDecoding] = useState(false)
  const [phase, setPhase] = useState<'idle' | 'encoding' | 'uploading' | 'saving'>('idle')
  const [progress, setProgress] = useState<number | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const [cleanup, setCleanup] = useState<MediaAsset[]>([])
  const [removeOpen, setRemoveOpen] = useState(false)

  useEffect(() => {
    onBusyChange(decoding || phase !== 'idle')
  }, [decoding, phase, onBusyChange])

  useEffect(() => {
    mounted.current = true
    return () => {
      mounted.current = false; generation.current++; uploadController.current?.abort()
      onPreviewChange?.(null)
      image.current?.release(); image.current = null; onBusyChange(false)
    }
  }, [onBusyChange, onPreviewChange])

  useEffect(() => {
    let current = true
    setLoaded(false); setMetadataError(null)
    if (!readable) { setMedia(null); return }
    void getCurrentAvatar().then(value => { if (current) { setMedia(value); setLoaded(true) } })
      .catch(failure => { if (current) setMetadataError(errorMessageFor(failure)) })
    return () => { current = false }
  }, [user.id, user.avatarKey, readable])

  const changePhase = (value: typeof phase) => {
    busy.current = value !== 'idle'; setPhase(value)
  }
  const discard = () => {
    onPreviewChange?.(null)
    generation.current++; image.current?.release(); image.current = null
    setPhoto(null); setError(null)
  }
  const queueCleanup = (asset: MediaAsset) => {
    if (mounted.current) setCleanup(values => values.some(value => value.id === asset.id) ? values : [...values, asset])
  }
  const clean = async (asset: MediaAsset | null) => {
    if (!asset) return
    try { await deleteAvatar(asset.id) }
    catch { queueCleanup(asset) }
  }
  const retryMetadata = async () => {
    setMetadataError(null)
    try { await session.refreshProfile(); setMedia(await getCurrentAvatar()); setLoaded(true) }
    catch (failure) { if (mounted.current) setMetadataError(errorMessageFor(failure)) }
  }
  const select = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0]
    event.target.value = ''
    if (!file || !writable || !loaded || busy.current) return
    discard(); setNotice(null); setDecoding(true)
    const token = generation.current
    try {
      const decoded = await decodePhoto(file)
      if (!mounted.current || token !== generation.current) { decoded.release(); return }
      image.current = decoded; setPhoto(decoded)
      onPreviewChange?.({ photo: decoded, crop: initialCrop(decoded.width, decoded.height) })
    } catch (failure) {
      if (mounted.current && token === generation.current) setError(failure instanceof Error ? failure.message : 'Could not open that photo.')
    } finally { if (mounted.current && token === generation.current) setDecoding(false) }
  }

  const previewCrop = useCallback((crop: Crop) => {
    // A crop effect can arrive after Cancel released its bitmap.
    if (photo && image.current === photo) onPreviewChange?.({ photo, crop })
  }, [photo, onPreviewChange])

  const save = async (crop: Crop) => {
    if (!photo || !writable || busy.current || !loaded) return
    const token = generation.current, previous = media, expectedKey = user.avatarKey
    const active = () => mounted.current && token === generation.current
    let uploaded: MediaAsset | null = null
    changePhase('encoding'); setError(null); setNotice(null); setProgress(null)
    try {
      const blob = await encodeAvatar(photo, crop)
      if (!active()) return
      changePhase('uploading')
      const controller = new AbortController(); uploadController.current = controller
      uploaded = await uploadAvatar(blob, { signal: controller.signal, onProgress: value => { if (active()) setProgress(value) } })
      if (!active()) { await clean(uploaded); return }
      changePhase('saving')
      await session.updateProfile({ avatarKey: uploaded.key, expectedAvatarKey: expectedKey })
      if (!active()) return
      setMedia(uploaded); setNotice('Photo saved.'); discard()
      await clean(previous)
    } catch (failure) {
      if (!active()) return
      const ambiguous = failure instanceof ApiError && (failure.code === 'NETWORK' || failure.code === 'UNKNOWN' || failure.status >= 500 || failure.code === 'CONFLICT')
      if (uploaded && ambiguous) {
        try {
          const actual = await session.refreshProfile()
          if (!active()) return
          const current = await getCurrentAvatar()
          if (!active()) return
          setMedia(current); setLoaded(true)
          if (actual.avatarKey === uploaded.key) {
            setNotice('Photo saved.'); discard(); await clean(previous); return
          }
          await clean(uploaded)
        } catch {
          if (active()) setError('We could not confirm whether your photo was saved. Check your connection, then cancel and reload before trying again.')
          return
        }
      } else if (uploaded) await clean(uploaded)
      if (active()) setError(errorMessageFor(failure))
    } finally {
      uploadController.current = null
      if (mounted.current) changePhase('idle')
    }
  }

  const remove = async () => {
    if (!writable || busy.current) return
    changePhase('saving'); setError(null); setNotice(null)
    try {
      if (media) await deleteAvatar(media.id)
      else await session.updateProfile({ avatarKey: null, expectedAvatarKey: user.avatarKey })
      await session.refreshProfile()
      if (mounted.current) { setMedia(await getCurrentAvatar()); setRemoveOpen(false); setNotice('Photo removed.') }
    } catch (failure) {
      try {
        const actual = await session.refreshProfile()
        if (mounted.current && actual.avatarKey !== user.avatarKey) {
          setMedia(await getCurrentAvatar()); setRemoveOpen(false)
          if (media) queueCleanup(media)
          setNotice(actual.avatarKey === null ? 'Photo removed. File cleanup needs a retry.' : 'Your profile photo changed. The current photo has been reloaded.')
        } else if (mounted.current) setError(errorMessageFor(failure))
      } catch { if (mounted.current) setError(errorMessageFor(failure)) }
    } finally { if (mounted.current) changePhase('idle') }
  }

  const retryCleanup = async () => {
    if (!writable || busy.current) return
    changePhase('saving')
    try {
      for (const asset of cleanup) {
        try { await deleteAvatar(asset.id); if (mounted.current) setCleanup(values => values.filter(value => value.id !== asset.id)) }
        catch { if (mounted.current) setNotice('Photo file cleanup is still unavailable. Please try again later.') }
      }
    } finally { if (mounted.current) changePhase('idle') }
  }

  return <section className={`profile-section profile-photo${compact ? ' is-compact' : ''}`} aria-labelledby="photo">
    <div className="profile-section-heading"><div><p className="profile-section-number" aria-hidden="true">01</p><h2 id="photo">Profile photo</h2></div><span className="profile-section-note">A familiar face</span></div>
    <div className="profile-photo-controls">
      <ProfileAvatar avatarKey={user.avatarKey} displayName={user.displayName} className="profile-photo-avatar" />
      <div><p className="profile-section-description">{compact ? 'Profile picture' : 'Make it yours. Choose a photo and find your frame.'}</p>
        <div className="profile-photo-buttons">
          <Button type="button" variant="outline" disabled={!writable || !loaded || phase !== 'idle'} onClick={() => input.current?.click()}>{compact ? <UploadSimple size={16} /> : null}{user.avatarKey ? 'Change photo' : 'Upload photo'}</Button>
          {user.avatarKey ? <button type="button" className={compact ? 'creator-icon-button' : undefined} aria-label="Remove photo" title="Remove photo" disabled={!writable || !loaded || phase !== 'idle'} onClick={() => setRemoveOpen(true)}>{compact ? <Trash size={17} /> : 'Remove photo'}</button> : null}
        </div>
        <p className="profile-photo-help">JPEG, PNG or WebP. Up to 10 MB.</p>
      </div>
    </div>
    <input ref={input} className="sr-only" tabIndex={-1} type="file" accept="image/jpeg,image/png,image/webp" aria-label="Choose profile photo" disabled={!writable || !loaded || phase !== 'idle'} onChange={event => { void select(event) }} />
    {decoding ? <p className="profile-photo-message" role="status">Opening your photo…</p> : null}
    {metadataError ? <div className="profile-photo-message"><p className="photo-error" role="alert">{metadataError}</p><button type="button" onClick={() => { void retryMetadata() }}>Retry photo controls</button></div> : null}
    {error && !photo ? <p className="photo-error" role="alert">{error}</p> : null}
    {notice ? <p className="profile-photo-message" role="status">{notice}</p> : null}
    {cleanup.length ? <div className="profile-photo-cleanup"><p>Your photo is up to date. An unused file still needs cleanup.</p><button type="button" disabled={!writable || phase !== 'idle'} onClick={() => { void retryCleanup() }}>Retry cleanup</button></div> : null}
    {photo ? <PhotoCropDialog photo={photo} open pending={phase !== 'idle'} phase={phase} progress={progress} error={error} onCropChange={previewCrop} onSave={crop => { void save(crop) }} onCancel={() => { if (!busy.current) discard() }} /> : null}
    <ConfirmDialog open={removeOpen} title="Remove your profile photo?" confirmLabel="Remove photo" pending={phase !== 'idle'} onConfirm={() => { void remove() }} onCancel={() => setRemoveOpen(false)}>
      Your photo will be removed and your initials will appear in its place.
      {error && removeOpen ? <span className="photo-error" role="alert">{error}</span> : null}
    </ConfirmDialog>
  </section>
}
