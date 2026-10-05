import type { Candidate, FetchText, SourceResult } from '../types.ts'
import { cancelled, category, deduplicate, iso, list, record, string, text, url } from './shared.ts'

const FEED = 'https://api.vibemap.com/v0.3/search/events'
const LISTING = 'https://downtownevanston.org/upcoming-events'

function datetime(value: unknown, timezone: unknown): string {
  const raw = string(value)
  if (/(?:Z|[+-]\d\d:\d\d)$/.test(raw)) return iso(raw)
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}$/.test(raw) || !string(timezone)) throw new Error(`Downtown: invalid local time ${raw}`)
  const local = Date.parse(raw + 'Z')
  const formatter = new Intl.DateTimeFormat('sv-SE', { timeZone: string(timezone), year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23' })
  const offset = new Intl.DateTimeFormat('en', { timeZone: string(timezone), timeZoneName: 'longOffset' })
  const candidates = new Set<number>()
  for (const day of [-1, 0, 1]) {
    const zone = offset.formatToParts(local + day * 86_400_000).find(part => part.type === 'timeZoneName')!.value
    const match = /^GMT(?:([+-])(\d{2}):(\d{2}))?$/.exec(zone)
    if (!match) throw new Error(`Downtown: invalid timezone ${timezone}`)
    const minutes = match[1] ? (Number(match[2]) * 60 + Number(match[3])) * (match[1] === '-' ? -1 : 1) : 0
    const instant = local - minutes * 60_000
    if (formatter.format(instant).replace(' ', 'T') === raw) candidates.add(instant)
  }
  if (candidates.size !== 1) throw new Error(`Downtown: ambiguous or nonexistent local time ${raw}`)
  return new Date([...candidates][0]!).toISOString()
}

export async function fetchDowntownEvanston(fetchText: FetchText, now = new Date()): Promise<SourceResult> {
  const items: Candidate[] = []
  const warnings = new Set<string>()
  // Public embed: 1.8 miles around Downtown Evanston; the API expands recurrences itself.
  const params = new URLSearchParams({ location__geo_distance: '2897m__42.04709002439793__-87.67971471096162', end_date__gte: now.toISOString().slice(0, 10) + 'T00:00:00', start_date__lte: new Date(now.getTime() + 180 * 86_400_000).toISOString().slice(0, 10) + 'T23:59:59', page_size: '100', ordering: 'start_date', is_approved: 'true' })
  for (let page = 1; ; page++) {
    if (page > 100) throw new Error('Downtown: pagination exceeded limit')
    params.set('page', String(page))
    const data = record(JSON.parse(await fetchText(`${FEED}?${params}`)))
    const features = record(data.results).features
    if (!Array.isArray(features) || !Number.isInteger(data.count) || Number(data.count) < 0) throw new Error('Downtown: invalid event collection')
    for (const raw of features) {
      const feature = record(raw)
      const event = record(feature.properties)
      const id = string(feature.id)
      const title = text(event.name)
      if (!/^[a-zA-Z0-9-]+$/.test(id) || !title) throw new Error('Downtown: missing event identity/title')
      if (event.recurs === true && event.is_recurring_occurrence !== true) throw new Error(`Downtown ${id}: unexpanded recurrence`)
      const start = datetime(event.start_date, event.timezone)
      const end = event.end_date ? datetime(event.end_date, event.timezone) : null
      if (end && end < start) throw new Error(`Downtown ${id}: end precedes start`)
      if (event.is_flagged === true) warnings.add(`Downtown ${id}: source flagged ${text(event.flag_reason) || 'data quality'}`)
      if (event.occurrences_truncated === true) warnings.add(`Downtown ${id}: source reports truncated recurrence; only returned occurrences imported`)
      const fee = text(event.price_display)
      const related = url(event.data_source_url || event.url)
      // ponytail: recurring API rows have no occurrence ID; a moved recurring instance gets a new key until Vibemap supplies one.
      const externalId = event.is_recurring_occurrence === true ? `${id}:${string(event.start_date)}` : id
      items.push({ external_id: externalId, related_url: related, listing_url: LISTING, data: {
        title, description: text(event.description) || null,
        cover_image_url: url(record(list(event.vibemap_images)[0]).original),
        start_time: start, end_time: end, location: [text(event.hotspots_place), text(event.address)].filter(Boolean).join(', ') || null,
        location_url: null,
        // Vibemap's numeric zero and free flags can be defaults; require an explicit admission label too.
        is_free: event.is_free === true && /^free$/i.test(fee), fee_text: fee || null,
        category: category(list(event.categories).concat(list(event.tags)).map(string).join(' ')),
        is_cancelled: /^cancel(?:l)?ed$/i.test(string(event.event_status)) || cancelled(title, string(event.description)),
        is_all_day: event.is_all_day === true, source_url: `https://app.vibemap.com/events/${id}`,
      } })
    }
    if (!data.next) {
      if (deduplicate(items).length !== Number(data.count)) throw new Error('Downtown: incomplete pagination or duplicate occurrences')
      break
    }
    const next = new URL(string(data.next), FEED)
    if (next.origin !== new URL(FEED).origin || next.pathname.replace(/\/$/, '') !== new URL(FEED).pathname || !features.length) throw new Error('Downtown: invalid pagination')
  }
  return { items: deduplicate(items), warnings: [...warnings] }
}
