import { load } from 'cheerio'
import type { FetchText, SourceResult } from '../types.ts'
import { cancelled, category, deduplicate, iso, list, record, string, text, url } from './shared.ts'

const ORIGIN = 'https://do312.com'

export function parseDo312(html: string, listingUrl: string): SourceResult & { next: string | null } {
  const $ = load(html)
  if (!$('#ds-listing-content').length) throw new Error('Do312: missing listing content (blocked or layout changed)')
  const result: SourceResult & { next: string | null } = { items: [], warnings: [], next: url($('a.ds-next-page').attr('href'), listingUrl) }
  $('.ds-listing.event-card').each((_, element) => {
    const card = $(element), link = card.find('.ds-listing-event-title').first()
    const source = url(link.attr('href'), ORIGIN)
    const id = card.find('[data-ds-id]').first().attr('data-ds-id')
    const title = text(link.find('[itemprop="name"]').text())
    if (!id || !/^\d+$/.test(id) || !source || !title) throw new Error('Do312: incomplete event identity')
    if (card.find('.ds-listing-series').length || source.includes('/events/weekly/')) {
      result.warnings.push(`Do312 ${id}: series has no dated performance identity; skipped`)
      return
    }
    const date = card.find('[itemprop="startDate"]').attr('content')
    if (!date) throw new Error(`Do312 ${id}: missing occurrence datetime`)
    const toIso = (value: string) => iso(value.replace(/([+-]\d{2})(\d{2})$/, '$1:$2'))
    const price = card.find('[itemprop="price"]').first()
    const freeBanner = card.find('.ds-listing-banners span').toArray().some(el => /^free$/i.test(text($(el).text())))
    const fee = text(price.attr('content') || price.text()) || (freeBanner ? 'Free' : null)
    const image = /url\(['"]?([^'")]+)['"]?\)/.exec(card.find('.ds-cover-image').attr('style') || '')?.[1]
    const end = card.find('[itemprop="endDate"]').attr('content')
    const cancellation = card.find('.ds-listing-banners,.ds-listing-cancelled,.ds-listing-canceled,[itemprop="eventStatus"]').text() + ' ' + (card.find('[itemprop="eventStatus"]').attr('content') || '')
    result.items.push({ external_id: id, listing_url: listingUrl, related_url: source, data: {
      title, source_url: source, start_time: toIso(date), end_time: end ? toIso(end) : null,
      description: null, cover_image_url: url(image), location: text(card.find('.ds-venue-name [itemprop="name"]').first().text()) || null,
      location_url: url(card.find('.ds-venue-name a[aria-label="Google Maps location"]').attr('href')),
      is_free: fee !== null && /^(?:free|\$?0(?:\.00)?(?:\s*USD)?)$/i.test(fee), fee_text: fee,
      category: category(card.attr('class') || ''), is_all_day: false,
      is_cancelled: cancelled(title) || /\bcancel(?:l)?ed\b|EventCancelled/i.test(cancellation),
    } })
  })
  result.items = deduplicate(result.items)
  return result
}

