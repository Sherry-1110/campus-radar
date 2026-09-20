import { load } from 'cheerio'
import { XMLParser, XMLValidator } from 'fast-xml-parser'
import type { Candidate, Category, FetchText, SourceResult } from './types.ts'

const BIENEN = 'https://www.music.northwestern.edu'
const BIENEN_FEED = `${BIENEN}/get_events/event_resource?_format=json`
type Row = Record<string, unknown>
const record = (value: unknown): Row => value !== null && typeof value === 'object' && !Array.isArray(value) ? value as Row : {}
const list = (value: unknown): unknown[] => value === undefined ? [] : Array.isArray(value) ? value : [value]
const field = (value: unknown): unknown => Array.isArray(value) ? record(value[0]).value : value
const string = (value: unknown): string => typeof value === 'string' || typeof value === 'number' ? String(value) : ''
const enabled = (value: unknown): boolean => [true, 1, '1'].includes(field(value) as boolean | number | string)
const disabled = (value: unknown): boolean => [false, 0, '0'].includes(field(value) as boolean | number | string)

function text(value: unknown): string {
  const $ = load(string(value), null, false)
  $('script,style').remove()
  $('br').replaceWith('\n')
  $('p,div,li,h1,h2,h3,h4').append('\n\n')
  return $.root().text().replace(/\u00a0/g, ' ').replace(/[ \t]+/g, ' ').replace(/ *\n */g, '\n').replace(/\n{3,}/g, '\n\n').trim()
}

function url(value: unknown, base?: string): string | null {
  const raw = string(value).trim()
  if (!raw) return null
  try {
    const parsed = new URL(raw, base)
    if (!['https:', 'http:'].includes(parsed.protocol)) throw new Error('unsupported protocol')
    return parsed.href
  } catch { throw new Error(`Invalid source URL: ${raw}`) }
}

function iso(value: unknown): string {
  const raw = string(value)
  if (!raw || !/(?:Z|[+-]\d\d:\d\d)$/.test(raw) || !Number.isFinite(Date.parse(raw))) throw new Error(`Invalid event datetime: ${raw}`)
  return new Date(raw).toISOString()
}

function epoch(value: unknown): number {
  const raw = string(value)
  if (!/^\d+$/.test(raw) || !Number.isFinite(new Date(Number(raw) * 1000).getTime())) throw new Error(`Invalid event epoch: ${raw}`)
  return Number(raw) * 1000
}

function endOfLocalDay(start: number, abbreviation: string): string {
  const zone = ({ CT: 'America/Chicago', ET: 'America/New_York', MT: 'America/Denver', PT: 'America/Los_Angeles', AST: 'Asia/Qatar' } as Record<string, string>)[abbreviation || 'CT']
  if (!zone) throw new Error(`Unsupported event timezone: ${abbreviation}`)
  const date = new Intl.DateTimeFormat('en-CA', { timeZone: zone, year: 'numeric', month: '2-digit', day: '2-digit' }).format(start)
  const midnight = Date.parse(`${date}T00:00:00Z`) + 86_400_000
  let next = midnight
  for (let i = 0; i < 3; i++) {
    const offset = new Intl.DateTimeFormat('en', { timeZone: zone, timeZoneName: 'shortOffset' }).formatToParts(next).find(p => p.type === 'timeZoneName')!.value
    const match = /GMT([+-])(\d+)(?::(\d+))?/.exec(offset)
    const minutes = match ? (Number(match[2]) * 60 + Number(match[3] || 0)) * (match[1] === '-' ? -1 : 1) : 0
    next = midnight - minutes * 60_000
  }
  return new Date(next - 1).toISOString()
}

function cancelled(title: string, body = ''): boolean {
  const marker = /^(?:\[|\()?cancel(?:l)?ed(?:\]|\)|\s|:|$)/i
  if (marker.test(title) || /\(cancel(?:l)?ed\)\s*$/i.test(title)) return true
  const $ = load(body, null, false)
  return $('h1,h2,h3,h4,strong').toArray().some(el => marker.test(text($(el).html())))
}

