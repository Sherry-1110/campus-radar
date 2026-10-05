import type { FetchText, SourceResult } from '../types.ts'
import { cancelled, deduplicate, description, iso, list, record, string, text, url } from './shared.ts'

const SITE = 'https://www.secondcity.com'
const LISTING = `${SITE}/shows/chicago`

function schedule(json: string) {
  const response = record(JSON.parse(json))
  const shows = record(record(response.data).shows)
  if (response.errors || !Array.isArray(shows.nodes) || typeof record(shows.pageInfo).hasNextPage !== 'boolean') throw new Error('Second City: invalid or incomplete GraphQL schedule')
  return shows
}

export function parseSecondCity(json: string, now = new Date()): SourceResult {
  const result: SourceResult = { items: [], warnings: [] }
  for (const raw of list(schedule(json).nodes)) {
    const show = record(raw)
    const source = url(show.uri, SITE)
    if (!source?.startsWith(`${SITE}/shows/chicago/`)) throw new Error('Second City: non-Chicago or missing show URL')
    const title = text(show.title)
    const attributes = record(show.showAttributes)
    const payload = string(record(show.patronticketData).patronticketData)
    if (!title || !payload) throw new Error(`Second City: missing title or ticket schedule at ${source}`)
    const tickets = record(JSON.parse(Buffer.from(payload, 'base64').toString('utf8')))
    if (!Array.isArray(tickets.instances)) throw new Error(`Second City: missing performance array at ${source}`)
    const venues = list(attributes.venue).map(v => text(record(v).name)).filter(Boolean)
    // The API sometimes lists several theatres without an instance-to-venue mapping.
    const location = venues.length === 1 ? venues[0]! : 'The Second City, Chicago'
    if (venues.length !== 1) result.warnings.push(`Second City ${source}: exact performance venue unavailable`)
    for (const rawInstance of tickets.instances) {
      const performance = record(rawInstance)
      const id = string(performance.id)
      if (!id) throw new Error(`Second City: performance missing stable ID at ${source}`)
      const start = iso(record(performance.formattedDates).ISO8601)
      if (Date.parse(start) < now.getTime() - 90 * 86_400_000) continue
      const levels = list(performance.allocations).flatMap(a => list(record(a).levels)).map(record)
      const prices = levels.flatMap(level => {
        if (level.price === null || level.price === undefined || level.price === '') return []
        const price = Number(level.price)
        if (!Number.isFinite(price) || price < 0) throw new Error(`Second City ${id}: invalid ticket price`)
        const fee = level.fee === null || level.fee === undefined || level.fee === '' ? null : Number(level.fee)
        if (fee !== null && (!Number.isFinite(fee) || fee < 0)) throw new Error(`Second City ${id}: invalid ticket fee`)
        return [{ name: text(level.name), price, fee }]
      })
      const feeText = [...new Set(prices.map(p => `${p.name ? `${p.name}: ` : ''}$${p.price}${p.fee ? ` + $${p.fee} fee` : ''}`))].join('; ') || null
      const registration = url(performance.purchaseUrl)
      const availability = performance.soldOut === 1 ? 'Sold out' : text(performance.onSaleLabel)
      const body = [string(attributes.description), string(performance.detail), availability].filter(Boolean).join('\n\n')
      result.items.push({ external_id: id, related_url: null, listing_url: LISTING, data: {
        title, description: description(body, registration), cover_image_url: url(record(attributes.image).mediaItemUrl),
        start_time: start, end_time: null, location, location_url: null,
        is_free: prices.length > 0 && prices.length === levels.length && prices.every(p => p.price === 0 && p.fee === 0), fee_text: feeText,
        category: 'arts', is_cancelled: cancelled(title, body) || /^cancelled$|^canceled$/i.test(string(performance.saleStatus)),
        is_all_day: false, source_url: source,
      } })
    }
  }
  result.items = deduplicate(result.items)
  return result
}

export async function fetchSecondCity(fetchText: FetchText, now = new Date()): Promise<SourceResult> {
  const result: SourceResult = { items: [], warnings: [] }
  const cursors = new Set<string>()
  let cursor: string | null = null
  do {
    // This is the same public WordPress GraphQL data used by the site's show finder.
    const query = `{ shows(first: 100, ${cursor ? `after: ${JSON.stringify(cursor)}, ` : ''}where: {location: ["chicago"]}) { pageInfo { hasNextPage endCursor } nodes { id title uri patronticketData { patronticketData } showAttributes { showId description image { mediaItemUrl } venue { name } } } } }`
    const endpoint = new URL('https://platform.secondcity.com/graphql')
    endpoint.searchParams.set('query', query)
    const json = await fetchText(endpoint.href)
    const page = parseSecondCity(json, now)
    result.items.push(...page.items)
    result.warnings.push(...page.warnings)
    const info = record(schedule(json).pageInfo)
    cursor = info.hasNextPage ? string(info.endCursor) : null
    if (cursor !== null && (!cursor || cursors.has(cursor))) throw new Error('Second City: missing or repeated pagination cursor')
    if (cursor) cursors.add(cursor)
  } while (cursor)
  result.items = deduplicate(result.items)
  return result
}
