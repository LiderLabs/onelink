import { useEffect } from 'react'
import type { CSSProperties, ReactNode } from 'react'
import { Link } from 'react-router-dom'
import { AddressBook, ArrowRight, ArrowUp, ArrowUpRight, CurrencyCircleDollar, EnvelopeOpen, FacebookLogo, Flower, Globe, Headphones, Heart, InstagramLogo, MagnifyingGlass, Microphone, PaypalLogo, PinterestLogo, RedditLogo, ShoppingBag, SoundcloudLogo, Sparkle, SpotifyLogo, SquaresFour, Textbox, Ticket, TiktokLogo, TwitchLogo, TwitterLogo, Users, Waveform, YoutubeLogo } from '@phosphor-icons/react'
import type { Icon } from '@phosphor-icons/react'
import { OneLinkBrand } from '../../components/OneLinkBrand'
import { useSession } from '../../lib/session'
import { PageRenderer } from '../pages/PageRenderer'
import type { PageRenderModel } from '../pages/PageRenderer'
import { useLandingMotion } from './use-landing-motion'
import './landing.css'

type Destination = { name: string; description: string; icon: Icon; color: string }

const content: Destination[] = [
  { name: 'Audiomack', description: 'Put your latest tracks in the spotlight.', icon: Waveform, color: '#ff9900' },
  { name: 'SoundCloud', description: 'Give your music a place to be found.', icon: SoundcloudLogo, color: '#ff5500' },
  { name: 'TikTok', description: 'Share the videos that make you, you.', icon: TiktokLogo, color: '#080b10' },
  { name: 'X / Twitter', description: 'Keep your audience in the conversation.', icon: TwitterLogo, color: '#229de5' },
  { name: 'YouTube', description: 'Bring your channel and videos together.', icon: YoutubeLogo, color: '#ef2534' },
  { name: 'Twitch', description: 'Take your community to your next stream.', icon: TwitchLogo, color: '#7042cc' },
]
const business: Destination[] = [
  { name: 'Events & tickets', description: 'Send your fans straight to your next event.', icon: Ticket, color: '#00a99d' },
  { name: 'GoFundMe', description: 'Share the causes you care about most.', icon: Heart, color: '#02ae67' },
  { name: 'PayPal', description: 'Link to your existing PayPal page.', icon: PaypalLogo, color: '#0768b5' },
  { name: 'Square', description: 'Give your business another way to be found.', icon: SquaresFour, color: '#111111' },
  { name: 'Spring', description: 'Show your audience your latest collection.', icon: Flower, color: '#dc457c' },
  { name: 'Shopify', description: 'Bring visitors to the products you sell.', icon: ShoppingBag, color: '#6b9b23' },
]
const following: Destination[] = [
  { name: 'Typeform', description: 'Link to your surveys, forms, and more.', icon: Textbox, color: '#222222' },
  { name: 'Reddit', description: 'Find your people. Share your community.', icon: RedditLogo, color: '#ff4500' },
  { name: 'Contact details', description: 'Make it easy to find your contact page.', icon: AddressBook, color: '#a63296' },
  { name: 'Community', description: 'Bring everyone together in your space.', icon: Users, color: '#111111' },
  { name: 'Gleam', description: 'Share your campaigns with your audience.', icon: Sparkle, color: '#158bba' },
  { name: 'Contact forms', description: 'Connect visitors to your existing forms.', icon: EnvelopeOpen, color: '#4225b3' },
]
const more: Destination[] = [
  { name: 'Spotify', description: 'Share your latest release or favorite playlist.', icon: SpotifyLogo, color: '#00a747' },
  { name: 'Instagram', description: 'Give your photos and stories a home.', icon: InstagramLogo, color: '#d3387a' },
  { name: 'Facebook', description: 'Keep your page one click away.', icon: FacebookLogo, color: '#1877f2' },
  { name: 'Pinterest', description: 'Share the ideas that inspire you.', icon: PinterestLogo, color: '#e60023' },
  { name: 'Podcasts', description: 'Help listeners find their next favorite episode.', icon: Microphone, color: '#839b0b' },
  { name: 'Tip jar', description: 'Link to the support page you already use.', icon: CurrencyCircleDollar, color: '#345cdc' },
]

function ReloadLink({ children, className, label }: { children: ReactNode; className?: string; label?: string }) {
  // Native anchors intentionally reload the homepage, as requested.
  return <a href="/" className={className} aria-label={label}>{children}</a>
}

function AuthLinks() {
  return <div className="landing-auth-links"><Link to="/login" className="landing-sign-in">Sign in</Link><Link to="/register" className="landing-sign-up">Sign up free</Link></div>
}

function DestinationSection({ title, items, browseLabel = 'See all' }: { title: string; items: Destination[]; browseLabel?: string }) {
  return <section className="landing-catalog-section" aria-label={title}>
    <div className="landing-section-heading"><h2>{title}</h2><ReloadLink className="landing-see-all">{browseLabel}<ArrowUpRight size={16} aria-hidden="true" /></ReloadLink></div>
    <div className="landing-destinations">{items.map(({ name, description, icon: Icon, color }) => <ReloadLink key={name} className="landing-destination"><span className="landing-app-icon" style={{ '--app-color': color } as CSSProperties}><Icon size={26} weight="fill" aria-hidden="true" /></span><span><strong>{name}</strong><span>{description}</span></span></ReloadLink>)}</div>
  </section>
}

