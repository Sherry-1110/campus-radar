import { record as row, string, text, cancelled } from './shared.ts'
import type { Candidate, Category, FetchText, SourceResult } from '../types.ts'

const ORIGIN = 'https://www.choosechicago.com'
const PATH = '/wp-json/tribe/events/v1/events'
const DAY = 86_400_000

function url(value: unknown): string | null {
  const raw = string(value).trim()
  if (!raw) return null
  const parsed = new URL(raw, ORIGIN)
  if (!['http:', 'https:'].includes(parsed.protocol) || parsed.username || parsed.password) throw new Error('Choose Chicago: invalid URL')
  return parsed.href
}

function utc(value: unknown): string {
  const raw = string(value)
  if (!/^\d{4}-\d\d-\d\d \d\d:\d\d:\d\d$/.test(raw)) throw new Error('Choose Chicago: missing UTC datetime')
  const date = new Date(`${raw.replace(' ', 'T')}Z`)
  if (!Number.isFinite(date.getTime()) || date.toISOString().slice(0, 19).replace('T', ' ') !== raw) throw new Error('Choose Chicago: invalid UTC datetime')
  return date.toISOString()
}

function category(value: unknown): Category {
  const names = Array.isArray(value) ? value.map(v => text(row(v).name)).join(' ') : ''
  if (/music|concert/i.test(names)) return 'music'
  if (/art|theat|film|museum/i.test(names)) return 'arts'
  if (/sport/i.test(names)) return 'sports'
  if (/food|drink/i.test(names)) return 'food'
  if (/wellness|fitness/i.test(names)) return 'wellness'
  return 'other'
}

function candidate(e: Record<string, unknown>): Candidate {
  // The live API assigns a separate numeric ID to each recurring occurrence.
  // A date or slug would change when that occurrence is rescheduled or renamed.
  if (!Number.isSafeInteger(e.id) || Number(e.id) <= 0) throw new Error('Choose Chicago: missing occurrence ID')
  const title = text(e.title)
  const source = url(e.url)
  if (!title || !source || new URL(source).origin !== ORIGIN || !new URL(source).pathname.startsWith('/event/')) throw new Error(`Choose Chicago ${e.id}: missing title/detail URL`)
  const start = utc(e.utc_start_date)
  const end = utc(e.utc_end_date)
  if (end < start) throw new Error(`Choose Chicago ${e.id}: end precedes start`)
  if (typeof e.all_day !== 'boolean') throw new Error(`Choose Chicago ${e.id}: missing all-day flag`)
  const fee = text(e.cost) || null
  const venue = row(e.venue)
  return { external_id: String(e.id), related_url: url(e.website) || source, data: {
    title, description: text(e.description) || null, cover_image_url: url(row(e.image).url),
    start_time: start, end_time: end, is_all_day: e.all_day, source_url: source,
    location: ['venue', 'address', 'city', 'state', 'zip'].map(key => text(venue[key])).filter(Boolean).join(', ') || null,
    location_url: url(venue.url), is_free: Boolean(fee && /^(?:free|no charge|no cost|\$?0(?:\.00)?)$/i.test(fee)),
    fee_text: fee, category: category(e.categories), is_cancelled: cancelled(title, string(e.description)),
  } }
}

class SnapshotChanged extends Error {}

export async function fetchChooseChicago(fetchText: FetchText, now = new Date()): Promise<SourceResult> {
  for (let attempt = 0; ; attempt++) {
    try {
      return await fetchSnapshot(fetchText, now, attempt ? `${Date.now()}-${attempt}` : undefined)
    } catch (error) {
      if (!(error instanceof SnapshotChanged) || attempt >= 2) throw error
    }
  }
}

async function fetchSnapshot(fetchText: FetchText, now: Date, cacheKey?: string): Promise<SourceResult> {
  const localDate = (time: number) => new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Chicago', year: 'numeric', month: '2-digit', day: '2-digit' }).format(time)
  const start = `${localDate(now.getTime() - 90 * DAY)} 00:00:00`
  const end = `${localDate(now.getTime() + 365 * DAY)} 23:59:59`
  const first = new URL(`${ORIGIN}${PATH}`)
  first.search = new URLSearchParams({ start_date: start, end_date: end, per_page: '50', status: 'publish', page: '1' }).toString()
  const result: SourceResult = { items: [], warnings: [] }
  const ids = new Set<string>()
  let next: string | null = first.href
  let expectedTotal: number | undefined
  let expectedPages: number | undefined
  let received = 0
  for (let page = 1; next; page++) {
    const target = new URL(next)
    // Validate before handing pagination URLs to the shared network client.
    if (target.origin !== ORIGIN || ![PATH, `${PATH}/`].includes(target.pathname) || target.username || target.password || target.hash ||
        [...target.searchParams.keys()].some(key => !['start_date', 'end_date', 'per_page', 'status', 'page'].includes(key) && !(key === '_' && cacheKey && target.searchParams.getAll('_').length === 1 && target.searchParams.get('_') === cacheKey)) ||
        ['start_date', 'end_date', 'per_page', 'status', 'page'].some(key => target.searchParams.getAll(key).length !== 1) ||
        target.searchParams.get('start_date') !== start || target.searchParams.get('end_date') !== end ||
        target.searchParams.get('per_page') !== '50' || target.searchParams.get('status') !== 'publish' || target.searchParams.get('page') !== String(page)) {
      throw new Error('Choose Chicago: unsafe or inconsistent pagination URL')
    }
    // The API caches each page independently and omits this key from next_rest_url.
    if (cacheKey) target.searchParams.set('_', cacheKey)
    const payload = row(JSON.parse(await fetchText(target.href)))
    const events = payload.events
    const total = payload.total
    const pages = payload.total_pages
    if (!Array.isArray(events) || !Number.isSafeInteger(total) || Number(total) < 0 || !Number.isSafeInteger(pages) || Number(pages) < 0 ||
        Number(pages) !== Math.ceil(Number(total) / 50)) throw new Error('Choose Chicago: invalid pagination metadata')
    if (Number(pages) > 400) throw new Error('Choose Chicago: pagination exceeds 20,000-occurrence safety limit; source not truncated')
    expectedTotal ??= Number(total)
    expectedPages ??= Number(pages)
    if (total !== expectedTotal || pages !== expectedPages) throw new SnapshotChanged('Choose Chicago: collection changed during pagination after bounded retries')
    const expectedLength = Math.min(50, expectedTotal - received)
    if (events.length !== expectedLength) throw new Error('Choose Chicago: incomplete result page')
    for (const raw of events) {
      const e = row(raw)
      if (e.status !== 'publish') throw new Error('Choose Chicago: unexpected publication status')
      received++
      const item = candidate(e)
      if (ids.has(item.external_id)) throw new Error(`Choose Chicago: duplicate occurrence ${item.external_id}`)
      ids.add(item.external_id)
      if (e.hide_from_listings === true) {
        result.warnings.push(`Choose Chicago ${item.external_id}: hidden from listings; not a cancellation`)
        continue
      }
      if (!item.data.cover_image_url) result.warnings.push(`Choose Chicago ${item.external_id}: missing poster`)
      result.items.push(item)
    }
    next = string(payload.next_rest_url) || null
    if ((page < expectedPages) !== Boolean(next)) throw new Error('Choose Chicago: missing or extra pagination link')
  }
  if (received !== expectedTotal) throw new Error('Choose Chicago: incomplete collection')
  return result
}