function category(value: string): Category {
  if (/music|concert|recital|orchestra/i.test(value)) return 'music'
  if (/arts|theat|film|humanities/i.test(value)) return 'arts'
  if (/fitness|sport/i.test(value)) return 'sports'
  if (/wellness|health/i.test(value)) return 'wellness'
  if (/career|workplace/i.test(value)) return 'career'
  if (/social/i.test(value)) return 'social'
  if (/academic|science|lecture/i.test(value)) return 'academic'
  return 'other'
}

function description(body: unknown, registration: string | null): string | null {
  return [text(body), registration ? `Registration: ${registration}` : ''].filter(Boolean).join('\n\n') || null
}

function deduplicate(items: Candidate[]): Candidate[] {
  const seen = new Map<string, Candidate>()
  for (const item of items) {
    const prior = seen.get(item.external_id)
    if (prior && JSON.stringify(prior) !== JSON.stringify(item)) throw new Error(`Conflicting occurrence identity: ${item.external_id}`)
    seen.set(item.external_id, item)
  }
  return [...seen.values()]
}

export function parsePlanItPurple(xml: string): SourceResult {
  if (XMLValidator.validate(xml) !== true) throw new Error('Malformed PlanIt Purple XML')
  const parsed = new XMLParser({ ignoreAttributes: true, parseTagValue: false }).parse(xml)
  if (!Object.hasOwn(parsed, 'planitpurple')) throw new Error('Missing PlanIt Purple feed root')
  if (parsed.planitpurple !== '' && !Object.keys(record(parsed.planitpurple)).includes('event')) throw new Error('Invalid PlanIt Purple feed contents')
  const result: SourceResult = { items: [], warnings: [] }
  for (const raw of list(record(parsed.planitpurple).event)) {
    const e = record(raw)
    const source = url(e.ppurl)
    const id = source && /^https:\/\/planitpurple\.northwestern\.edu\/event\/(\d+)\/?$/.exec(source)?.[1]
    const title = text(e.title)
    if (!id || !title) throw new Error('PlanIt Purple event missing identity/title')
    const start = epoch(e.start_datetime)
    const end = epoch(e.end_datetime)
    const allDay = !text(e.time)
    if (end < start) throw new Error(`PlanIt Purple ${id}: end precedes start`)
    const image = url(e.image_med || e.image_sm || e.image_hero)
    if (!image) result.warnings.push(`PlanIt Purple ${id}: missing poster`)
    const fee = text(e.cost) || null
    const address = record(e.address)
    const place = ['building_name', 'address_2', 'address_1', 'city', 'state', 'zip'].map(k => text(address[k])).filter(Boolean).join(', ') || text(e.location) || null
    if (text(e.location) === 'Qatar') continue
    result.items.push({ external_id: id, related_url: url(e.externalurl), data: {
      title, description: description(e.description_html || e.description, url(e.registration_link)),
      cover_image_url: image, start_time: new Date(start).toISOString(),
      end_time: allDay ? endOfLocalDay(end, text(e.time_zone)) : new Date(end).toISOString(),
      location: place, location_url: url(e.locationurl), is_free: Boolean(fee && /^(?:free(?:\s|[.!]|$)|no (?:charge|cost)|\$0(?:\.00)?$)/i.test(fee)),
      fee_text: fee, category: category(text(e['category-name'])), is_cancelled: Object.hasOwn(e, 'cancelled'), is_all_day: allDay, source_url: source!,
    } })
  }
  result.items = deduplicate(result.items)
  return result
}

export async function fetchPlanItPurple(fetchText: FetchText, _now = new Date()): Promise<SourceResult> {
  const future = parsePlanItPurple(await fetchText('https://planitpurple.northwestern.edu/xmlfeed?cal=0&days=0'))
  const recent = parsePlanItPurple(await fetchText('https://planitpurple.northwestern.edu/xmlfeed?cal=0&archive=1&days=1'))
  // The later response wins for overlapping occurrences updated between requests.
  const merged = new Map([...future.items, ...recent.items].map(item => [item.external_id, item]))
  return { items: [...merged.values()], warnings: [...new Set([...future.warnings, ...recent.warnings])] }
}

