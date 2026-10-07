import type { CSSProperties } from 'react'
import type { PageLink, PageLayout, PageTheme, PublicPageOwner } from '../../lib/types'

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
    return url.protocol === 'http:' || url.protocol === 'https:' ? url.href : null
  } catch {
    return null
  }
}

export function PageRenderer({ page }: { page: PageRenderModel }) {
  const dark = page.theme === 'dark'
  const groupById = new Map((page.groups ?? []).map((group) => [group.id, group]))
  const links = [...page.links].sort((left, right) => left.position - right.position)
  const style = {
    '--page-accent': page.accentColor ?? '#111111',
  } as CSSProperties

  return (
    <article
      className={`page-renderer mx-auto w-full max-w-xl px-5 py-10 sm:px-8 sm:py-14 ${dark ? 'bg-[#151515] text-[#f7f4ed]' : 'bg-white text-[#171715]'}`}
      style={style}
    >
      {page.owner ? (
        <header className="mx-auto max-w-xl text-center">
          {page.owner.avatarUrl ? (
            <img src={page.owner.avatarUrl} alt="" className="mx-auto mb-6 h-24 w-24 rounded-full object-cover sm:h-28 sm:w-28" />
          ) : (
            <div aria-hidden="true" className={`mx-auto mb-6 grid h-24 w-24 place-items-center rounded-full border sm:h-28 sm:w-28 ${dark ? 'border-white/25' : 'border-black/20'} font-display text-3xl`}>
              {Array.from(page.owner.displayName)[0]?.toUpperCase() ?? '?'}
            </div>
          )}
          <p className={`font-mono text-xs uppercase tracking-[0.16em] ${dark ? 'text-white/60' : 'text-black/55'}`}>@{page.owner.username}</p>
          <h1 className="mt-2 font-display text-4xl font-medium tracking-tight sm:text-5xl">
            {page.title?.trim() || page.owner.displayName}
          </h1>
          {page.owner.pronouns ? <p className={`mt-2 text-sm ${dark ? 'text-white/60' : 'text-black/55'}`}>{page.owner.pronouns}</p> : null}
          {page.bio ? <p className={`mx-auto mt-5 max-w-md whitespace-pre-wrap text-base leading-7 ${dark ? 'text-white/75' : 'text-black/70'}`}>{page.bio}</p> : null}
          {page.owner.bio ? <p className={`mx-auto mt-3 max-w-md whitespace-pre-wrap text-sm leading-6 ${dark ? 'text-white/55' : 'text-black/55'}`}>{page.owner.bio}</p> : null}
          {page.owner.location ? <p className={`mt-3 font-mono text-[0.6875rem] uppercase tracking-[0.12em] ${dark ? 'text-white/45' : 'text-black/45'}`}>{page.owner.location}</p> : null}
          {page.owner.socials.length ? (
            <nav aria-label={`${page.owner.displayName} social links`} className="mt-5 flex flex-wrap justify-center gap-x-4 gap-y-2">
              {page.owner.socials.map((social) => {
                const href = safeHttpUrl(social.url)
                return href ? (
                  <a key={`${social.platform}-${social.url}`} href={href} rel="noopener noreferrer" className={`text-xs underline underline-offset-4 ${dark ? 'text-white/70' : 'text-black/65'}`}>
                    {social.platform}
                  </a>
                ) : (
                  <span key={`${social.platform}-${social.url}`} className={`text-xs ${dark ? 'text-white/50' : 'text-black/45'}`}>
                    {social.platform}
                  </span>
                )
              })}
            </nav>
          ) : null}
        </header>
      ) : (
        <header className="mx-auto max-w-xl text-center">
          <p className={`font-mono text-xs uppercase tracking-[0.16em] ${dark ? 'text-white/55' : 'text-black/50'}`}>/{page.slug}</p>
          <h1 className="mt-3 font-display text-4xl font-medium tracking-tight sm:text-5xl">{page.title?.trim() || page.slug}</h1>
          {page.bio ? <p className={`mx-auto mt-5 max-w-lg whitespace-pre-wrap text-base leading-relaxed ${dark ? 'text-white/70' : 'text-black/65'}`}>{page.bio}</p> : null}
        </header>
      )}

      <ul className={`mx-auto mt-8 grid max-w-xl gap-3 sm:mt-10 ${page.layout === 'grid' ? 'sm:grid-cols-2' : 'grid-cols-1'}`}>
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
                  className={`group block h-full border px-5 py-4 transition-transform hover:-translate-y-0.5 ${dark ? 'border-white/20 hover:border-white/60' : 'border-black/20 hover:border-black/70'}`}
                  style={{ borderInlineStartColor: 'var(--page-accent)' }}
                >
                  {link.thumbnailKey ? (
                    <img
                      src={`/api/v1/media/files/${link.thumbnailKey}`}
                      alt=""
                      loading="lazy"
                      className="mb-3 aspect-16/7 w-full object-cover"
                    />
                  ) : null}
                  {groupName ? <span className={`mb-2 block font-mono text-[0.6rem] uppercase tracking-[0.16em] ${dark ? 'text-white/45' : 'text-black/45'}`}>{groupName}</span> : null}
                  <span className="flex items-center justify-between gap-4">
                    <span className="min-w-0">
                      <span className="block wrap-break-word font-medium">{link.title}</span>
                      {link.description ? <span className={`mt-1 block whitespace-pre-wrap text-sm leading-relaxed ${dark ? 'text-white/55' : 'text-black/55'}`}>{link.description}</span> : null}
                    </span>
                    <span aria-hidden="true" className="shrink-0 font-mono text-sm">↗</span>
                  </span>
                </a>
              ) : (
                <span className="block border border-danger px-5 py-4 text-sm text-danger">
                  {link.title} — link unavailable
                </span>
              )}
            </li>
          )
        })}
      </ul>

      {page.showBranding ? (
        <footer className={`mt-12 text-center font-mono text-[0.625rem] uppercase tracking-[0.16em] ${dark ? 'text-white/40' : 'text-black/40'}`}>
          OneLink
        </footer>
      ) : null}
    </article>
  )
}
