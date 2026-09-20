import { load } from 'cheerio'
import type { Candidate, FetchText, SourceResult } from '../types.ts'

// Public feed linked by the organizer's AddEvent calendar Id622001.
const FEED = 'https://www.addevent.com/feed/eehiaisow.ics'
type Property = { params: string; value: string }
type Event = Map<string, Property[]>
const one = (event: Event, key: string): Property | undefined => event.get(key)?.[0]
const value = (event: Event, key: string): string => one(event, key)?.value || ''
const unescape = (text: string): string => text.replace(/\\([nN,;\\])/g, (_, escaped: string) => /n/i.test(escaped) ? '\n' : escaped)

function parseCalendar(ics: string): Event[] {
  const lines = ics.replace(/\r\n/g, '\n').replace(/\n[ \t]/g, '').trim().split('\n')
  if (lines[0] !== 'BEGIN:VCALENDAR' || lines.at(-1) !== 'END:VCALENDAR') throw new Error('Garage: malformed calendar')
  const events: Event[] = []
  let event: Event | null = null
  const stack: string[] = []
  for (const line of lines) {
    if (!line) continue
    const match = /^([A-Z][A-Z0-9-]*)(;[^:]*)?:(.*)$/.exec(line)
    if (!match) throw new Error('Garage: malformed calendar property')
    const [, name, params = '', raw = ''] = match
    if (name === 'BEGIN') {
      if (raw === 'VEVENT') {
        if (event || stack.at(-1) !== 'VCALENDAR') throw new Error('Garage: nested event')
        event = new Map()
      }
      stack.push(raw)
    } else if (name === 'END') {
      if (stack.pop() !== raw) throw new Error('Garage: unbalanced calendar')
      if (raw === 'VEVENT') { events.push(event!); event = null }
    } else if (event && stack.at(-1) === 'VEVENT') {
      if (event.has(name!) && !['EXDATE', 'RDATE'].includes(name!)) throw new Error(`Garage: duplicate ${name}`)
      event.set(name!, [...event.get(name!) || [], { params, value: raw }])
    }
  }
  if (stack.length || !events.length) throw new Error('Garage: empty or incomplete calendar')
  return events
}

function localDate(property: Property): Date {
  const match = /^(\d{4})(\d{2})(\d{2})(?:T(\d{2})(\d{2})(\d{2})(Z)?)?$/.exec(property.value)
  if (!match) throw new Error(`Garage: invalid datetime ${property.value}`)
  const [, year, month, day, hour = '00', minute = '00', second = '00'] = match
  const date = new Date(`${year}-${month}-${day}T${hour}:${minute}:${second}Z`)
  if (!Number.isFinite(date.getTime()) || date.getUTCMonth() + 1 !== Number(month) || date.getUTCDate() !== Number(day)) throw new Error(`Garage: invalid datetime ${property.value}`)
  return date
}

function instant(property: Property): number {
  const local = localDate(property).getTime()
  if (property.value.endsWith('Z')) return local
  const timezone = /(?:^|;)TZID=([^;]+)/.exec(property.params)?.[1] || (/;VALUE=DATE(?:;|$)/.test(property.params) ? 'America/Chicago' : '')
  if (!timezone) throw new Error('Garage: floating time without timezone')
  const formatter = new Intl.DateTimeFormat('en-US', { timeZone: timezone, timeZoneName: 'longOffset' })
  let utc = local
  let previous = NaN
  for (let i = 0; i < 3; i++) {
    const zone = formatter.formatToParts(utc).find(part => part.type === 'timeZoneName')!.value
    const offset = /^GMT(?:([+-])(\d{2}):(\d{2}))?$/.exec(zone)
    if (!offset) throw new Error(`Garage: invalid timezone offset ${zone}`)
    previous = utc
    utc = local - (offset[1] ? (Number(offset[2]) * 60 + Number(offset[3])) * (offset[1] === '-' ? -1 : 1) * 60_000 : 0)
  }
  if (utc !== previous) throw new Error(`Garage: nonexistent local time ${property.value}`)
  return utc
}

function shifted(property: Property, days: number): Property {
  const date = localDate(property)
  date.setUTCDate(date.getUTCDate() + days)
  const raw = date.toISOString().replace(/[-:]/g, '').replace('.000Z', '')
  return { ...property, value: property.value.length === 8 ? raw.slice(0, 8) : raw + (property.value.endsWith('Z') ? 'Z' : '') }
}

function occurrences(event: Event): Property[] {
  const start = one(event, 'DTSTART')
  if (!start) throw new Error('Garage: missing event start')
  localDate(start)
  if (event.has('RDATE')) throw new Error('Garage: unsupported RDATE recurrence')
  const rule = value(event, 'RRULE')
  if (!rule) return [start]
  const fields = rule.split(';').map(part => part.split('='))
  const r = Object.fromEntries(fields)
  const interval = Number(r.INTERVAL || 1)
  const count = Number(r.COUNT || 1000)
  const weekday = ['SU', 'MO', 'TU', 'WE', 'TH', 'FR', 'SA'][localDate(start).getUTCDay()]
  // ponytail: only the organizer's observed finite, single-weekday rules; fail visibly if their recurrence format changes.
  if (fields.some(([key]) => !['FREQ', 'INTERVAL', 'COUNT', 'UNTIL', 'BYDAY'].includes(key!)) || r.FREQ !== 'WEEKLY' || (r.BYDAY && r.BYDAY !== weekday) || (!r.COUNT && !r.UNTIL) || !Number.isInteger(interval) || interval < 1 || !Number.isInteger(count) || count < 1 || count > 1000) throw new Error(`Garage: unsupported recurrence ${rule}`)
  const until = r.UNTIL ? instant({ params: start.params, value: r.UNTIL }) : Infinity
  const dates: Property[] = []
  for (let i = 0; i < count; i++) {
    const date = shifted(start, i * interval * 7)
    if (instant(date) > until) break
    dates.push(date)
  }
  if (!r.COUNT && dates.length === count) throw new Error('Garage: recurrence exceeds occurrence limit')
  return dates
}

