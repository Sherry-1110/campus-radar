import type { FetchText, SourceResult } from '../types.ts'
import { cancelled, category, deduplicate, iso, list, record, string, text, url } from './shared.ts'

const WIDGET = 'https://evanstonspace.com/s/event-feed-widget.js'
const LEGACY = 'https://static2.16oncenterchicago.com/eventbrite/v2/json/space.js'

export function parseSpace(json: string): SourceResult {
  const feed = record(JSON.parse(json)), page = record(feed.page)
  if (!Number.isInteger(page.totalElements) || !Number.isInteger(page.totalPages) || !Number.isInteger(page.number)) throw new Error('SPACE: missing pagination metadata')
  const events = record(feed._embedded).events
  if (!Array.isArray(events) && page.totalElements !== 0) throw new Error('SPACE: missing events')
  const result: SourceResult = { items: [], warnings: [] }
  for (const raw of list(events)) {
    const e = record(raw), dates = record(e.dates), start = record(dates.start)
    const id = string(e.id), title = text(e.name), source = url(e.url)
    if (!id || !title || !source) throw new Error('SPACE: incomplete event identity')
    if (e.test === true) continue
    if (start.dateTBD === true || start.dateTBA === true || start.timeTBA === true || start.noSpecificTime === true) {
      result.warnings.push(`SPACE ${id}: date/time unannounced; occurrence skipped`)
      continue
    }
    const venue = record(list(record(e._embedded).venues)[0])
    const location = [text(venue.name), text(record(venue.address).line1), text(record(venue.city).name)].filter(Boolean).join(', ') || null
    const images = list(e.images).map(record).filter(i => i.fallback !== true).sort((a, b) => Number(b.width) - Number(a.width))
    const prices = list(e.priceRanges).map(record)
    const fee = prices.map(p => `${string(p.currency)} ${string(p.min)}${p.max !== p.min ? `–${string(p.max)}` : ''}`.trim()).join('; ') || null
    result.items.push({ external_id: `tm:${id}`, listing_url: 'https://evanstonspace.com/all-shows', related_url: source, data: {
      title, source_url: source, start_time: iso(start.dateTime), end_time: record(dates.end).dateTime ? iso(record(dates.end).dateTime) : null,
      description: [text(e.info), text(e.pleaseNote)].filter(Boolean).join('\n\n') || null,
      cover_image_url: url(images[0]?.url), location, location_url: null,
      is_free: prices.length > 0 && prices.every(p => p.min === 0 && p.max === 0), fee_text: fee,
      category: category(list(e.classifications).map(c => text(record(record(c).segment).name)).join(' ')),
      is_cancelled: record(dates.status).code === 'cancelled' || cancelled(title), is_all_day: false,
    } })
  }
  result.items = deduplicate(result.items)
  return result
}

export async function fetchSpace(fetchText: FetchText): Promise<SourceResult> {
  const script = await fetchText(WIDGET)
  // Read public widget configuration as text; never execute downloaded JavaScript or store its API key in source.
  const branch = /if\s*\(venue === ['"]space['"]\)\s*\{([\s\S]*?)\}\s*else/.exec(script)?.[1]
  const endpoints = [...(branch || '').matchAll(/tmUrl2?\s*=\s*['"]([^'"]+)['"]/g)].map(m => new URL(m[1]!))
  if (endpoints.length !== 2 || endpoints.some(u => u.origin !== 'https://app.ticketmaster.com' || u.pathname !== '/discovery/v2/events.json')) throw new Error('SPACE: public widget feed configuration changed')
  const result: SourceResult = { items: [], warnings: [] }
  for (const endpoint of endpoints) {
    endpoint.searchParams.set('size', '200')
    let totalPages = 1, totalElements = -1, read = 0
    const ids = new Set<string>()
    for (let number = 0; number < totalPages; number++) {
      if (number >= 5) throw new Error('SPACE: Ticketmaster pagination exceeds its 1000-event accessible window')
      endpoint.searchParams.set('page', String(number))
      const body = await fetchText(endpoint.href)
      const page = record(record(JSON.parse(body)).page)
      const parsed = parseSpace(body)
      if (page.number !== number || (number > 0 && (page.totalElements !== totalElements || page.totalPages !== totalPages))) throw new Error('SPACE: inconsistent pagination')
      totalPages = Number(page.totalPages)
      totalElements = Number(page.totalElements)
      const rows = list(record(record(JSON.parse(body))._embedded).events)
      read += rows.length
      for (const row of rows) ids.add(string(record(row).id))
      result.items.push(...parsed.items)
      result.warnings.push(...parsed.warnings)
    }
    if (read !== totalElements || ids.size !== read) throw new Error('SPACE: incomplete or repeated pagination')
  }
  const legacy = await fetchText(LEGACY)
  const assignment = /^\s*window\.apiEvents\s*=\s*(\[[\s\S]*\])\s*;?\s*$/.exec(legacy)
  if (!assignment) throw new Error('SPACE: invalid legacy event feed')
  const old: unknown = JSON.parse(assignment[1]!)
  if (!Array.isArray(old)) throw new Error('SPACE: invalid legacy event array')
  for (const raw of old) {
    const e = record(raw), id = string(e.id), title = text(record(e.name).html || record(e.name).text)
    if (!id || !title) throw new Error('SPACE: incomplete legacy event identity')
    const source = url(e.url) || `https://www.eventbrite.com/e/${id}`
    result.items.push({ external_id: `eb:${id}`, listing_url: 'https://evanstonspace.com/all-shows', related_url: source, data: {
      title, description: text(record(e.description).html) || null, source_url: source,
      start_time: iso(record(e.start).utc), end_time: record(e.end).utc ? iso(record(e.end).utc) : null,
      cover_image_url: url(record(record(e.logo).original).url || record(e.logo).url),
      location: [text(record(e.venue).name), text(record(record(e.venue).address).localized_address_display)].filter(Boolean).join(', ') || null,
      location_url: null, is_free: e.is_free === true, fee_text: null, category: 'music', is_all_day: false,
      is_cancelled: record(e.event_sales_status).message_code === 'event_cancelled' || e.status === 'canceled' || cancelled(title),
    } })
  }
  result.items = deduplicate(result.items)
  return result
}