function parseBrowse(json: string, listingUrl: string) {
  const response = record(JSON.parse(json))
  // The public SvelteKit response stores plain JSON values in a reference table.
  // Decode data only; never evaluate the page's hydration JavaScript.
  let browse: Record<string, unknown> | undefined
  for (const node of list(response.nodes)) {
    const values = record(node).data
    if (!Array.isArray(values) || !Object.hasOwn(record(values[0]), 'browse')) continue
    const active = new Set<number>()
    const decodedValues = new Map<number, unknown>()
    const decode = (ref: unknown, depth = 0): unknown => {
      if (ref === -1) return undefined
      if (!Number.isInteger(ref) || Number(ref) < 0 || Number(ref) >= values.length || depth > 40 || active.has(Number(ref))) throw new Error('Do312: invalid structured data reference')
      if (decodedValues.has(Number(ref))) return decodedValues.get(Number(ref))
      const value: unknown = values[Number(ref)]
      if (!value || typeof value !== 'object') return value
      active.add(Number(ref))
      const decoded: unknown = Array.isArray(value)
        ? value.map(v => decode(v, depth + 1))
        : Object.fromEntries(Object.entries(value).map(([key, v]) => [key, decode(v, depth + 1)]))
      active.delete(Number(ref))
      decodedValues.set(Number(ref), decoded)
      return decoded
    }
    browse = record(record(decode(0)).browse)
  }
  if (!browse || !Array.isArray(browse.data)) throw new Error('Do312: missing browse data')
  const meta = record(browse._meta)
  const current = new URL(listingUrl)
  const page = Number(current.searchParams.get('page') || 1)
  const rows = browse.data.flatMap(group => {
    const events = record(group).events
    if (!Array.isArray(events)) throw new Error('Do312: missing event data')
    return events.map(record)
  })
  if (![meta.total, meta.total_pages, meta.page_size, meta.returned].every(n => Number.isInteger(n) && Number(n) >= 0)
    || Number(meta.page_size) < 1 || meta.page !== page || meta.returned !== rows.length
    || meta.total_pages !== Math.ceil(Number(meta.total) / Number(meta.page_size))
    || rows.length !== Math.min(Number(meta.page_size), Math.max(0, Number(meta.total) - (page - 1) * Number(meta.page_size)))
    || meta.has_next !== (page < Number(meta.total_pages))) throw new Error('Do312: inconsistent browse pagination')
  const result: SourceResult & { next: string | null; total: number; ids: string[] } = { items: [], warnings: [], next: null, total: Number(meta.total), ids: [] }
  for (const row of rows) {
    const id = string(row.id), title = text(row.title), source = url(row.permalink, ORIGIN)
    if (row.type !== 'event' || !/^\d+$/.test(id) || !title || !source || new URL(source).origin !== ORIGIN) throw new Error('Do312: incomplete event identity')
    result.ids.push(id)
    if (row.event_type === 'multi_day' || source.includes('/events/weekly/')) {
      result.warnings.push(`Do312 ${id}: series has no dated performance identity; skipped`)
      continue
    }
    if (row.event_type !== 'single_day') throw new Error(`Do312 ${id}: unknown occurrence type`)
    result.items.push({ external_id: id, listing_url: listingUrl, related_url: source, data: {
      title, source_url: source, start_time: iso(row.tz_adjusted_begin_time), end_time: row.tz_adjusted_end_time ? iso(row.tz_adjusted_end_time) : null,
      description: null, cover_image_url: url(row.image_url), location: text(record(row.venue).title) || null,
      location_url: null, is_free: false, fee_text: null, category: category(string(row.category)),
      is_all_day: false, is_cancelled: cancelled(title),
    } })
  }
  if (meta.has_next) { current.searchParams.set('page', String(page + 1)); result.next = current.href }
  return result
}

export async function fetchDo312(fetchText: FetchText, now = new Date(), days = 14): Promise<SourceResult> {
  if (!Number.isInteger(days) || days < 1 || days > 30) throw new Error('Do312: invalid day window')
  const today = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Chicago', year: 'numeric', month: '2-digit', day: '2-digit' }).format(now)
  const result: SourceResult = { items: [], warnings: [`Do312: ${days}-day upcoming window; ambiguous recurring series excluded`] }
  const seen = new Set<string>()
  let redesigned = false
  for (let day = 0; day < days; day++) {
    const date = new Date(Date.parse(`${today}T12:00:00Z`) + day * 86_400_000).toISOString().slice(0, 10)
    let next: string | null = `${ORIGIN}/events/${date.replaceAll('-', '/')}`
    let pages = 0
    let total: number | undefined
    const ids = new Set<string>()
    while (next) {
      // AJAX pagination links select JSON even when the request accepts HTML.
      const target = new URL(next)
      target.searchParams.delete('format')
      next = target.href
      if (new URL(next).origin !== ORIGIN || seen.has(next) || ++pages > 50) throw new Error('Do312: unsafe or incomplete pagination')
      seen.add(next)
      const html: string = redesigned ? '' : await fetchText(next)
      redesigned ||= html.includes('__sveltekit_')
      let parsed: SourceResult & { next: string | null }
      if (redesigned) {
        const endpoint = new URL(next)
        endpoint.pathname = `${endpoint.pathname.replace(/\/0(\d)(?=\/|$)/g, '/$1').replace(/\/$/, '')}/__data.json`
        const page = parseBrowse(await fetchText(endpoint.href), next)
        if (total !== undefined && total !== page.total) throw new Error('Do312: changed browse pagination')
        total = page.total
        for (const id of page.ids) {
          if (ids.has(id)) throw new Error('Do312: repeated browse pagination event')
          ids.add(id)
        }
        if (!page.next && ids.size !== total) throw new Error('Do312: incomplete browse pagination')
        parsed = page
      } else parsed = parseDo312(html, next)
      result.items.push(...parsed.items.map(item => ({ ...item, listing_url: `${ORIGIN}/events/${date.replaceAll('-', '/')}` })))
      result.warnings.push(...parsed.warnings)
      next = parsed.next
    }
  }
  // One event may be promoted on several days; listing provenance is not event identity.
  const byId = new Map<string, typeof result.items[number]>()
  for (const item of result.items) {
    const prior = byId.get(item.external_id)
    if (prior && JSON.stringify(prior.data) !== JSON.stringify(item.data)) throw new Error(`Do312: conflicting occurrence ${item.external_id}`)
    byId.set(item.external_id, prior || item)
  }
  result.items = [...byId.values()]
  result.warnings = [...new Set(result.warnings)]
  return result
}
