import type { ReactNode, SVGProps } from 'react'

// ============================================================================
// The icon set.
//
// One module, one component, one place to fix a glyph. Icons are drawn as
// strokes on `currentColor`, so a monochrome interface stays monochrome by
// construction: an icon can never introduce a hue the palette did not already
// have (the ground rule for this redesign — black and white only).
//
// They are decorative by default (`aria-hidden`): an icon sits beside a word
// that carries the meaning, never in place of it. `title` is offered for the few
// places where an icon really is the whole label, and only then does it become
// exposed to assistive tech.
// ============================================================================

export type IconName =
  | 'dashboard'
  | 'profile'
  | 'links'
  | 'design'
  | 'analytics'
  | 'settings'
  | 'share'
  | 'qr'
  | 'plus'
  | 'edit'
  | 'trash'
  | 'eye'
  | 'eye-off'
  | 'grip'
  | 'arrow-right'
  | 'arrow-up-right'
  | 'chevron-down'
  | 'chevron-right'
  | 'search'
  | 'close'
  | 'check'
  | 'copy'
  | 'mail'
  | 'upload'
  | 'download'
  | 'image'
  | 'globe'
  | 'calendar'
  | 'clock'
  | 'refresh'
  | 'code'
  | 'folder'
  | 'play'
  | 'sparkles'
  | 'external'
  | 'pin'
  | 'dots'
  | 'bell'
  | 'lock'
  | 'users'
  | 'inbox'
  | 'shield'
  | 'palette'
  | 'type'

