import assert from 'node:assert/strict'
import { test } from 'node:test'
import { badgeParts } from '../src/lib/dates.ts'
import {
  ALL_TIMES,
  DEFAULT_FILTERS,
  categoryClause,
  isDefaultFilters,
  matchesNothing,
  parseFilters,
  timeRanges,
  writeFilters,
  ALL_CATEGORIES,
  updateFilterParams,
} from '../src/lib/filters.ts'
import { cardFee } from '../src/lib/fee.ts'
import { eventPageUrl, googleMapsUrl } from '../src/lib/maps.ts'
import { cardPlace, venueName } from '../src/lib/place.ts'

const iso = (d: Date | null) => (d ? d.toISOString() : null)

test('discovery defaults select every category and round-trip through the URL', () => {
  assert.equal(isDefaultFilters(DEFAULT_FILTERS), true)
  assert.equal(writeFilters(DEFAULT_FILTERS).toString(), '')
  assert.deepEqual(parseFilters(new URLSearchParams('')), DEFAULT_FILTERS)
  assert.deepEqual(DEFAULT_FILTERS.time, ['next7'])
  assert.deepEqual(DEFAULT_FILTERS.categories, ALL_CATEGORIES)
  assert.deepEqual(parseFilters(new URLSearchParams('q=lecture')).categories, ALL_CATEGORIES)
  assert.deepEqual(parseFilters(new URLSearchParams('cat=all')).categories, ALL_CATEGORIES)
  assert.deepEqual(parseFilters(writeFilters({ ...DEFAULT_FILTERS, time: ALL_TIMES })).time, ALL_TIMES)
})

test('explicit category choices survive entering and clearing a search', () => {
  const searched = updateFilterParams(new URLSearchParams('cat=all'), { q: 'lecture' })
  const cleared = updateFilterParams(searched, { q: '' })
  assert.deepEqual(parseFilters(cleared).categories, ALL_CATEGORIES)
  const chosen = updateFilterParams(new URLSearchParams(), { categories: DEFAULT_FILTERS.categories })
  assert.deepEqual(parseFilters(updateFilterParams(chosen, { q: 'lecture' })).categories, DEFAULT_FILTERS.categories)
})

test('a partial selection round-trips through the URL', () => {
  const filters = {
    ...DEFAULT_FILTERS,
    scopes: ['nearby' as const],
    regions: ['evanston' as const, 'chicago' as const],
    categories: ['arts' as const, 'sports' as const],
    time: ['custom' as const],
    date: '2026-10-05',
    freeOnly: true,
  }
  const params = writeFilters(filters)
  assert.equal(params.get('from'), 'nearby')
  assert.equal(params.get('loc'), 'evanston,chicago')
  assert.equal(params.get('cat'), 'arts,sports')
  assert.equal(params.get('free'), '1')
  assert.equal(params.get('date'), '2026-10-05')
  assert.deepEqual(parseFilters(params), filters)
})

test('selecting nothing is a distinct state and matches nothing', () => {
  const filters = { ...DEFAULT_FILTERS, scopes: [] }
  const params = writeFilters(filters)
  assert.equal(params.get('from'), 'none')
  assert.deepEqual(parseFilters(params).scopes, [])
  assert.equal(matchesNothing(parseFilters(params)), true)
  assert.equal(matchesNothing(DEFAULT_FILTERS), false)
})

test('unknown or invalid URL values fall back to "All"', () => {
  const parsed = parseFilters(new URLSearchParams('from=mars&time=soon&date=2026-02-31&cat=&loc=nowhere'))
  assert.deepEqual(parsed.scopes, DEFAULT_FILTERS.scopes)
  assert.deepEqual(parsed.time, DEFAULT_FILTERS.time)
  assert.equal(parsed.date, null)
  assert.deepEqual(parsed.categories, DEFAULT_FILTERS.categories)
  assert.deepEqual(parsed.regions, DEFAULT_FILTERS.regions)
})

test('"All" time is open-ended from the start of today (Chicago)', () => {
  // Wed 2026-09-23 10:00 CDT
  const now = new Date('2026-09-23T15:00:00Z')
  const [range, ...rest] = timeRanges({ time: ALL_TIMES, date: null }, now)
  assert.equal(rest.length, 0)
  assert.equal(iso(range.from), '2026-09-23T05:00:00.000Z')
  assert.equal(range.to, null)
})

