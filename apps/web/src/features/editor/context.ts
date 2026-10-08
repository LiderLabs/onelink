import { createContext, useContext } from 'react'
import type { OwnerPage, PageDraftContent, PageLayout, PageTheme } from '../../lib/types'

// ============================================================================
// The editor's shared state.
//
// One tab-family (Profile · Links · Design · Analytics · Settings) edits one
// account and one page. Rather than each tab fetching and writing on its own —
// which would mean five copies of the draft engine and five chances to disagree
// — the shell owns the state and the tabs read it from here. The context is the
// contract between them.
// ============================================================================

/** One link as the editor holds it. `key` is a local React/DnD identity: a new
 *  link has no server id yet, and the draft model creates it on publish. */
export interface EditorLink {
  key: string
  /** The server id, or `null` for a link that exists only in the working draft. */
  id: string | null
  title: string
  url: string
  description: string
  icon: string | null
  isVisible: boolean
  groupId: string | null
  openInNewTab: boolean
  thumbnailKey: string | null
  startsAt: number | null
  endsAt: number | null
}

/** A group in the working draft. Same `key`/`id` split as `EditorLink`. */
export interface EditorGroup {
  key: string
  id: string | null
  name: string
}

/** The page-level appearance fields the editor owns (the draft's `page` object). */
export interface EditorPage {
  title: string
  bio: string
  theme: PageTheme
  layout: PageLayout
  accentColor: string
  showBranding: boolean
}

export type EditorSaveStatus = 'idle' | 'dirty' | 'saving' | 'saved' | 'error'

export interface EditorContextValue {
  /** Every page this account may edit; the editor works on exactly one of them. */
  pages: OwnerPage[]
  pagesLoading: boolean
  /** The page whose links/design/settings this editor is editing. */
  page: OwnerPage
  activePageId: string
  selectPage: (id: string) => void

  /** The working draft, decomposed for the tabs. */
  draftPage: EditorPage
  links: EditorLink[]
  groups: EditorGroup[]

  patchPage: (patch: Partial<EditorPage>) => void
  setLinks: (updater: (links: EditorLink[]) => EditorLink[]) => void
  setGroups: (updater: (groups: EditorGroup[]) => EditorGroup[]) => void

  status: EditorSaveStatus
  /** True while the working draft differs from the live page. */
  unpublished: boolean
  error: unknown

  save: () => Promise<void>
  discard: () => Promise<void>
  publish: () => Promise<void>
  publishing: boolean
  reload: () => void

  /** False for a read-only session (suspended, forced password change, impersonated). */
  canManage: boolean
}

export const EditorContext = createContext<EditorContextValue | null>(null)

export function useEditor(): EditorContextValue {
  const value = useContext(EditorContext)
  if (value === null) throw new Error('useEditor must be used inside <EditorLayout>')
  return value
}

/** A stable local key for a draft row that may not have a server id yet. */
export function newKey(): string {
  const uuid = globalThis.crypto?.randomUUID?.()
  return uuid ?? `k${Math.random().toString(36).slice(2)}${Date.now().toString(36)}`
}

/** Narrow a draft's page object into the editor's string-typed working copy. */
export function toEditorPage(page: PageDraftContent['page']): EditorPage {
  return {
    title: page.title ?? '',
    bio: page.bio ?? '',
    theme: page.theme,
    layout: page.layout,
    accentColor: page.accentColor ?? '',
    showBranding: page.showBranding,
  }
}