const PATHS: Record<IconName, ReactNode> = {
  dashboard: (
    <>
      <rect x="3" y="3" width="7" height="7" rx="1.5" />
      <rect x="14" y="3" width="7" height="7" rx="1.5" />
      <rect x="14" y="14" width="7" height="7" rx="1.5" />
      <rect x="3" y="14" width="7" height="7" rx="1.5" />
    </>
  ),
  profile: (
    <>
      <circle cx="12" cy="8" r="3.5" />
      <path d="M4.5 20a7.5 7.5 0 0 1 15 0" />
    </>
  ),
  links: (
    <>
      <path d="M9.5 14.5 14.5 9.5" />
      <path d="M8.2 11.8 5.6 14.4a3.6 3.6 0 0 0 5.1 5.1l2.6-2.6" />
      <path d="M15.8 12.2l2.6-2.6a3.6 3.6 0 0 0-5.1-5.1l-2.6 2.6" />
    </>
  ),
  design: (
    <>
      <path d="M4 7h16" />
      <path d="M4 12h16" />
      <path d="M4 17h16" />
      <circle cx="9" cy="7" r="2" fill="currentColor" stroke="none" />
      <circle cx="15" cy="12" r="2" fill="currentColor" stroke="none" />
      <circle cx="8" cy="17" r="2" fill="currentColor" stroke="none" />
    </>
  ),
  analytics: (
    <>
      <path d="M3 20h18" />
      <path d="M6 20v-8" />
      <path d="M12 20V4" />
      <path d="M18 20v-5" />
    </>
  ),
  settings: (
    <>
      <circle cx="12" cy="12" r="3" />
      <path d="M12 2.5v2.6M12 18.9v2.6M4.2 4.2l1.9 1.9M17.9 17.9l1.9 1.9M2.5 12h2.6M18.9 12h2.6M4.2 19.8l1.9-1.9M17.9 6.1l1.9-1.9" />
    </>
  ),
  share: (
    <>
      <circle cx="6" cy="12" r="2.5" />
      <circle cx="18" cy="6" r="2.5" />
      <circle cx="18" cy="18" r="2.5" />
      <path d="M8.3 10.8 15.7 7.2M8.3 13.2l7.4 3.6" />
    </>
  ),
  qr: (
    <>
      <rect x="3" y="3" width="7" height="7" rx="1" />
      <rect x="14" y="3" width="7" height="7" rx="1" />
      <rect x="3" y="14" width="7" height="7" rx="1" />
      <path d="M14 14h3v3M20.5 14v.01M14 20.5v.01M20.5 20.5v.01M17.5 17.5v.01M20.5 17.5v.01M17.5 20.5h3" />
    </>
  ),
  plus: <path d="M12 5v14M5 12h14" />,
  edit: (
    <>
      <path d="M4 20h4l10.5-10.5-4-4L4 16v4z" />
      <path d="M14.5 5.5l4 4" />
    </>
  ),
  trash: (
    <>
      <path d="M4 7h16" />
      <path d="M9 7V5.2A1.2 1.2 0 0 1 10.2 4h3.6A1.2 1.2 0 0 1 15 5.2V7" />
      <path d="M6.2 7l.9 12.1A1.2 1.2 0 0 0 8.3 20.2h7.4a1.2 1.2 0 0 0 1.2-1.1L17.8 7" />
      <path d="M10 11v5.5M14 11v5.5" />
    </>
  ),
  eye: (
    <>
      <path d="M2.5 12S6 5.5 12 5.5 21.5 12 21.5 12 18 18.5 12 18.5 2.5 12 2.5 12z" />
      <circle cx="12" cy="12" r="3" />
    </>
  ),
  'eye-off': (
    <>
      <path d="M3 3l18 18" />
      <path d="M10.6 6.2A11 11 0 0 1 12 6c6 0 9.5 6 9.5 6a18 18 0 0 1-3 3.6" />
      <path d="M6.3 6.9A17.6 17.6 0 0 0 2.5 12s3.5 6 9.5 6a10.7 10.7 0 0 0 4-.7" />
      <path d="M9.9 9.9a3 3 0 0 0 4.2 4.2" />
    </>
  ),
  grip: (
    <>
      <circle cx="9" cy="6" r="1.3" fill="currentColor" stroke="none" />
      <circle cx="15" cy="6" r="1.3" fill="currentColor" stroke="none" />
      <circle cx="9" cy="12" r="1.3" fill="currentColor" stroke="none" />
      <circle cx="15" cy="12" r="1.3" fill="currentColor" stroke="none" />
      <circle cx="9" cy="18" r="1.3" fill="currentColor" stroke="none" />
      <circle cx="15" cy="18" r="1.3" fill="currentColor" stroke="none" />
    </>
  ),
  'arrow-right': (
    <>
      <path d="M4 12h15" />
      <path d="M13 6l6 6-6 6" />
    </>
  ),
  'arrow-up-right': (
    <>
      <path d="M7 17 17 7" />
      <path d="M8 7h9v9" />
    </>
  ),
  'chevron-down': <path d="M6 9l6 6 6-6" />,
  'chevron-right': <path d="M9 6l6 6-6 6" />,
  search: (
    <>
      <circle cx="11" cy="11" r="6" />
      <path d="M20 20l-4.2-4.2" />
    </>
  ),
  close: <path d="M6 6l12 12M18 6L6 18" />,
  check: <path d="M5 12.5l4.5 4.5L20 6.5" />,
  copy: (
    <>
      <rect x="9" y="9" width="11" height="11" rx="2" />
      <path d="M5.5 15H5a1.5 1.5 0 0 1-1.5-1.5v-9A1.5 1.5 0 0 1 5 3h9A1.5 1.5 0 0 1 15.5 4.5V5" />
    </>
  ),
  mail: (
    <>
      <rect x="3" y="5" width="18" height="14" rx="2" />
      <path d="M4 7.5l8 5.5 8-5.5" />
    </>
  ),
  upload: (
    <>
      <path d="M12 16V4" />
      <path d="M7 9l5-5 5 5" />
      <path d="M4 20h16" />
    </>
  ),
  download: (
    <>
      <path d="M12 4v12" />
      <path d="M7 11l5 5 5-5" />
      <path d="M4 20h16" />
    </>
  ),
  image: (
    <>
      <rect x="3" y="4" width="18" height="16" rx="2" />
      <circle cx="8.5" cy="9.5" r="1.5" />
      <path d="M4 17.5l5-5 4 4 3-3 4 4" />
    </>
  ),
  globe: (
    <>
      <circle cx="12" cy="12" r="9" />
      <path d="M3 12h18" />
      <path d="M12 3c2.5 2.6 3.8 5.7 3.8 9S14.5 18.4 12 21c-2.5-2.6-3.8-5.7-3.8-9S9.5 5.6 12 3z" />
    </>
  ),
  calendar: (
    <>
      <rect x="3" y="5" width="18" height="16" rx="2" />
      <path d="M3 9.5h18" />
      <path d="M8 3v4M16 3v4" />
    </>
  ),
  clock: (
    <>
      <circle cx="12" cy="12" r="9" />
      <path d="M12 7v5.2l3.2 2" />
    </>
  ),
  refresh: (
    <>
      <path d="M20 11a8 8 0 0 0-14-4.5L4 9" />
      <path d="M4 5v4h4" />
      <path d="M4 13a8 8 0 0 0 14 4.5L20 15" />
      <path d="M20 19v-4h-4" />
    </>
  ),
  code: (
    <>
      <path d="M8 8l-4 4 4 4" />
      <path d="M16 8l4 4-4 4" />
    </>
  ),
  folder: <path d="M3 7.5A2 2 0 0 1 5 5.5h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" />,
  play: <path d="M8 5l11 7-11 7z" />,
  sparkles: (
    <>
      <path d="M12 3l1.8 4.2L18 9l-4.2 1.8L12 15l-1.8-4.2L6 9l4.2-1.8z" />
      <path d="M18 15l.9 2.1L21 18l-2.1.9L18 21l-.9-2.1L15 18l2.1-.9z" />
    </>
  ),
  external: (
    <>
      <path d="M14 4h6v6" />
      <path d="M20 4l-9 9" />
      <path d="M19 14v5a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V6a1 1 0 0 1 1-1h5" />
    </>
  ),
  pin: (
    <>
      <path d="M12 21s7-6.1 7-11a7 7 0 1 0-14 0c0 4.9 7 11 7 11z" />
      <circle cx="12" cy="10" r="2.5" />
    </>
  ),
  dots: (
    <>
      <circle cx="5" cy="12" r="1.5" fill="currentColor" stroke="none" />
      <circle cx="12" cy="12" r="1.5" fill="currentColor" stroke="none" />
      <circle cx="19" cy="12" r="1.5" fill="currentColor" stroke="none" />
    </>
  ),
  bell: (
    <>
      <path d="M6 9a6 6 0 0 1 12 0c0 4.5 1.8 5.7 1.8 5.7H4.2S6 13.5 6 9z" />
      <path d="M10 19a2 2 0 0 0 4 0" />
    </>
  ),
  lock: (
    <>
      <rect x="4" y="10" width="16" height="10" rx="2" />
      <path d="M8 10V7a4 4 0 0 1 8 0v3" />
    </>
  ),
  users: (
    <>
      <circle cx="9" cy="8" r="3.2" />
      <path d="M3.5 20a5.5 5.5 0 0 1 11 0" />
      <path d="M16 5.5a3 3 0 0 1 0 5.6" />
      <path d="M17.8 14.4A5.5 5.5 0 0 1 21 20" />
    </>
  ),
  inbox: (
    <>
      <path d="M3 12.5 5 5a1.5 1.5 0 0 1 1.5-1h11A1.5 1.5 0 0 1 19 5l2 7.5V18a1.5 1.5 0 0 1-1.5 1.5h-13A1.5 1.5 0 0 1 3 18z" />
      <path d="M3 12.5h5l1 2h6l1-2h5" />
    </>
  ),
  shield: (
    <>
      <path d="M12 3l7 3v5.5c0 4.4-3 8.2-7 9.5-4-1.3-7-5.1-7-9.5V6z" />
      <path d="M9 12l2 2 4-4" />
    </>
  ),
  palette: (
    <>
      <path d="M12 3a9 9 0 1 0 0 18c1.4 0 2-1 2-2 0-1.4-1.2-1.6-1.2-2.6 0-.9.7-1.6 1.7-1.6H16a5 5 0 0 0 5-5c0-3.9-4-6.8-9-6.8z" />
      <circle cx="7.5" cy="11" r="1.1" fill="currentColor" stroke="none" />
      <circle cx="10.5" cy="7.5" r="1.1" fill="currentColor" stroke="none" />
      <circle cx="15" cy="7.8" r="1.1" fill="currentColor" stroke="none" />
    </>
  ),
  type: (
    <>
      <path d="M5 6V4.5h14V6" />
      <path d="M12 4.5V20" />
      <path d="M9 20h6" />
    </>
  ),
}

export interface IconProps extends Omit<SVGProps<SVGSVGElement>, 'name' | 'title'> {
  name: IconName
  size?: number | undefined
  /** When an icon IS the label, give it one so it is announced. */
  title?: string | undefined
}

export function Icon({ name, size = 20, title, className, ...rest }: IconProps) {
  const labelled = title !== undefined
  return (
    <svg
      {...rest}
      viewBox="0 0 24 24"
      width={size}
      height={size}
      fill="none"
      stroke="currentColor"
      strokeWidth={1.6}
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
      role={labelled ? 'img' : undefined}
      aria-label={labelled ? title : undefined}
      aria-hidden={labelled ? undefined : true}
      focusable="false"
    >
      {PATHS[name]}
    </svg>
  )
}