function httpUrl(raw: string): string | null {
  try { const url = new URL(raw); return ['http:', 'https:'].includes(url.protocol) ? url.href : null } catch { return null }
}

export async function fetchGarage(fetchText: FetchText, now = new Date()): Promise<SourceResult> {
  const events = parseCalendar(await fetchText(FEED))
  const series = new Map<string, Event>()
  const exceptions = new Map<string, Event>()
  for (const event of events) {
    const id = /^([a-z0-9]+)@addevent\.com$/i.exec(value(event, 'UID'))?.[1]
    const recurrence = one(event, 'RECURRENCE-ID')
    if (!id || (!recurrence && (!value(event, 'SUMMARY') || !one(event, 'DTSTART')))) throw new Error('Garage: missing event identity/title/date')
    if (recurrence?.params.includes('RANGE=')) throw new Error('Garage: unsupported recurrence exception range')
    const key = recurrence ? `${id}:${instant(recurrence)}` : id
    const map = recurrence ? exceptions : series
    if (map.has(key)) throw new Error(`Garage: conflicting event identity ${key}`)
    map.set(key, event)
  }
  const result: SourceResult = { items: [], warnings: [] }
  for (const [id, master] of series) {
    const start = one(master, 'DTSTART')!
    const end = one(master, 'DTEND')
    if (end && instant(end) < instant(start)) throw new Error(`Garage ${id}: end precedes start`)
    const excluded = new Set((master.get('EXDATE') || []).flatMap(p => p.value.split(',').map(raw => instant({ ...p, value: raw }))))
    for (const date of occurrences(master)) {
      const key = master.has('RRULE') ? `${id}:${date.value}` : id
      const exceptionKey = `${id}:${instant(date)}`
      const override = exceptions.get(exceptionKey)
      if (override) exceptions.delete(exceptionKey)
      const event = override ? new Map([...master, ...override]) : master
      const occurrenceStart = override && one(override, 'DTSTART') || date
      const days = (localDate(date).getTime() - localDate(start).getTime()) / 86_400_000
      const occurrenceEnd = override && one(override, 'DTEND') || (end ? shifted(end, days) : undefined)
      const startTime = instant(occurrenceStart)
      const endTime = occurrenceEnd ? instant(occurrenceEnd) : null
      if (endTime !== null && endTime < startTime) throw new Error(`Garage ${id}: end precedes start`)
      if ((endTime ?? startTime) < now.getTime() - 90 * 86_400_000) continue
      const title = unescape(value(event, 'SUMMARY')).replace(/^\[RSVP\]\s*/, '').trim()
      if (!title) throw new Error(`Garage ${id}: missing title`)
      const location = unescape(value(event, 'LOCATION')).trim() || null
      const allDay = /;VALUE=DATE(?:;|$)/.test(occurrenceStart.params)
      const description = unescape(value(event, 'DESCRIPTION')).trim() || null
      const source = `https://www.addevent.com/event/${id}`
      const candidate: Candidate = { external_id: key, related_url: null, data: {
        title, description, cover_image_url: null, start_time: new Date(startTime).toISOString(),
        end_time: endTime === null ? null : new Date(endTime - (allDay ? 1 : 0)).toISOString(),
        location, location_url: location ? httpUrl(location) : null, is_free: false, fee_text: null,
        category: /dinner|burrito/i.test(title) ? 'food' : 'career',
        is_cancelled: value(event, 'STATUS') === 'CANCELLED' || excluded.has(instant(date)) || /^(?:\[|\()?cancel(?:l)?ed(?:\]|\)|\s|:|$)/i.test(title),
        is_all_day: allDay, source_url: source,
      } }
      result.items.push(candidate)
    }
  }
  if (exceptions.size) throw new Error('Garage: unmatched recurrence exception')
  const pages = new Map<string, string>()
  for (const item of result.items) {
    const source = item.data.source_url
    if (!pages.has(source)) pages.set(source, await fetchText(source))
    const $ = load(pages.get(source)!)
    // Unknown page contents must not turn a temporary failure into a poster deletion.
    if ($('link[rel="canonical"]').attr('href') !== source || !$('meta[property="og:title"]').attr('content')?.trim()) throw new Error(`Garage ${item.external_id}: unexpected event page`)
    const image = httpUrl($('meta[property="og:image"]').attr('content') || '')
    if (image && !(new URL(image).hostname === 'cdn.addevent.com' && /\/(?:libs\/imgs|web\/images)\//.test(new URL(image).pathname))) item.data.cover_image_url = image
    if (!item.data.cover_image_url) result.warnings.push(`Garage ${item.external_id}: missing poster`)
  }
  return result
}
