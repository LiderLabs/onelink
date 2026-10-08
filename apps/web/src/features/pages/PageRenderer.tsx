import type { CSSProperties, ReactNode } from 'react'
import { ArrowUpRight, MapPin } from '@phosphor-icons/react'
import { OneLinkBrand } from '../../components/OneLinkBrand'
import { SocialIcon } from '../../components/SocialIcon'
import { platformLabel } from '../profile/social-platforms'
import type { PageLink, PageLayout, PageTheme, PublicPageOwner } from '../../lib/types'
import './page-renderer.css'

export interface PageRenderModel {
  slug: string
  title: string | null
  bio: string | null
  theme: PageTheme
  layout: PageLayout
  accentColor: string | null
  showBranding: boolean
  owner?: PublicPageOwner
  links: PageLink[]
  groups?: Array<{ id: string; name: string; position: number }>
}

function safeHttpUrl(value: string): string | null {
  try {
    const url = new URL(value)
    return (url.protocol === 'http:' || url.protocol === 'https:') && !url.username && !url.password ? url.href : null
  } catch {
    return null
  }
}

export function PageRenderer({ page, avatarOverride, emptyState }: { page: PageRenderModel; avatarOverride?: ReactNode; emptyState?: ReactNode }) {
  const groupById = new Map((page.groups ?? []).map((group) => [group.id, group]))
  const links = [...page.links].sort((left, right) => left.position - right.position)
  const accent = page.accentColor ?? '#00d8ef'
  const channels = /^#[\da-f]{6}$/i.test(accent)
    ? [1, 3, 5].map(offset => {
      const channel = parseInt(accent.slice(offset, offset + 2), 16) / 255
      return channel <= .04045 ? channel / 12.92 : ((channel + .055) / 1.055) ** 2.4
    }) : null
  const luminance = channels?.reduce((total, channel, index) => total + channel * ([.2126, .7152, .0722][index] ?? 0), 0) ?? 1
  const style = {
    '--page-accent': accent,
    '--page-button-text': luminance > .179 ? '#000000' : '#ffffff',
  } as CSSProperties

  return (
    <article
      className="page-renderer"
      style={style}
      data-theme={page.theme}
      data-layout={page.layout}
    >
      {page.owner ? (
        <header className="page-profile">
          <div className="page-avatar">
            {avatarOverride ?? (page.owner.avatarUrl ? (
              <img src={page.owner.avatarUrl} alt="" />
            ) : (
              <span aria-hidden="true">{Array.from(page.owner.displayName)[0]?.toUpperCase() ?? '?'}</span>
            ))}
          </div>
          <h1>
            {page.title?.trim() || page.owner.displayName}
          </h1>
          <p className="page-handle">@{page.owner.username}</p>
          {page.owner.pronouns ? <p className="page-pronouns">{page.owner.pronouns}</p> : null}
          {page.bio ? <p className="page-bio">{page.bio}</p> : null}
          {page.owner.bio && page.owner.bio.trim() !== page.bio?.trim() ? <p className="page-bio page-owner-bio">{page.owner.bio}</p> : null}
          {page.owner.location ? <p className="page-location"><MapPin size={15} aria-hidden="true" />{page.owner.location}</p> : null}
          {page.owner.socials.length ? (
            <nav aria-label={`${page.owner.displayName} social links`} className="page-socials">
              {[...page.owner.socials].sort((left, right) => left.position - right.position).map((social) => {
                const href = safeHttpUrl(social.url)
                return href ? (
                  <a key={`${social.platform}-${social.url}`} href={href} rel="noopener noreferrer" aria-label={`${platformLabel(social.platform)} profile`} title={platformLabel(social.platform)} className="page-social-icon">
                    <SocialIcon platform={social.platform} label={platformLabel(social.platform)} size={19} />
                  </a>
                ) : (
                  <span key={`${social.platform}-${social.url}`} className="page-social-unavailable">
                    {social.platform}
                  </span>
                )
              })}
            </nav>
          ) : null}
        </header>
      ) : (
        <header className="page-profile">
          <h1>{page.title?.trim() || page.slug}</h1>
          <p className="page-handle">/{page.slug}</p>
          {page.bio ? <p className="page-bio">{page.bio}</p> : null}
        </header>
      )}

      <ul className="page-links">
        {links.filter((link) => link.status === 'active' && link.isVisible).map((link) => {
          const href = safeHttpUrl(link.url)
          const groupName = link.groupId ? groupById.get(link.groupId)?.name : undefined
          return (
            <li key={link.id} className="min-w-0">
              {href ? (
                <a
                  href={href}
                  target={link.openInNewTab ? '_blank' : undefined}
                  rel={link.openInNewTab ? 'noopener noreferrer' : undefined}
                  className="page-link"
                >
                  {link.thumbnailKey ? (
                    <img
                      src={`/api/v1/media/files/${link.thumbnailKey}`}
                      alt=""
                      loading="lazy"
                      className="page-link-thumbnail"
                    />
                  ) : null}
                  {groupName ? <span className="page-link-group">{groupName}</span> : null}
                  <span className="page-link-content">
                    <span className="page-link-copy">
                      <span className="page-link-title">{link.title}</span>
                      {link.description ? <span className="page-link-description">{link.description}</span> : null}
                    </span>
                    <ArrowUpRight size={19} aria-hidden="true" className="page-link-arrow" />
                  </span>
                </a>
              ) : (
                <span className="page-link-unavailable">
                  {link.title} — link unavailable
                </span>
              )}
            </li>
          )
        })}
      </ul>
      {!links.some(link => link.status === 'active' && link.isVisible) ? emptyState : null}

      {page.showBranding ? (
        <footer className="page-branding">
          <a href="/" aria-label="OneLink home"><OneLinkBrand /></a>
        </footer>
      ) : null}
    </article>
  )
}
