import { load } from 'cheerio'
import type { SourceResult, FetchText } from '../types.ts'
import { record, list, field, string, text, url, iso, enabled, disabled, description, cancelled, deduplicate } from './shared.ts'

const BIENEN = 'https://www.music.northwestern.edu'
const BIENEN_FEED = `${BIENEN}/get_events/event_resource?_format=json`

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