function HeroArtwork() {
  // Uses the actual public-page renderer, with illustrative content only.
  const homepage = new URL('/', window.location.origin).href
  const demo: PageRenderModel = {
    slug: 'mikejay', title: 'Mike Jay', bio: 'Making things. Sharing stories. Finding my people.', theme: 'dark', layout: 'list', accentColor: '#00d8ef', showBranding: true,
    owner: { username: 'mikejay', displayName: 'Mike Jay', avatarUrl: null, bio: null, location: null, pronouns: null, socials: [{ platform: 'instagram', url: homepage, position: 0 }, { platform: 'youtube', url: homepage, position: 1 }] },
    links: ['My latest work', 'Watch my videos', 'Let’s connect'].map((title, position) => ({ id: `landing-example-${position}`, title, position, url: homepage, domain: null, description: null, icon: null, isVisible: true, startsAt: null, endsAt: null, groupId: null, openInNewTab: false, thumbnailKey: null, status: 'active', createdAt: 0, updatedAt: 0 })),
  }
  return <div className="landing-artwork" aria-hidden="true" inert>
    <div className="landing-art-canvas">
      <span className="landing-orbit landing-orbit-pink" /><span className="landing-orbit landing-orbit-cyan" /><span className="landing-orbit landing-orbit-orange" />
      <Flower className="landing-art-flower" size={128} weight="fill" />
      <div className="landing-example-page"><PageRenderer page={demo} /></div>
      <div className="landing-everywhere"><Globe size={36} weight="light" /><strong>One link.<br />Everywhere.</strong><span>All the things you do.</span></div>
      <div className="landing-music"><span className="landing-music-label">ON REPEAT</span><div className="landing-headphones"><Headphones size={84} weight="light" /></div><strong>A little more you.</strong><Waveform size={96} weight="light" /><span>Music. Stories. Everything.</span></div>
      <div className="landing-social-orbit"><InstagramLogo size={22} /><YoutubeLogo size={24} /><TiktokLogo size={22} /></div>
    </div>
  </div>
}

