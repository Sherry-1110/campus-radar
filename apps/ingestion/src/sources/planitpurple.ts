import { XMLParser, XMLValidator } from 'fast-xml-parser'
import type { SourceResult, FetchText } from '../types.ts'
import { record, list, text, url, epoch, endOfLocalDay, description, category, deduplicate } from './shared.ts'

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

