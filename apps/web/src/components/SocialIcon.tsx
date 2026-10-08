import type { ReactNode } from 'react'
import { cx } from '../lib/css'

// ============================================================================
// Social platform marks.
//
// Monochrome by design: every glyph is drawn in `currentColor`, so a row of
// social icons reads as one family rather than a wall of competing brand colours
// (the ground rule for this redesign — black and white only).
//
// Only the platforms whose marks are recognisable as line art get a bespoke
// glyph. Anything else falls back to a monogram of its label, which stays legible
// at any size and never risks a half-remembered logo. Reads stay lenient: an
// unknown platform is a monogram, not a crash (mirrors `platformLabel`).
// ============================================================================

const GLYPHS: Record<string, ReactNode> = {
  x: (
    <path
      d="M3 3h4.4l5 6.7L17.9 3H21l-7 8.4L21.4 21H17l-5.3-7.2L5.2 21H2l7.4-8.9z"
      fill="currentColor"
      stroke="none"
    />
  ),
  instagram: (
    <>
      <rect x="3.5" y="3.5" width="17" height="17" rx="5" />
      <circle cx="12" cy="12" r="4" />
      <circle cx="17" cy="7" r="1.05" fill="currentColor" stroke="none" />
    </>
  ),
  youtube: (
    <>
      <rect x="2.5" y="5.5" width="19" height="13" rx="3.5" />
      <path d="M10.2 9.4 15 12l-4.8 2.6z" fill="currentColor" stroke="none" />
    </>
  ),
  github: (
    <path
      d="M12 2a10 10 0 0 0-3.16 19.5c.5.1.68-.22.68-.48v-1.7c-2.78.6-3.37-1.34-3.37-1.34-.46-1.16-1.11-1.47-1.11-1.47-.91-.62.07-.6.07-.6 1 .07 1.53 1.03 1.53 1.03.9 1.53 2.34 1.09 2.91.83.09-.65.35-1.09.63-1.34-2.22-.25-4.55-1.11-4.55-4.94 0-1.09.39-1.98 1.03-2.68-.1-.25-.45-1.27.1-2.65 0 0 .84-.27 2.75 1.02a9.5 9.5 0 0 1 5 0c1.91-1.29 2.75-1.02 2.75-1.02.55 1.38.2 2.4.1 2.65.64.7 1.03 1.59 1.03 2.68 0 3.84-2.34 4.68-4.57 4.93.36.31.68.92.68 1.85v2.74c0 .27.18.58.69.48A10 10 0 0 0 12 2z"
      fill="currentColor"
      stroke="none"
    />
  ),
  linkedin: (
    <>
      <rect x="3.5" y="3.5" width="17" height="17" rx="2.5" />
      <path d="M8 10.4V16M8 7.4v.02" />
      <path d="M11.6 16v-3.1a2 2 0 0 1 4 0V16" />
    </>
  ),
  facebook: (
    <path
      d="M13.6 21v-7h2.4l.4-2.8h-2.8V9.4c0-.8.3-1.4 1.5-1.4h1.4V5.5c-.7-.1-1.5-.2-2.3-.2-2.3 0-3.8 1.4-3.8 3.9v2h-2.4V14h2.4v7z"
      fill="currentColor"
      stroke="none"
    />
  ),
  tiktok: (
    <path
      d="M13.5 3c.4 2.3 1.9 3.7 4.3 4v2.2c-1.6.1-3-.3-4.3-1.1v5.5a5.3 5.3 0 1 1-5.3-5.3c.34 0 .67 0 1 .1v2.3a3 3 0 1 0 2.2 2.9V3z"
      fill="currentColor"
      stroke="none"
    />
  ),
  spotify: (
    <>
      <circle cx="12" cy="12" r="9.2" />
      <path d="M7.4 9.4c4-1.1 8.2-.7 11.4 1.1M8 12.3c3.2-.9 6.6-.5 9.2.9M8.6 15.1c2.5-.6 5.2-.3 7.3.7" />
    </>
  ),
  twitch: (
    <>
      <path d="M4 3.5h16v10.7l-4 4h-3.6l-3 3v-3H4z" />
      <path d="M10 7.5v4M15 7.5v4" />
    </>
  ),
  discord: (
    <>
      <path d="M8.2 6.2A15 15 0 0 1 15.8 6.2s3 4 3 8c-1.2 1-2.6 1.7-4.1 2l-1-1.7M8.2 6.2s-3 4-3 8c1.2 1 2.6 1.7 4.1 2l1-1.7" />
      <circle cx="9.6" cy="13.2" r="1.3" fill="currentColor" stroke="none" />
      <circle cx="14.4" cy="13.2" r="1.3" fill="currentColor" stroke="none" />
    </>
  ),
  telegram: <path d="M21 4.5 3.2 11.2l5 1.9 1.6 5 2.7-3.1 4.1 3.1z" />,
  whatsapp: (
    <>
      <path d="M19.8 12a7.8 7.8 0 0 1-11.5 7L4 20l1.1-4A7.8 7.8 0 1 1 19.8 12z" />
      <path d="M9 8.8c-.6 2.2 1.6 5.4 5 6 .7.1 1.3-.2 1.3-.9 0-.4-.9-1-1.3-1.1-.4-.1-.6.4-1 .3-.8-.3-1.7-1.2-1.9-2 0-.5.5-.6.4-1.1-.1-.4-.6-1.2-1.1-1z" />
    </>
  ),
  reddit: (
    <>
      <circle cx="12" cy="13" r="7.5" />
      <circle cx="9.2" cy="13" r="1.3" fill="currentColor" stroke="none" />
      <circle cx="14.8" cy="13" r="1.3" fill="currentColor" stroke="none" />
      <path d="M9 15.8c1.7 1 4.3 1 6 0M4.6 9.2a1.6 1.6 0 1 1 3.2 0M19.4 9.2a1.6 1.6 0 1 0-3.2 0M12 5.6l1-3 2.9.7" />
    </>
  ),
  pinterest: (
    <>
      <circle cx="12" cy="12" r="9.2" />
      <path d="M11.2 17.5c.6-1.7 1.3-4.1 1.3-4.1M11.6 10.4a2 2 0 0 1 3.7-.6c.4 1.7-.9 3.3-2.5 2.6M11.2 17.5c-2-.7-2.9-3.3-1.7-5.2" />
    </>
  ),
  website: (
    <>
      <circle cx="12" cy="12" r="9" />
      <path d="M3 12h18" />
      <path d="M12 3c2.5 2.6 3.8 5.7 3.8 9S14.5 18.4 12 21c-2.5-2.6-3.8-5.7-3.8-9S9.5 5.6 12 3z" />
    </>
  ),
}

export interface SocialIconProps {
  /** The wire platform value, e.g. `instagram`, `ko-fi`. */
  platform: string
  /** The display label, used for the monogram fallback and the accessible name. */
  label: string
  size?: number
  /** When the icon IS the label (a lone icon button), expose the name. */
  labelled?: boolean
  className?: string
}

export function SocialIcon({ platform, label, size = 20, labelled = false, className }: SocialIconProps) {
  const glyph = GLYPHS[platform]
  const name = labelled ? label : undefined

  return (
    <svg
      viewBox="0 0 24 24"
      width={size}
      height={size}
      fill="none"
      stroke="currentColor"
      strokeWidth={1.6}
      strokeLinecap="round"
      strokeLinejoin="round"
      className={cx(className)}
      role={name ? 'img' : undefined}
      aria-label={name}
      aria-hidden={name ? undefined : true}
      focusable="false"
    >
      {glyph ?? (
        <text
          x="12"
          y="16.5"
          textAnchor="middle"
          fontSize="12"
          fontWeight="600"
          fill="currentColor"
          stroke="none"
          fontFamily="var(--font-sans)"
        >
          {(label.trim()[0] ?? '?').toUpperCase()}
        </text>
      )}
    </svg>
  )
}

