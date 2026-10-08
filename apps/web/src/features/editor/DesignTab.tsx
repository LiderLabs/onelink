import type { ReactNode } from 'react'
import { CheckboxField, Field, SelectField, TextareaField } from '../../components/Field'
import { Panel } from '../../components/Panel'
import { PageHeader } from '../../components/PageHeader'
import { Notice } from '../../components/Notice'
import { useEditor } from './context'

// ============================================================================
// The Design tab.
//
// Everything here is backed by the page draft: title, bio, theme, layout, accent
// and the branding credit are all real columns the API accepts and the public
// renderer reads. The controls the wireframe adds around them — corner radius,
// typeface, button style, background, extra colours, custom CSS — have no column
// and no endpoint, so they are shown disabled and labelled "not saved yet".
// That is the difference between an absent feature and a lying one.
// ============================================================================

/** A control that exists in the mockup but has nothing to persist to yet. */
function PendingControl({ label, hint, children }: { label: string; hint?: string; children: ReactNode }) {
  return (
    <div className="opacity-60">
      <p className="eyebrow mb-2 block">{label}</p>
      <div aria-disabled="true" className="pointer-events-none">{children}</div>
      <p className="mt-2 font-mono text-[0.6875rem] text-ink-faint">{hint ?? 'Not saved yet.'}</p>
    </div>
  )
}

export function DesignTab() {
  const { draftPage, patchPage, canManage } = useEditor()
  const disabled = !canManage

  return (
    <div className="space-y-7">
      <PageHeader
        eyebrow="Appearance"
        title="Design"
        description="How your page looks to everyone who opens it. Changes autosave as a private draft and go live when you publish."
      />

      <div className="grid gap-6 lg:grid-cols-2">
        <Panel eyebrow="01 · Identity" title="Page title & introduction">
          <div className="space-y-5">
            <Field
              label="Page title"
              value={draftPage.title}
              maxLength={120}
              disabled={disabled}
              hint={`${draftPage.title.length}/120 characters. Shown as the page's headline.`}
              onChange={(event) => patchPage({ title: event.currentTarget.value })}
            />
            <TextareaField
              label="Introduction"
              rows={4}
              value={draftPage.bio}
              maxLength={500}
              disabled={disabled}
              hint={`${draftPage.bio.length}/500 characters. A sentence or two under the headline.`}
              onChange={(event) => patchPage({ bio: event.currentTarget.value })}
            />
          </div>
        </Panel>

        <Panel eyebrow="02 · Composition" title="Theme, layout & accent">
          <div className="space-y-5">
            <div className="grid gap-5 sm:grid-cols-2">
              <SelectField
                label="Theme"
                value={draftPage.theme}
                disabled={disabled}
                options={[{ value: 'light', label: 'Light paper' }, { value: 'dark', label: 'Dark ink' }]}
                onChange={(event) => patchPage({ theme: event.currentTarget.value === 'dark' ? 'dark' : 'light' })}
              />
              <SelectField
                label="Link layout"
                value={draftPage.layout}
                disabled={disabled}
                options={[{ value: 'list', label: 'Editorial list' }, { value: 'grid', label: 'Compact grid' }]}
                onChange={(event) => patchPage({ layout: event.currentTarget.value === 'grid' ? 'grid' : 'list' })}
              />
            </div>

            <div className="flex items-end gap-3">
              <div className="flex-1">
                <Field
                  label="Accent colour"
                  value={draftPage.accentColor}
                  maxLength={7}
                  disabled={disabled}
                  placeholder="#111111"
                  hint="Optional #rrggbb. Used as a restrained highlight, not a repaint."
                  onChange={(event) => patchPage({ accentColor: event.currentTarget.value })}
                />
              </div>
              <span
                aria-hidden="true"
                className="mb-1 h-11 w-11 shrink-0 border border-rule"
                style={{ background: /^#[0-9a-fA-F]{6}$/.test(draftPage.accentColor) ? draftPage.accentColor : 'transparent' }}
              />
            </div>

            <CheckboxField
              label="Show the OneLink credit"
              checked={draftPage.showBranding}
              disabled={disabled}
              hint="A small platform credit appears at the foot of your public page."
              onChange={(event) => patchPage({ showBranding: event.currentTarget.checked })}
            />
          </div>
        </Panel>
      </div>

      <Panel
        eyebrow="03 · Beyond this release"
        title="Not saved yet"
        description="These controls appear in the design mockup but have no backing field in the current API, so they are shown disabled rather than pretending to work."
      >
        <Notice tone="info" label="Not saved yet" className="mb-6">
          Nothing in this section is stored or applied. It is a preview of a later release.
        </Notice>
        <div className="grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
          <PendingControl label="Corner radius">
            <input type="range" min={0} max={24} defaultValue={8} className="w-full accent-black" disabled />
          </PendingControl>
          <PendingControl label="Typeface">
            <select className="w-full border-b border-rule bg-transparent py-2 text-lg" disabled>
              <option>Fraunces (current)</option>
            </select>
          </PendingControl>
          <PendingControl label="Button style">
            <select className="w-full border-b border-rule bg-transparent py-2 text-lg" disabled>
              <option>Editorial</option>
            </select>
          </PendingControl>
          <PendingControl label="Background">
            <input type="color" defaultValue="#ffffff" className="h-10 w-full border border-rule bg-transparent p-1" disabled />
          </PendingControl>
          <PendingControl label="Custom CSS" hint="Custom CSS is deliberately not planned (stored-XSS risk on a single origin).">
            <textarea rows={3} className="w-full border border-rule bg-transparent p-2 text-sm" disabled />
          </PendingControl>
        </div>
      </Panel>
    </div>
  )
}
