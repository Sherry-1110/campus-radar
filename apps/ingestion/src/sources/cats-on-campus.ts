import { load } from 'cheerio'
import type { Candidate, FetchText, SourceResult } from '../types.ts'
import { cancelled, category, deduplicate, iso, list, record, string, text, url } from './shared.ts'

const ORIGIN = 'https://catsoncampus.northwestern.edu'

export async function fetchCatsOnCampus(fetchText: FetchText, _now = new Date()): Promise<SourceResult> {
  const rows = new Map<string, Record<string, unknown>>()
  // The public counter includes hidden events; advance the server's range, not the visible event count.
  for (let range = 0; ; range += 100) {
    if (range >= 10_000) throw new Error('Cats: listing pagination exceeded limit')
    const page: unknown = JSON.parse(await fetchText(`${ORIGIN}/mobile_ws/v17/mobile_events_list?range=${range}&limit=100`))
    if (!Array.isArray(page)) throw new Error('Cats: invalid listing response')
    if (!page.length) break
    let added = 0
    for (const raw of page) {
      const row = record(raw)
      const fields = string(row.fields).split(',')
      if (!fields.includes('displayType')) throw new Error('Cats: invalid listing fields')
      const event = Object.fromEntries(fields.filter(Boolean).map((key, index) => [key, row[`p${index}`]]))
      if (event.displayType === 'separator') continue
      if (event.displayType !== 'event' || !/^\d+$/.test(string(event.eventId))) throw new Error('Cats: invalid listing event')
      const id = string(event.eventId)
      if (rows.has(id)) throw new Error(`Cats: repeated pagination event ${id}`)
      rows.set(id, event)
      added++
    }
    if (!added && page.some(raw => record(raw).all_results_hidden !== true)) throw new Error('Cats: listing contains no public events')
  }
  const items: Candidate[] = []
  const warnings: string[] = []
  const entries = [...rows]
  for (let start = 0; start < entries.length; start += 5) {
    items.push(...await Promise.all(entries.slice(start, start + 5).map(async ([id, row]): Promise<Candidate> => {
      const source = `${ORIGIN}/rsvp_boot?id=${id}`
      const $ = load(await fetchText(source))
      // CampusGroups sometimes publishes invalid JSON escapes before HTML entities.
      const events = $('script[type="application/ld+json"]').toArray().flatMap(node => list(JSON.parse($(node).text().replace(/\\(?=&(?:#\d+|#x[\da-f]+|[a-z]+);)/gi, '')))).map(record).filter(event => event['@type'] === 'Event')
      if (events.length !== 1 || !text(events[0]!.name)) throw new Error(`Cats ${id}: missing public Event data`)
      const event = events[0]!
      const startTime = iso(event.startDate)
      const endTime = event.endDate ? iso(event.endDate) : null
      if (endTime && endTime < startTime) throw new Error(`Cats ${id}: end precedes start`)
      const title = text(event.name)
      const body = text(event.description) || null
      const location = text(record(event.location).name || row.eventLocation)
      const fee = text(row.eventPriceRange)
      const image = url(list(event.image)[0] || row.eventPicture, ORIGIN)
      if (/private location|sign in to display/i.test(location)) warnings.push(`Cats ${id}: location requires sign-in`)
      return { external_id: id, related_url: null, listing_url: `${ORIGIN}/events`, data: {
        title, description: body, cover_image_url: image && !new URL(image).pathname.startsWith('/images/groups/') ? image : null,
        start_time: startTime, end_time: endTime,
        location: /private location|sign in to display/i.test(location) ? null : location || null,
        location_url: null, is_free: /^free$/i.test(fee), fee_text: fee || null,
        category: category(text(row.eventCategory)), is_cancelled: string(event.eventStatus).endsWith('EventCancelled') || cancelled(title, string(event.description)),
        is_all_day: false, source_url: source,
      } }
    })))
  }
  return { items: deduplicate(items), warnings }
}