test('today / this week / this month use Chicago calendar boundaries', () => {
  const now = new Date('2026-09-23T15:00:00Z') // Wednesday
  const one = (t: 'today' | 'week' | 'month') => timeRanges({ time: [t], date: null }, now)[0]
  assert.equal(iso(one('today').to), '2026-09-24T05:00:00.000Z')
  assert.equal(iso(one('week').to), '2026-09-28T05:00:00.000Z') // next Monday 00:00 CDT
  assert.equal(iso(one('month').to), '2026-10-01T05:00:00.000Z')
})

test('the week range ends at Monday 00:00 local time across the DST change', () => {
  // Wed 2026-10-28 noon CDT; DST ends Sun 2026-11-01, so Monday 00:00 is CST (UTC-6).
  const now = new Date('2026-10-28T17:00:00Z')
  const week = timeRanges({ time: ['week'], date: null }, now)[0]
  assert.equal(iso(week.to), '2026-11-02T06:00:00.000Z')
  const month = timeRanges({ time: ['month'], date: null }, now)[0]
  assert.equal(iso(month.to), '2026-11-01T05:00:00.000Z')
})

test('on Sunday, "this week" is just today', () => {
  const now = new Date('2026-09-27T15:00:00Z') // Sunday
  const week = timeRanges({ time: ['week'], date: null }, now)[0]
  assert.equal(iso(week.to), '2026-09-28T05:00:00.000Z')
})

test('overlapping presets merge into the widest range', () => {
  const now = new Date('2026-09-23T15:00:00Z')
  const ranges = timeRanges({ time: ['today', 'week', 'month'], date: null }, now)
  assert.equal(ranges.length, 1)
  assert.equal(iso(ranges[0].to), '2026-10-01T05:00:00.000Z')
})

test('a custom range runs through its last day', () => {
  const now = new Date('2026-10-04T17:00:00Z')
  const [range] = timeRanges({ time: ['custom'], date: '2026-10-10', dateEnd: '2026-10-12' }, now)
  assert.equal(range!.from.toISOString(), '2026-10-10T05:00:00.000Z')
  assert.equal(range!.to!.toISOString(), '2026-10-13T05:00:00.000Z')
  assert.equal(writeFilters({ ...DEFAULT_FILTERS, time: ['custom'], date: '2026-10-10', dateEnd: '2026-10-12' }).get('until'), '2026-10-12')
})

test('a custom date adds its own day; past dates are ignored', () => {
  const now = new Date('2026-09-23T15:00:00Z')
  const future = timeRanges({ time: ['today', 'custom'], date: '2026-10-05' }, now)
  assert.equal(future.length, 2)
  assert.equal(iso(future[1].from), '2026-10-05T05:00:00.000Z')
  assert.equal(iso(future[1].to), '2026-10-06T05:00:00.000Z')

  const past = timeRanges({ time: ['custom'], date: '2026-09-01' }, now)
  assert.deepEqual(past, [])
  assert.deepEqual(timeRanges({ time: ['custom'], date: null }, now), [])
})

test('category groups expand to their database categories', () => {
  assert.deepEqual(categoryClause(ALL_CATEGORIES), { kind: 'all' })
  assert.deepEqual(categoryClause(['arts']), { kind: 'some', dbCategories: ['arts', 'exhibition'] })
  assert.deepEqual(categoryClause(['sports', 'fests']), {
    kind: 'some',
    dbCategories: ['sports', 'market'],
  })
})

test('"Free only" is off by default and is its own URL flag', () => {
  assert.equal(DEFAULT_FILTERS.freeOnly, false)
  assert.equal(parseFilters(new URLSearchParams('free=1')).freeOnly, true)
  assert.equal(parseFilters(new URLSearchParams('free=0')).freeOnly, false)
  assert.equal(writeFilters({ ...DEFAULT_FILTERS, freeOnly: true }).toString(), 'free=1')
  assert.equal(isDefaultFilters({ ...DEFAULT_FILTERS, freeOnly: true }), false)
})

test('card place includes venue and area without repeating identical labels', () => {
  const campus = {
    area: 'campus' as const,
    location: 'Block Museum of Art, Mary and Leigh, 40 Arts Circle Drive, Evanston, IL, 60208',
    neighborhood: null,
    region: 'evanston',
  }
  assert.equal(cardPlace(campus), 'Block Museum of Art · Evanston')

  const nearby = {
    area: 'nearby' as const,
    location: 'The Neo-Futurist Theater, 5153 N. Ashland Ave., Chicago, IL, 60640',
    neighborhood: 'Andersonville',
  }
  assert.equal(cardPlace(nearby), 'The Neo-Futurist Theater · Andersonville')
  assert.equal(cardPlace({ ...nearby, location: 'Andersonville' }), 'Andersonville')
  assert.equal(cardPlace({ ...nearby, neighborhood: null }), 'The Neo-Futurist Theater')
  assert.equal(cardPlace({ area: 'campus', location: 'No Location', neighborhood: null }), null)
  assert.equal(venueName('Online'), 'Online')
  assert.equal(venueName(null), null)
})

