import type { CSSProperties } from 'react'
import { FacebookLogo, InstagramLogo, SnapchatLogo, TiktokLogo, XLogo, YoutubeLogo } from '@phosphor-icons/react'
import { OneLinkBrand } from '../../components/OneLinkBrand'

const platforms = [
  { name: 'Instagram', icon: InstagramLogo, x: 12, y: 50, color: '#302039', glow: '#d64f99', ink: '#fff' },
  { name: 'Snapchat', icon: SnapchatLogo, x: 30, y: 15, color: '#ffdf1b', glow: '#ffdf1b', ink: '#080b10' },
  { name: 'Facebook', icon: FacebookLogo, x: 30, y: 82, color: '#1877f2', glow: '#1877f2', ink: '#fff' },
  { name: 'TikTok', icon: TiktokLogo, x: 70, y: 15, color: '#070c13', glow: '#00d8ef', ink: '#fff' },
  { name: 'YouTube', icon: YoutubeLogo, x: 70, y: 82, color: '#f7192c', glow: '#f7192c', ink: '#fff' },
  { name: 'X', icon: XLogo, x: 88, y: 50, color: '#152033', glow: '#526483', ink: '#fff' },
]

// This is a diagram of profile links, rather than a claim of API integrations.
const connections = [
  'M120 170H420',
  'M300 51H355Q375 51 375 71V150Q375 170 395 170H420',
  'M300 279H355Q375 279 375 259V190Q375 170 395 170H420',
  'M700 51H645Q625 51 625 71V150Q625 170 605 170H580',
  'M700 279H645Q625 279 625 259V190Q625 170 605 170H580',
  'M880 170H580',
]

export function PlatformHero({ brandName }: { brandName: string }) {
  return (
    <figure className="landing-network" aria-label={`Your platforms, connected through ${brandName}`}>
      <svg className="landing-connections" viewBox="0 0 1000 340" preserveAspectRatio="none" fill="none" aria-hidden="true" focusable="false">
        {connections.map(path => <g key={path}>
          <path className="landing-connection" d={path} vectorEffect="non-scaling-stroke" />
          <path className="landing-connection-flow" d={path} vectorEffect="non-scaling-stroke" />
        </g>)}
      </svg>
      <div className="landing-platform-hub"><OneLinkBrand name={brandName} /></div>
      <ul className="landing-platforms" aria-label="Social platforms">
        {platforms.map(({ name, icon: Icon, x, y, color, glow, ink }) => (
          <li key={name} className="landing-platform-node" style={{ '--node-x': `${x}%`, '--node-y': `${y}%`, '--platform-color': color, '--platform-glow': glow, '--platform-ink': ink } as CSSProperties}>
            <span className="landing-platform-icon"><Icon size={30} weight={name === 'Instagram' || name === 'X' ? 'regular' : 'fill'} aria-hidden="true" /></span>
            <span className="landing-platform-label">{name}</span>
          </li>
        ))}
      </ul>
    </figure>
  )
}
