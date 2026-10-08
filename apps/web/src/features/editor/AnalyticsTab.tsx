import { PageHeader } from '../../components/PageHeader'
import { Panel } from '../../components/Panel'
import { Icon } from '../../components/Icon'
import type { IconName } from '../../components/Icon'
import { useEditor } from './context'

// ============================================================================
// The Analytics tab.
//
// The API stores a `view_count` on a page and a `clicks` count on a link, but
// nothing increments them and there is no events endpoint, so there are no real
// numbers to show. The wireframe is full of KPIs, charts and breakdowns; the
// honest version of that screen says so plainly rather than inventing figures.
//
// This is the same stance the old `/app/analytics` screen took — a screen that
// fabricates a "+4.2%" is worse than one that says "not collected yet".
// ============================================================================

const METRICS: Array<{ label: string; icon: IconName }> = [
  { label: 'Page views', icon: 'eye' },
  { label: 'Link clicks', icon: 'links' },
  { label: 'Click-through rate', icon: 'analytics' },
  { label: 'Unique visitors', icon: 'users' },
]

const REPORTS: Array<{ title: string; description: string }> = [
  { title: 'Views & clicks over time', description: 'A time-series chart appears once PageLink records events.' },
  { title: 'Top links & referrers', description: 'Link rankings and referral sources need click and referrer events, which are not recorded.' },
  { title: 'Countries & devices', description: 'Visitor location and device breakdowns are not collected or inferred.' },
  { title: 'Export', description: 'There is no analytics dataset to export in this release.' },
]

export function AnalyticsTab() {
  const { page } = useEditor()

  return (
    <div className="space-y-7">
      <PageHeader
        eyebrow="A later release"
        title="Analytics"
        description={`Performance for /${page.slug}. OneLink does not currently record page views, link clicks, referrers, or visitor details, so it cannot show trustworthy metrics yet.`}
      />

      <div role="status" className="border-l-2 border-ink bg-paper-deep/60 py-3 pl-4 pr-3">
        <p className="eyebrow text-ink">Not collected in this release</p>
        <p className="mt-1 text-sm leading-relaxed text-ink-soft">
          No tracking has been enabled. Nothing here is estimated or filled with sample data.
        </p>
      </div>

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        {METRICS.map((metric, index) => (
          <Panel key={metric.label} delay={index} className="p-4">
            <div className="flex items-center justify-between text-ink-faint">
              <p className="eyebrow text-ink-soft">{metric.label}</p>
              <Icon name={metric.icon} size={18} />
            </div>
            <p className="mt-3 font-display text-xl text-ink-faint">Not collected</p>
          </Panel>
        ))}
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        {REPORTS.map((report, index) => (
          <Panel key={report.title} title={report.title} delay={index} className="min-h-32">
            <p className="text-sm leading-relaxed text-ink-soft">{report.description}</p>
          </Panel>
        ))}
      </div>
    </div>
  )
}