export function parseBienen(json: string, now = new Date()): SourceResult {
  const rows: unknown = JSON.parse(json)
  if (!Array.isArray(rows)) throw new Error('Bienen feed must be an array')
  const result: SourceResult = { items: [], warnings: [] }
  for (const raw of rows) {
    const e = record(raw)
    const nid = string(field(e.nid))
    if (!nid) throw new Error('Bienen record missing node ID')
    if (disabled(e.status) || disabled(e.include_on_calendar)) {
      result.warnings.push(`Bienen ${nid}: unpublished or excluded from calendar; not a cancellation`)
      continue
    }
    const repeated = enabled(e.repeat_event)
    const instance = record(e.event_data)
    const date = iso(field(repeated ? instance.field_event_date : e.event_date))
    const instanceId = string(field(repeated ? instance.field_instance_id : e.event_instance_id))
    const paragraphId = repeated ? string(field(instance.id)) : ''
    if (repeated && !instanceId && !paragraphId) throw new Error(`Bienen ${nid}: repeated event missing stable occurrence identity`)
    if (Date.parse(date) < now.getTime() - 90 * 86_400_000) continue
    const title = text(field(e.title))
    const source = url(record(list(e.path)[0]).alias, BIENEN)
    if (!title || !source?.startsWith(`${BIENEN}/events/`)) throw new Error(`Bienen ${nid}: missing title/detail URL`)
    const body = field(repeated ? instance.field_detail : e.body)
    const registration = url(record(list(repeated ? instance.field_ticket_link : e.ticket_link)[0]).uri)
    const image = url(record(list(record(list(e.featured_image)[0]).uri)[0]).url, BIENEN)
    const fee = text(field(e.event_pricing)) || null
    const id = instanceId ? `instance:${instanceId}` : paragraphId ? `paragraph:${paragraphId}` : `node:${nid}`
    if (!image) result.warnings.push(`Bienen ${id}: missing poster`)
    result.items.push({ external_id: id, related_url: null, data: {
      title, description: description(body, registration), cover_image_url: image, start_time: date, end_time: null,
      location: null, location_url: null, is_free: enabled(repeated ? instance.field_free_event : e.free_event), fee_text: fee,
      category: 'music', is_cancelled: cancelled(title, string(body)), is_all_day: false, source_url: source,
    } })
  }
  result.items = deduplicate(result.items)
  return result
}

export async function fetchBienen(fetchText: FetchText, now = new Date()): Promise<SourceResult> {
  const result = parseBienen(await fetchText(BIENEN_FEED), now)
  const pages = new Map<string, string>()
  // Fetch each canonical page once per run; repeated performances share one page.
  for (const item of result.items) {
    const source = item.data.source_url
    if (!pages.has(source)) pages.set(source, await fetchText(source))
    const $ = load(pages.get(source)!)
    const blocks = $('#event-info .event-details')
    if (!blocks.length) throw new Error(`Bienen ${item.external_id}: missing event detail content at ${source}`)
    const registration = item.data.description?.match(/Registration: (\S+)/)?.[1]
    let block = blocks.length === 1 ? blocks.first() : blocks.filter(() => false)
    if (!block.length) {
      const date = new Date(item.data.start_time)
      const dateText = new Intl.DateTimeFormat('en-US', { timeZone: 'America/Chicago', year: 'numeric', month: 'long', day: 'numeric', hour: 'numeric', minute: '2-digit' }).format(date).replace(/\s/g, '').toLowerCase()
      const dated = blocks.filter((_, el) => string($(el).attr('data-date')).replace(/\s/g, '').toLowerCase() === dateText)
      if (dated.length === 1) block = dated
    }
    if (!block.length && registration) {
      const ticketed = blocks.filter((_, el) => $(el).find('a').toArray().some(a => $(a).attr('href') === registration))
      if (ticketed.length === 1) block = ticketed
    }
    if (!block.length) throw new Error(`Bienen ${item.external_id}: cannot match repeated performance detail`)
    const place = text(block.find('.location').first().text())
    if (!place) result.warnings.push(`Bienen ${item.external_id}: missing detail venue`)
    item.data.location = place || null
    item.data.is_cancelled ||= cancelled(text($('h1').first().text()), block.html() || '')
    const descriptionBlock = block.clone()
    descriptionBlock.find('.location,h3.header3').remove()
    item.data.description = description(descriptionBlock.html(), registration || null)
    const locationLink = $('.event-location a[href*="maps.google"]').first().attr('href')
    item.data.location_url = url(locationLink)
  }
  return result
}
