export type SampleDay = { date: string; views: number; clicks: number }
export type SampleLink = { title: string; domain: string; clicks: number; share: number }
export type SampleAnalytics = {
  days: SampleDay[]
  views: number
  clicks: number
  unique: number
  ctr: string
  links: SampleLink[]
}

export function dateOnly(date: Date) { return date.toISOString().slice(0, 10) }

export function shiftDate(date: string, offset: number) {
  const value = new Date(`${date}T00:00:00Z`)
  value.setUTCDate(value.getUTCDate() + offset)
  return dateOnly(value)
}

export function dayCount(start: string, end: string) {
  return Math.round((Date.parse(`${end}T00:00:00Z`) - Date.parse(`${start}T00:00:00Z`)) / 86_400_000) + 1
}

function distribute(total: number, weights: number[]) {
  const sum = weights.reduce((value, weight) => value + weight, 0)
  const exact = weights.map(weight => weight / sum * total)
  const values = exact.map(Math.floor)
  const remainder = total - values.reduce((value, part) => value + part, 0)
  const order = exact.map((value, index) => ({ index, fraction: value - values[index]! })).sort((a, b) => b.fraction - a.fraction)
  for (let index = 0; index < remainder; index++) {
    const target = order[index]!.index
    values[target] = values[target]! + 1
  }
  return values
}

// Fictional, local illustration. These values never represent a creator's events.
export function buildSampleAnalytics(start: string, end: string): SampleAnalytics {
  const count = dayCount(start, end)
  const dates = Array.from({ length: count }, (_, index) => shiftDate(start, index))
  const viewWeights = dates.map((date, index) => 18 + (index % 7) * 1.7 + Math.sin(index * .85) * 8 + (Number(date.slice(-2)) % 6) * 2)
  const clickWeights = dates.map((date, index) => 6 + Math.sin(index * .7 + 1) * 3 + (Number(date.slice(-2)) % 4))
  const views = Math.round(744 * count / 30)
  const clicks = Math.round(234 * count / 30)
  const dailyViews = distribute(views, viewWeights)
  const dailyClicks = distribute(clicks, clickWeights)
  const titles = [
    { title: 'My Portfolio', domain: 'portfolio.example' },
    { title: 'YouTube Channel', domain: 'youtube.example' },
    { title: 'Latest Projects', domain: 'projects.example' },
    { title: 'Book a Session', domain: 'booking.example' },
    { title: 'Instagram', domain: 'instagram.example' },
  ]
  const linkClicks = distribute(clicks, [91, 60, 39, 28, 16])
  return {
    days: dates.map((date, index) => ({ date, views: dailyViews[index]!, clicks: dailyClicks[index]! })),
    views, clicks, unique: Math.round(567 * count / 30), ctr: (clicks / views * 100).toFixed(1),
    links: titles.map((link, index) => ({ ...link, clicks: linkClicks[index]!, share: linkClicks[index]! / clicks * 100 })),
  }
}

export function sampleCsv(data: SampleAnalytics) {
  return [
    'dataset,date,page_views,link_clicks',
    ...data.days.map(day => `Fictional sample data,${day.date},${day.views},${day.clicks}`),
  ].join('\r\n')
}
