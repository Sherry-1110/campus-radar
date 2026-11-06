import { load } from 'cheerio'
import type { Candidate, FetchText, SourceResult } from '../types.ts'
import { cancelled, category, deduplicate, iso, list, record, string, text, url } from './shared.ts'

const ORIGIN = 'https://catsoncampus.northwestern.edu'

function calendarTime(value = ''): string {
  // shortcut: the publisher emits UTC occurrence dates; reject new date/recurrence formats until supported.
  const match = /^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})Z$/.exec(value)
  if (!match) throw new Error(`Cats: invalid calendar datetime ${value}`)
  const result = iso(`${match[1]}-${match[2]}-${match[3]}T${match[4]}:${match[5]}:${match[6]}Z`)
  if (result.replace(/[-:]/g, '').replace('.000Z', 'Z') !== value) throw new Error(`Cats: invalid calendar datetime ${value}`)
  return result
}

function parseCalendar(ics: string): Map<string, Record<string, unknown>> {
  const lines = ics.replace(/\r\n/g, '\n').replace(/\n[ \t]/g, '').trim().split('\n')
  if (lines[0] !== 'BEGIN:VCALENDAR' || lines.at(-1) !== 'END:VCALENDAR') throw new Error('Cats: malformed calendar')
  const events = new Map<string, Record<string, unknown>>()
  let event: Record<string, string> | null = null
  for (const line of lines.slice(1, -1)) {
    if (!line) continue
    if (line === 'BEGIN:VEVENT') {
      if (event) throw new Error('Cats: nested calendar event')
      event = {}
    } else if (line === 'END:VEVENT') {
      if (!event) throw new Error('Cats: unbalanced calendar event')
      const id = /^https:\/\/catsoncampus\.northwestern\.edu\/rsvp\?id=(\d+)$/.exec(event.URL || '')?.[1]
      if (!id || !text(event.SUMMARY)) throw new Error('Cats: calendar event missing identity/title')
      if (events.has(id)) throw new Error(`Cats: duplicate calendar event ${id}`)
      events.set(id, { name: event.SUMMARY, startDate: calendarTime(event.DTSTART), endDate: event.DTEND ? calendarTime(event.DTEND) : null,
        description: event.DESCRIPTION, location: { name: event.LOCATION }, eventStatus: event.STATUS === 'CANCELLED' ? 'EventCancelled' : '' })
      event = null
    } else {
      const match = /^([A-Z][A-Z0-9-]*)(?:;[^:]*)?:(.*)$/.exec(line)
      if (!match || ['BEGIN', 'END'].includes(match[1]!)) throw new Error('Cats: malformed calendar property')
      const [, name, value] = match
      if (event && ['RRULE', 'RDATE', 'EXDATE', 'RECURRENCE-ID'].includes(name!)) throw new Error('Cats: unsupported calendar recurrence')
      if (event && ['URL', 'SUMMARY', 'DTSTART', 'DTEND', 'DESCRIPTION', 'LOCATION', 'STATUS'].includes(name!)) {
        if (name! in event) throw new Error(`Cats: duplicate calendar ${name}`)
        event[name!] = value!.replace(/\\([nN,;\\])/g, (_, escaped: string) => /n/i.test(escaped) ? '\n' : escaped)
      }
    }
  }
  if (event || !events.size) throw new Error('Cats: empty or incomplete calendar')
  return events
}

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
  let calendar: Promise<Map<string, Record<string, unknown>>> | undefined
  const entries = [...rows]
  for (let start = 0; start < entries.length; start += 5) {
    items.push(...await Promise.all(entries.slice(start, start + 5).map(async ([id, row]): Promise<Candidate> => {
      const source = `${ORIGIN}/rsvp_boot?id=${id}`
      const $ = load(await fetchText(source))
      // CampusGroups sometimes publishes invalid JSON escapes before HTML entities.
      const events = $('script[type="application/ld+json"]').toArray().flatMap(node => list(JSON.parse($(node).text().replace(/\\(?=&(?:#\d+|#x[\da-f]+|[a-z]+);)/gi, '')))).map(record).filter(event => event['@type'] === 'Event')
      let event = events.length === 1 ? events[0] : undefined
      // New detail pages are an app shell; /events advertises this public calendar feed.
      if (!events.length && $('title').text() === 'CampusGroups' && $('#root').length === 1 && $('script[type="module"][src^="/w/assets/index-"]').length === 1) {
        calendar ??= fetchText(`${ORIGIN}/ical/northwestern/ical_northwestern.ics`).then(parseCalendar)
        event = (await calendar).get(id)
        if (!event) throw new Error(`Cats ${id}: missing public calendar event`)
      }
      if (!event || !text(event.name)) throw new Error(`Cats ${id}: missing public Event data`)
      const startTime = iso(event.startDate)
      const endTime = event.endDate ? iso(event.endDate) : null
      if (endTime && endTime < startTime) throw new Error(`Cats ${id}: end precedes start`)
      const title = text(event.name)
      const body = text(event.description) || null
      const location = text(record(event.location).name || row.eventLocation)
      const privateLocation = /private location|sign in to (?:display|download)/i.test(location)
      const fee = text(row.eventPriceRange)
      const image = url(list(event.image)[0] || row.eventPicture, ORIGIN)
      if (privateLocation) warnings.push(`Cats ${id}: location requires sign-in`)
      return { external_id: id, related_url: null, listing_url: `${ORIGIN}/events`, data: {
        title, description: body, cover_image_url: image && !new URL(image).pathname.startsWith('/images/groups/') ? image : null,
        start_time: startTime, end_time: endTime,
        location: privateLocation ? null : location || null,
        location_url: null, is_free: /^free$/i.test(fee), fee_text: fee || null,
        category: category(text(row.eventCategory)), is_cancelled: string(event.eventStatus).endsWith('EventCancelled') || cancelled(title, string(event.description)),
        is_all_day: false, source_url: source,
      } }
    })))
  }
  return { items: deduplicate(items), warnings }
}
