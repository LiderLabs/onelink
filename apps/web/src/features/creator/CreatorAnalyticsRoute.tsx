import { useEffect, useId, useMemo, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import { ArrowUpRight, CalendarBlank, ChartLineUp, CursorClick, Desktop, DeviceMobile, DeviceTablet, DownloadSimple, Eye, GlobeHemisphereWest, Info, InstagramLogo, Link as LinkIcon, Users, X } from '@phosphor-icons/react'
import { buildSampleAnalytics, dateOnly, dayCount, sampleCsv, shiftDate } from './analytics-data'
import type { SampleAnalytics, SampleDay, SampleLink } from './analytics-data'
import './creator-analytics.css'

type Range = '7' | '30' | '90' | 'custom'
const dateLabel = (date: string, long = false) => new Date(`${date}T00:00:00Z`).toLocaleDateString(undefined, { month: long ? 'long' : 'short', day: 'numeric', ...(long ? { year: 'numeric' } : {}), timeZone: 'UTC' })
const number = (value: number) => value.toLocaleString()

export function CreatorAnalyticsRoute() {
  const today = useMemo(() => dateOnly(new Date()), [])
  const [sample, setSample] = useState(false)
  const [range, setRange] = useState<Range>('30')
  const [dates, setDates] = useState({ start: shiftDate(today, -29), end: today })
  const [customOpen, setCustomOpen] = useState(false)
  const [customStart, setCustomStart] = useState(dates.start)
  const [customEnd, setCustomEnd] = useState(dates.end)
  const [rangeError, setRangeError] = useState('')
  const [selectedLink, setSelectedLink] = useState<SampleLink | null>(null)
  const [exportStatus, setExportStatus] = useState('')
  const dialogRef = useRef<HTMLDialogElement>(null)
  const data = useMemo(() => buildSampleAnalytics(dates.start, dates.end), [dates])

  useEffect(() => { document.title = 'Analytics · OneLink' }, [])
  useEffect(() => {
    if (selectedLink) dialogRef.current?.showModal()
    else dialogRef.current?.close()
  }, [selectedLink])

  function chooseRange(next: '7' | '30' | '90') {
    setRange(next); setDates({ start: shiftDate(today, 1 - Number(next)), end: today })
    setCustomOpen(false); setRangeError(''); setExportStatus('')
  }
  function applyRange() {
    if (!customStart || !customEnd) { setRangeError('Choose both a start and an end date.'); return }
    if (customStart > customEnd) { setRangeError('Start date must be on or before the end date.'); return }
    if (customEnd > today) { setRangeError('End date cannot be in the future.'); return }
    if (!Number.isFinite(dayCount(customStart, customEnd)) || dayCount(customStart, customEnd) > 366) { setRangeError('Choose a range of 366 days or fewer.'); return }
    setDates({ start: customStart, end: customEnd }); setRange('custom'); setRangeError(''); setCustomOpen(false); setExportStatus('')
  }
  function exportCsv() {
    if (!sample) return
    const url = URL.createObjectURL(new Blob([sampleCsv(data)], { type: 'text/csv;charset=utf-8' }))
    const anchor = document.createElement('a')
    anchor.href = url; anchor.download = `onelink-fictional-sample-${dates.start}-${dates.end}.csv`
    document.body.appendChild(anchor); anchor.click(); anchor.remove()
    window.setTimeout(() => URL.revokeObjectURL(url), 1000)
    setExportStatus('Fictional sample CSV downloaded.')
  }
  const period = `${dateLabel(dates.start)} – ${dateLabel(dates.end, true)}`
  const metrics = [
    { title: 'Page views', value: number(data.views), icon: Eye, note: 'Times the sample page was viewed' },
    { title: 'Link clicks', value: number(data.clicks), icon: CursorClick, note: 'Clicks on the sample links' },
    { title: 'Click-through rate', value: `${data.ctr}%`, icon: ChartLineUp, note: 'Sample clicks divided by views' },
    { title: 'Unique visitors', value: number(data.unique), icon: Users, note: 'Illustrative distinct visitors' },
  ]
  return <div className="creator-analytics">
    <header className="creator-heading"><div><p className="creator-eyebrow">Analytics</p><h1>Understand your audience.</h1><p>Discover where your visitors come from and what catches their attention.</p></div><div className="creator-actions"><Link to="/app/links" className="creator-button"><LinkIcon size={17} />Manage links</Link><button className="creator-button creator-button-primary" disabled={!sample} aria-describedby="analytics-export-reason" onClick={exportCsv}><DownloadSimple size={17} />Export CSV</button></div></header>
    <div className="analytics-toolbar"><div className="analytics-range" role="group" aria-label="Analytics date range"><CalendarBlank size={17} aria-hidden="true" />{(['7', '30', '90'] as const).map(value => <button key={value} aria-pressed={range === value} onClick={() => chooseRange(value)}>{value} days</button>)}<button aria-pressed={range === 'custom' || customOpen} onClick={() => { setCustomOpen(value => !value); setRangeError('') }}>Custom</button></div><div className="analytics-data-switch" role="group" aria-label="Analytics dataset"><button aria-pressed={!sample} onClick={() => { setSample(false); setSelectedLink(null); setExportStatus('') }}>Your data</button><button aria-pressed={sample} onClick={() => { setSample(true); setExportStatus('') }}>Sample data</button></div></div>
    {customOpen && <form className="analytics-custom creator-card" onSubmit={event => { event.preventDefault(); applyRange() }} noValidate><div className="creator-field"><label htmlFor="analytics-start">Start date</label><input id="analytics-start" type="date" max={today} value={customStart} onChange={event => setCustomStart(event.target.value)} /></div><div className="creator-field"><label htmlFor="analytics-end">End date</label><input id="analytics-end" type="date" max={today} value={customEnd} onChange={event => setCustomEnd(event.target.value)} /></div><button className="creator-button creator-button-subtle" type="submit">Apply range</button>{rangeError && <p className="analytics-range-error" role="alert">{rangeError}</p>}</form>}
    <div className={`analytics-dataset-notice creator-notice ${sample ? 'is-sample' : ''}`}><Info size={19} aria-hidden="true" /><div><strong>{sample ? 'Fictional sample data for illustration' : 'Visitor tracking is not available'}</strong><p>{sample ? 'Explore an example workspace. These numbers are made up and do not represent your page or visitors.' : 'OneLink does not collect page views, link clicks, referral sources, countries, or device data yet. Your metrics are unavailable.'}</p></div>{!sample && <button className="creator-text-link" onClick={() => setSample(true)}>Explore sample data<ArrowUpRight size={14} /></button>}</div>
    <div className="analytics-period"><span>{period}</span><span className="analytics-dataset-label">{sample ? 'Fictional sample dataset' : 'Your data · not collected'}</span></div>
    <section className="creator-metrics analytics-metrics" aria-label="Analytics metrics">{metrics.map(metric => <div className="creator-card" key={metric.title} role="group" aria-label={metric.title}><div className="creator-metric-top"><span>{metric.title}</span><metric.icon size={20} weight="light" aria-hidden="true" /></div><p className="creator-metric-value">{sample ? metric.value : '—'}</p><p className="creator-metric-note">{sample ? metric.note : 'Not collected'}</p>{sample && <span className="analytics-metric-sample">Sample</span>}</div>)}</section>
    <div className="analytics-activity-grid"><section className="creator-card analytics-chart-card"><div className="creator-card-heading"><div><h2>Views &amp; clicks over time</h2><p>{sample ? 'Daily activity in the fictional sample workspace.' : 'Visitor activity will appear when tracking is available.'}</p></div>{sample && <div className="analytics-chart-legend"><span><i className="analytics-dot" />Views</span><span><i className="analytics-dot analytics-dot-clicks" />Clicks</span></div>}</div>{sample ? <ActivityChart data={data} /> : <UnavailableChart />}</section><section className="creator-card analytics-insights"><div className="creator-card-heading"><h2>Quick insights</h2><ChartLineUp size={19} className="creator-accent" aria-hidden="true" /></div>{sample ? <><p className="analytics-section-label">From the fictional sample</p><Insight icon={CursorClick} title="Every click counts" text={`Around ${data.ctr}% of sample page views lead to a link click.`} /><Insight icon={GlobeHemisphereWest} title="Direct traffic leads" text="44% of sample views come directly to the page." /><Insight icon={DeviceMobile} title="Made for mobile" text="68% of sample views come from mobile devices." /></> : <div className="analytics-empty-insights"><ChartLineUp size={31} weight="light" /><h3>No insights available yet</h3><p>Insights need collected visitor events. Explore the sample to see how they could look.</p><button className="creator-button creator-button-subtle" onClick={() => setSample(true)}>View sample insights<ArrowUpRight size={15} /></button></div>}</section></div>
    <div className="analytics-breakdowns"><Breakdown title="Traffic sources" description="Where sample views originate" sample={sample} rows={[{ label: 'Direct', percent: 44, icon: LinkIcon }, { label: 'Instagram', percent: 30, icon: InstagramLogo }, { label: 'Google', percent: 18, icon: GlobeHemisphereWest }, { label: 'Other', percent: 8, icon: GlobeHemisphereWest }]} /><Breakdown title="Top countries" description="Share of sample page views" sample={sample} rows={[{ label: 'Ghana', percent: 41, flag: '🇬🇭' }, { label: 'Nigeria', percent: 27, flag: '🇳🇬' }, { label: 'United States', percent: 19, flag: '🇺🇸' }, { label: 'United Kingdom', percent: 13, flag: '🇬🇧' }]} /><section className="creator-card analytics-devices"><div className="creator-card-heading"><div><h2>Devices</h2><p>{sample ? 'How sample visitors browse' : 'Device information is not collected.'}</p></div></div>{sample ? <><div className="analytics-device-donut" role="img" aria-label="Fictional sample views: mobile 68%, desktop 25%, tablet 7%"><svg viewBox="0 0 130 130" aria-hidden="true"><circle cx="65" cy="65" r="49" className="analytics-ring-bg" />{[{ value: 68, offset: 0, color: '#00d8ef' }, { value: 25, offset: 68, color: '#8c82ff' }, { value: 7, offset: 93, color: '#586174' }].map(part => <circle key={part.offset} cx="65" cy="65" r="49" pathLength="100" fill="none" stroke={part.color} strokeWidth="13" strokeDasharray={`${part.value - 1} ${101 - part.value}`} strokeDashoffset={-part.offset} transform="rotate(-90 65 65)" />)}</svg><div><DeviceMobile size={22} /><strong>68%</strong><span>Mobile</span></div></div><ul className="analytics-device-list">{[{ name: 'Mobile', percent: 68, icon: DeviceMobile }, { name: 'Desktop', percent: 25, icon: Desktop }, { name: 'Tablet', percent: 7, icon: DeviceTablet }].map((device, index) => <li key={device.name}><span><i className={`analytics-dot analytics-device-${index}`} /><device.icon size={15} aria-hidden="true" />{device.name}</span><strong>{device.percent}%</strong></li>)}</ul><p className="analytics-section-label">Fictional sample data</p></> : <UnavailableBreakdown label="Device breakdown" />}</section></div>
    <section className="creator-card analytics-top-links"><div className="creator-card-heading"><div><h2>Top performing links</h2><p>{sample ? 'Your most-clicked destinations in the fictional sample.' : 'Link performance requires collected click events.'}</p></div>{sample ? <span className="creator-badge">Fictional sample</span> : <Link className="creator-text-link" to="/app/links">Manage your links<ArrowUpRight size={14} /></Link>}</div>{sample ? <><div className="analytics-table-scroll"><table><caption className="sr-only">Fictional sample link performance for {period}</caption><thead><tr><th scope="col">Link</th><th scope="col">Clicks</th><th scope="col">Share of clicks</th><th scope="col"><span className="sr-only">Inspect sample performance</span></th></tr></thead><tbody>{data.links.map((link, index) => <tr key={link.title}><td><div className="analytics-link-cell"><span className="analytics-link-rank">{String(index + 1).padStart(2, '0')}</span><span className="analytics-link-icon"><LinkIcon size={17} /></span><span><strong>{link.title}</strong><small>{link.domain}</small></span></div></td><td className="analytics-click-count">{number(link.clicks)}</td><td><div className="analytics-link-share"><span className="analytics-bar"><i style={{ width: `${link.share}%` }} /></span><span>{link.share.toFixed(1)}%</span></div></td><td><button className="creator-icon-button" aria-label={`Inspect ${link.title} sample performance`} onClick={() => setSelectedLink(link)}><ArrowUpRight size={16} /></button></td></tr>)}</tbody></table></div><p className="analytics-table-note">Select a link’s arrow to inspect its sample performance. Example destinations are fictional.</p></> : <div className="analytics-links-unavailable"><CursorClick size={30} weight="light" /><div><h3>No link performance available</h3><p>Your links can still be managed. Click counts and rankings are not collected yet.</p></div><button className="creator-text-link" onClick={() => setSample(true)}>Explore sample links<ArrowUpRight size={14} /></button></div>}</section>
    <footer className="analytics-footer"><p id="analytics-export-reason">{sample ? 'CSV exports contain fictional sample data only.' : 'CSV export is unavailable because visitor tracking is unavailable.'}</p><p role="status">{exportStatus}</p></footer>
    <dialog ref={dialogRef} className="analytics-link-dialog" aria-labelledby="analytics-link-dialog-title" onCancel={() => setSelectedLink(null)} onClose={() => setSelectedLink(null)}>{selectedLink && <><div className="creator-card-heading"><div><p className="creator-eyebrow">Fictional sample</p><h2 id="analytics-link-dialog-title">{selectedLink.title} — sample performance</h2></div><button className="creator-icon-button" aria-label="Close sample performance" onClick={() => setSelectedLink(null)}><X size={19} /></button></div><p className="analytics-dialog-domain">{selectedLink.domain}</p><p className="analytics-dialog-count">{number(selectedLink.clicks)} <span>sample clicks</span></p><p className="analytics-dialog-note">{selectedLink.share.toFixed(1)}% of all sample link clicks · {period}</p><div className="creator-notice"><Info size={18} /><p>This is an illustrative destination and fictional data. It is not a link from your page.</p></div></>}</dialog>
  </div>
}

function Insight({ icon: Icon, title, text }: { icon: typeof CursorClick; title: string; text: string }) {
  return <div className="analytics-insight"><span><Icon size={18} /></span><div><h3>{title}</h3><p>{text}</p></div></div>
}

function ActivityChart({ data }: { data: SampleAnalytics }) {
  const id = useId().replace(/:/g, '')
  const [inspected, setInspected] = useState<SampleDay | null>(null)
  useEffect(() => { setInspected(null) }, [data])
  const width = 760, height = 235, left = 40, right = 14, top = 14, bottom = 30
  const plotWidth = width - left - right, plotHeight = height - top - bottom
  const max = Math.max(...data.days.map(day => day.views), ...data.days.map(day => day.clicks))
  const ceiling = Math.max(10, Math.ceil(max / 10) * 10)
  const x = (index: number) => left + (data.days.length === 1 ? plotWidth / 2 : index / (data.days.length - 1) * plotWidth)
  const y = (value: number) => top + plotHeight - value / ceiling * plotHeight
  const hitRegion = (index: number) => {
    const span = plotWidth / Math.max(data.days.length - 1, 1)
    const start = data.days.length === 1 ? left : Math.max(left, x(index) - span / 2)
    const end = data.days.length === 1 ? width - right : Math.min(width - right, x(index) + span / 2)
    return { x: start, width: end - start }
  }
  const line = (key: 'views' | 'clicks') => data.days.map((day, index) => `${index ? 'L' : 'M'}${x(index)},${y(day[key])}`).join(' ')
  const area = `${line('views')} L${x(data.days.length - 1)},${top + plotHeight} L${x(0)},${top + plotHeight} Z`
  const labelIndices = Array.from(new Set([0, Math.round((data.days.length - 1) / 3), Math.round((data.days.length - 1) * 2 / 3), data.days.length - 1]))
  const inspectedIndex = inspected ? data.days.indexOf(inspected) : -1
  return <div className="analytics-chart"><div className="analytics-chart-detail" role="status" aria-label="Daily sample detail">{inspected ? <><strong>{dateLabel(inspected.date, true)}</strong><span><i className="analytics-dot" />{inspected.views} views</span><span><i className="analytics-dot analytics-dot-clicks" />{inspected.clicks} clicks</span></> : <span>Hover or focus a day to inspect sample views and clicks.</span>}</div><svg viewBox={`0 0 ${width} ${height}`} aria-label="Daily views and clicks in the fictional sample dataset"><defs><linearGradient id={`views-${id}`} x1="0" x2="0" y1="0" y2="1"><stop offset="0%" stopColor="#00d8ef" stopOpacity=".19" /><stop offset="100%" stopColor="#00d8ef" stopOpacity=".01" /></linearGradient></defs>{[0, 1, 2, 3, 4].map(tick => { const value = ceiling * tick / 4; return <g key={tick}><line x1={left} x2={width - right} y1={y(value)} y2={y(value)} className="analytics-grid-line" /><text x={left - 11} y={y(value) + 4} textAnchor="end">{Math.round(value)}</text></g> })}<path d={area} fill={`url(#views-${id})`} /><path d={line('views')} className="analytics-line-views" /><path d={line('clicks')} className="analytics-line-clicks" />{labelIndices.map(index => <text key={index} x={x(index)} y={height - 5} textAnchor={index === 0 ? 'start' : index === data.days.length - 1 ? 'end' : 'middle'}>{dateLabel(data.days[index]!.date)}</text>)}{inspectedIndex >= 0 && <g aria-hidden="true"><line x1={x(inspectedIndex)} x2={x(inspectedIndex)} y1={top} y2={top + plotHeight} className="analytics-inspection-line" /><circle cx={x(inspectedIndex)} cy={y(inspected!.views)} r="4" fill="#00d8ef" /><circle cx={x(inspectedIndex)} cy={y(inspected!.clicks)} r="4" fill="#a69cff" /></g>}{data.days.map((day, index) => <g key={day.date} role="button" tabIndex={0} aria-label={`Inspect sample day ${dateLabel(day.date, true)}: ${day.views} views, ${day.clicks} clicks`} onMouseEnter={() => setInspected(day)} onFocus={() => setInspected(day)} onClick={() => setInspected(day)} onKeyDown={event => { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); setInspected(day) } }}><rect {...hitRegion(index)} y={top} height={plotHeight} fill="transparent" /><circle className="analytics-focus-point" cx={x(index)} cy={y(day.views)} r="6" /></g>)}</svg><p className="analytics-section-label">Fictional sample · {data.days.length} {data.days.length === 1 ? 'day' : 'days'} · keyboard accessible daily detail</p></div>
}