test('next seven days and weekend use calendar boundaries across DST and Sundays', () => {
  const next = timeRanges({ time: ['next7'], date: null }, new Date('2026-10-28T17:00:00Z'))[0]
  assert.equal(iso(next.from), '2026-10-28T05:00:00.000Z')
  assert.equal(iso(next.to), '2026-11-04T06:00:00.000Z')
  const weekend = timeRanges({ time: ['weekend'], date: null }, new Date('2026-10-28T17:00:00Z'))[0]
  assert.equal(iso(weekend.from), '2026-10-31T05:00:00.000Z')
  assert.equal(iso(weekend.to), '2026-11-02T06:00:00.000Z')
  const sunday = timeRanges({ time: ['weekend'], date: null }, new Date('2026-11-01T17:00:00Z'))[0]
  assert.equal(iso(sunday.from), '2026-11-01T05:00:00.000Z')
  assert.equal(iso(sunday.to), '2026-11-02T06:00:00.000Z')
})

test('card date badge has a weekday', () => {
  assert.deepEqual(badgeParts('2026-09-24T00:00:00Z'), { month: 'SEP', day: '23', weekday: 'Wed' })
})

test('card fee shows only a clear price: Free, a dollar amount or range, or "Price varies"', () => {
  assert.equal(cardFee({ is_free: true, fee_text: null }), 'Free')
  assert.equal(cardFee({ is_free: false, fee_text: '$46' }), '$46')
  assert.equal(cardFee({ is_free: false, fee_text: '$50 – $171' }), '$50 – $171')
  assert.equal(cardFee({ is_free: false, fee_text: 'Tickets from $12.50 (students $8)' }), '$12.50')
  assert.equal(cardFee({ is_free: false, fee_text: 'Varies by workshops and courses.' }), 'Price varies')
  assert.equal(cardFee({ is_free: false, fee_text: 'Suggested donation' }), null)
  assert.equal(cardFee({ is_free: false, fee_text: 'See website' }), null)
  assert.equal(cardFee({ is_free: false, fee_text: null }), null)
})

test('Google Maps link searches the full address, adding the city for bare venue names', () => {
  const url = (loc: string | null, region: string | null) => {
    const link = googleMapsUrl(loc, region)
    return link ? decodeURIComponent(link.split('query=')[1]) : null
  }
  const base = 'https://www.google.com/maps/search/?api=1&query='
  assert.ok(googleMapsUrl('The Second City, 1616 N. Wells St., Chicago, 60614', 'chicago')?.startsWith(base))
  assert.equal(
    url('The Second City, 1616 N. Wells St., Chicago, 60614', 'chicago'),
    'The Second City, 1616 N. Wells St., Chicago, 60614',
  )
  assert.equal(url('Theater Wit', 'chicago'), 'Theater Wit, Chicago, IL')
  assert.equal(url('Pick-Staiger Concert Hall', 'evanston'), 'Pick-Staiger Concert Hall, Evanston, IL')
  assert.equal(url('United Center, 1901 W Madison St,, Chicago, 60612,', 'chicago'), 'United Center, 1901 W Madison St, Chicago, 60612')
  assert.equal(url('Rosemont Theatre', 'other'), 'Rosemont Theatre')
  assert.match(googleMapsUrl('Café & Bar, 5 Main St', null) ?? '', /query=Caf%C3%A9%20%26%20Bar/)
  assert.equal(googleMapsUrl('Online', 'other'), null)
  assert.equal(googleMapsUrl('No Location', 'other'), null)
  assert.equal(googleMapsUrl(null, 'chicago'), null)
})

test('the event page link prefers a verified organizer page, then "More info", then the listing', () => {
  const listing = 'https://www.choosechicago.com/event/x/'
  assert.equal(
    eventPageUrl({ more_info_url: 'https://organizer.example/', source_url: 'https://organizer.example/e/1' }),
    'https://organizer.example/e/1',
  )
  assert.equal(
    eventPageUrl({ more_info_url: 'https://organizer.example/e/1', source_url: listing }),
    'https://organizer.example/e/1',
  )
  assert.equal(eventPageUrl({ more_info_url: null, source_url: listing }), listing)
  assert.equal(
    eventPageUrl({ more_info_url: null, source_url: 'https://planitpurple.northwestern.edu/event/9' }),
    'https://planitpurple.northwestern.edu/event/9',
  )
  assert.equal(eventPageUrl({ more_info_url: null, source_url: null }), null)
})