export function LandingPageRoute() {
  const { platformName } = useSession()
  const motionRoot = useLandingMotion()
  const scrollToHero = () => {
    const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches
    window.scrollTo({ top: 0, behavior: reducedMotion ? 'instant' : 'smooth' })
    document.getElementById('landing-title')?.focus({ preventScroll: true })
  }
  useEffect(() => {
    const previousTitle = document.title
    const theme = document.querySelector<HTMLMetaElement>('meta[name="theme-color"]')
    const previousTheme = theme?.content
    document.title = `${platformName} | All of you. One link.`
    if (theme) theme.content = '#08257e'
    const existingDescription = document.querySelector<HTMLMetaElement>('meta[name="description"]')
    const description = existingDescription ?? document.createElement('meta')
    const previousDescription = description.content
    description.name = 'description'
    description.content = 'Bring your profiles, content, and favorite links together. Create your own OneLink page and share your world with one link.'
    if (!existingDescription) document.head.append(description)
    return () => {
      document.title = previousTitle
      if (theme && previousTheme) theme.content = previousTheme
      if (existingDescription) description.content = previousDescription
      else description.remove()
    }
  }, [platformName])

  return <div ref={motionRoot} className="landing-page">
    <a href="#landing-main" className="landing-skip">Skip to content</a>
    <div className="landing-masthead">
      <header className="landing-header"><nav className="landing-navigation" aria-label="Main navigation">
        <ReloadLink className="landing-brand" label={`${platformName} home`}><OneLinkBrand name={platformName} /></ReloadLink>
        <div className="landing-nav-pages"><ReloadLink>Browse</ReloadLink><ReloadLink>More</ReloadLink></div>
        <AuthLinks />
      </nav></header>
    </div>
    <main id="landing-main">
      <div className="landing-hero">
        <section className="landing-hero-content landing-container" aria-labelledby="landing-title">
          <div className="landing-hero-copy"><p className="landing-eyebrow">Your world. One link.</p><h1 id="landing-title" tabIndex={-1}>Connect<br />more of you.</h1><p className="landing-hero-description">Bring the best of you from across the internet into one place. Your own little corner, with a link to everything.</p>
            <Link to="/register" className="landing-hero-cta">Sign up free<span><ArrowUpRight size={22} aria-hidden="true" /></span></Link>
            <ReloadLink className="landing-discover"><MagnifyingGlass size={20} aria-hidden="true" /><span>Explore what you can share</span><ArrowRight size={19} aria-hidden="true" /></ReloadLink>
          </div>
          <HeroArtwork />
        </section>
      </div>

    <div className="landing-content landing-container">
      <section className="landing-featured" aria-labelledby="landing-featured-title">
        <div className="landing-section-heading"><h2 id="landing-featured-title">Featured</h2><span>A little inspiration for your page.</span></div>
        <div className="landing-featured-grid">
          <ReloadLink className="landing-feature-card"><div className="landing-feature-art landing-reddit-art"><span className="landing-reddit-dot" /><RedditLogo size={148} weight="fill" /><Sparkle size={54} weight="light" className="landing-reddit-sparkle" /><span className="landing-reddit-ring" /></div><div className="landing-feature-caption"><span className="landing-app-icon" style={{ '--app-color': '#ff4500' } as CSSProperties}><RedditLogo size={26} weight="fill" /></span><span><strong>Reddit</strong><span>Your people are out there. Help them find you.</span></span><ArrowUpRight size={22} aria-hidden="true" /></div></ReloadLink>
          <ReloadLink className="landing-feature-card"><div className="landing-feature-art landing-tiktok-art"><span className="landing-tiktok-pink" /><span className="landing-tiktok-cyan" /><TiktokLogo size={116} weight="fill" /><span className="landing-video-frame"><span className="landing-video-avatar">MJ</span><span className="landing-video-line" /><span className="landing-video-line landing-video-line-short" /><span className="landing-video-play"><YoutubeLogo size={32} weight="fill" /></span></span></div><div className="landing-feature-caption"><span className="landing-app-icon" style={{ '--app-color': '#080b10' } as CSSProperties}><TiktokLogo size={26} weight="fill" /></span><span><strong>TikTok</strong><span>Give your next great video a bigger audience.</span></span><ArrowUpRight size={22} aria-hidden="true" /></div></ReloadLink>
        </div>
      </section>

      <DestinationSection title="Share your content" items={content} browseLabel="Explore content" />
      <DestinationSection title="Make room for your business" items={business} browseLabel="Explore business" />

      <section className="landing-possibilities" aria-labelledby="landing-possibilities-title"><div><p className="landing-banner-eyebrow">Made for all sides of you</p><h2 id="landing-possibilities-title">One page.<br />Endless possibilities.</h2><p>Your work, your passions, your next big idea. There’s room for every part of your world.</p><ReloadLink className="landing-banner-link">Explore OneLink<span><ArrowUpRight size={20} aria-hidden="true" /></span></ReloadLink></div><div className="landing-banner-art" aria-hidden="true"><span className="landing-banner-blue" /><span className="landing-banner-person" /><span className="landing-banner-pink"><Flower size={136} weight="fill" /></span><Sparkle size={70} weight="fill" className="landing-banner-sparkle" /></div></section>

      <DestinationSection title="Grow your following" items={following} browseLabel="Explore community" />
      <DestinationSection title="All your links, one place" items={more} />

      <section className="landing-ready"><div><p className="landing-banner-eyebrow">Your next chapter starts here</p><h2>A home for everything you are.</h2></div><Link to="/register" className="landing-ready-cta">Sign up free<span><ArrowUpRight size={23} aria-hidden="true" /></span></Link></section>
    </div>

    </main>
    <footer className="landing-footer"><div className="landing-container">
      <div className="landing-footer-card"><div className="landing-footer-intro"><ReloadLink className="landing-brand" label={`${platformName} home`}><OneLinkBrand name={platformName} /></ReloadLink><p>Everything you create.<br />One place to share.</p><AuthLinks /></div>
        <nav className="landing-footer-nav" aria-label="Footer navigation"><div><strong>OneLink</strong>{['About OneLink', 'Blog', 'Press', 'Contact'].map(label => <ReloadLink key={label}>{label}</ReloadLink>)}</div><div><strong>Explore</strong>{['Getting started', 'Features', 'FAQs', 'Help center'].map(label => <ReloadLink key={label}>{label}</ReloadLink>)}</div><div><strong>The details</strong>{['Terms and conditions', 'Privacy policy', 'Cookie notice', 'Trust center'].map(label => <ReloadLink key={label}>{label}</ReloadLink>)}</div></nav>
        <div className="landing-footer-bottom"><p>© {new Date().getFullYear()} {platformName}. All your links. One place.</p><div className="landing-footer-socials">{[{ label: 'X / Twitter', icon: TwitterLogo }, { label: 'Instagram', icon: InstagramLogo }, { label: 'YouTube', icon: YoutubeLogo }, { label: 'TikTok', icon: TiktokLogo }].map(({ label, icon: Icon }) => <ReloadLink key={label} label={label}><Icon size={22} weight="fill" aria-hidden="true" /></ReloadLink>)}</div></div>
      </div>
      <ReloadLink className="landing-wordmark" label={`${platformName} home`}>{platformName === 'OneLink' ? <>One<span>Link</span></> : platformName}<span className="landing-wordmark-star" aria-hidden="true"><Sparkle size={54} weight="fill" /></span></ReloadLink>
      <div className="landing-back-to-top-row"><button type="button" className="landing-back-to-top" onClick={scrollToHero}><ArrowUp size={20} weight="bold" aria-hidden="true" />Back to top</button></div>
    </div></footer>
  </div>
}