function UnavailableChart() {
  return <div className="analytics-chart-unavailable"><div className="analytics-empty-grid" aria-hidden="true" /><div><ChartLineUp size={32} weight="light" /><h3>Your audience story starts here</h3><p>Views and clicks are not collected yet.<br />Choose Sample data to explore an illustrative chart.</p></div><span className="analytics-section-label">Tracking unavailable · no events collected</span></div>
}

type BreakdownRow = { label: string; percent: number; icon?: typeof LinkIcon; flag?: string }
function Breakdown({ title, description, sample, rows }: { title: string; description: string; sample: boolean; rows: BreakdownRow[] }) {
  return <section className="creator-card analytics-breakdown"><div className="creator-card-heading"><div><h2>{title}</h2><p>{sample ? description : 'Visitor information is not collected.'}</p></div></div>{sample ? <><ul>{rows.map(row => <li key={row.label}><div><span>{row.icon ? <row.icon size={16} aria-hidden="true" /> : <span className="analytics-country-flag" aria-hidden="true">{row.flag}</span>}{row.label}</span><strong>{row.percent}%</strong></div><span className="analytics-bar"><i style={{ width: `${row.percent}%` }} /></span></li>)}</ul><p className="analytics-section-label">Fictional sample · share of views</p></> : <UnavailableBreakdown label={title} />}</section>
}
function UnavailableBreakdown({ label }: { label: string }) {
  return <div className="analytics-breakdown-unavailable"><GlobeHemisphereWest size={27} weight="light" /><p>{label} is unavailable.</p><span>Requires visitor tracking</span></div>
}

