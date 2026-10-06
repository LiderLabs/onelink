import { useEffect, useRef } from 'react'
import type { SessionUser, SocialLink } from '../../lib/types'
import type { Crop, DecodedPhoto } from '../media/types'
import { ProfileAvatar } from './ProfileAvatar'
import { platformLabel } from './social-platforms'

export type PreviewIdentity = Pick<SessionUser, 'displayName' | 'username' | 'bio' | 'location' | 'pronouns'>
export type PreviewSocial = Pick<SocialLink, 'id' | 'platform' | 'url' | 'position' | 'isVisible'>
export type PreviewPhoto = { photo: DecodedPhoto; crop: Crop }
export type PreviewSocials = { links: PreviewSocial[]; loading: boolean; unavailable: boolean }

function safeAddress(value: string): string | undefined {
  try {
    const url = new URL(value.trim())
    if ((url.protocol === 'https:' || url.protocol === 'http:') && !url.username && !url.password) return url.href
  } catch { /* An incomplete draft still displays its platform without a link. */ }
}

export function ProfilePreview({ identity, avatarKey, photo, socials }: {
  identity: PreviewIdentity; avatarKey: string | null; photo: PreviewPhoto | null; socials: PreviewSocials
}) {
  const canvas = useRef<HTMLCanvasElement>(null)
  useEffect(() => {
    const context = canvas.current?.getContext('2d')
    if (photo && context) {
      const { crop } = photo
      context.clearRect(0, 0, 512, 512)
      context.drawImage(photo.photo.source, crop.x, crop.y, crop.size, crop.size, 0, 0, 512, 512)
    }
  }, [photo])
  const visible = socials.links.filter(link => link.isVisible)
  return <section className="profile-preview" aria-label="Live profile preview">
    <div className="profile-preview-heading"><h2>Live preview</h2><span><i aria-hidden="true" /> As you edit</span></div>
    <div className="profile-preview-page">
      {photo ? <canvas ref={canvas} width={512} height={512} className="profile-preview-photo" role="img" aria-label="Profile photo preview" />
        : <ProfileAvatar avatarKey={avatarKey} displayName={identity.displayName} className="profile-preview-photo" />}
      <h3>{identity.displayName.trim() || 'Your name'}</h3>
      {identity.username.trim() ? <p className="profile-preview-handle">@{identity.username.trim()}</p> : null}
      {identity.bio?.trim() ? <p className="profile-preview-bio">{identity.bio}</p> : null}
      {identity.location?.trim() || identity.pronouns?.trim() ? <div className="profile-preview-details">
        {identity.location?.trim() ? <span>{identity.location}</span> : null}
        {identity.pronouns?.trim() ? <span>{identity.pronouns}</span> : null}
      </div> : null}
      {socials.loading ? <p className="profile-preview-empty">Loading social links…</p>
        : socials.unavailable ? <p className="profile-preview-empty">Social links are unavailable.</p>
        : visible.length ? <ul className="profile-preview-links">{visible.map(link => {
          const href = safeAddress(link.url)
          const content = <>{platformLabel(link.platform)}<span aria-hidden="true">↗</span></>
          return <li key={link.id}>{href
            ? <a href={href} target="_blank" rel="noopener noreferrer">{content}</a>
            : <span className="profile-preview-incomplete">{content}</span>}</li>
        })}</ul> : <p className="profile-preview-empty">Your visible social links will appear here.</p>}
    </div>
    <p className="profile-preview-note">Changes appear here before you save.</p>
  </section>
}
