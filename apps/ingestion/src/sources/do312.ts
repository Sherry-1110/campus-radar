import { load } from 'cheerio'
import type { FetchText, SourceResult } from '../types.ts'
import { cancelled, category, deduplicate, iso, text, url } from './shared.ts'

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

export async function fetchDo312(fetchText: FetchText, now = new Date(), days = 14): Promise<SourceResult> {
  if (!Number.isInteger(days) || days < 1 || days > 30) throw new Error('Do312: invalid day window')
  const today = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Chicago', year: 'numeric', month: '2-digit', day: '2-digit' }).format(now)
  const result: SourceResult = { items: [], warnings: [`Do312: ${days}-day upcoming window; ambiguous recurring series excluded`] }
  const seen = new Set<string>()
  for (let day = 0; day < days; day++) {
    const date = new Date(Date.parse(`${today}T12:00:00Z`) + day * 86_400_000).toISOString().slice(0, 10)
    let next: string | null = `${ORIGIN}/events/${date.replaceAll('-', '/')}`
    let pages = 0
    while (next) {
      if (new URL(next).origin !== ORIGIN || seen.has(next) || ++pages > 50) throw new Error('Do312: unsafe or incomplete pagination')
      seen.add(next)
      const parsed = parseDo312(await fetchText(next), next)
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
