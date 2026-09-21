import assert from 'node:assert/strict'
import test from 'node:test'
import { fetchChooseChicago } from '../src/sources/choose-chicago.ts'

const now = new Date('2026-09-20T12:00:00Z')
// Small fixture follows the public Tribe API; recurring occurrences have distinct IDs.
const event = (id = 10267502, extra = {}) => ({
  id, status: 'publish', title: 'Art &amp; Music', description: '<p>First paragraph.</p><p>Second.</p>',
  url: `https://www.choosechicago.com/event/a-show/2026-11-01/`,
  website: 'https://organizer.example/show', image: { url: 'https://www.choosechicago.com/uploads/poster.jpg' },
  all_day: true, utc_start_date: '2026-11-01 05:00:00', utc_end_date: '2026-11-02 05:59:59',
  cost: '', venue: { venue: 'Theatre', address: '24 W. Randolph St.', city: 'Chicago', url: 'https://www.choosechicago.com/venue/theatre/' },
  categories: [{ name: 'Theatre &amp; Performing Arts' }], ...extra,
})
const response = (events: unknown[], extra = {}) => JSON.stringify({ events, total: events.length, total_pages: Math.ceil(events.length / 50), ...extra })

test('visits the listing to discover More info when the API omits its website', async () => {
  const result=await fetchChooseChicago(async()=>response([event(1,{website:''})]),now)
  assert.equal(result.items[0].related_url,result.items[0].data.source_url)
})

test('Choose Chicago preserves occurrence IDs, source poster, UTC DST dates, text, and conservative fees', async () => {
  const result = await fetchChooseChicago(async () => response([event(), event(2, { cost: 'Free' }), event(3, { cost: 'Free with paid admission', image: false })]), now)
  assert.equal(result.items[0]!.external_id, '10267502')
  assert.deepEqual(result.items.map(e => e.data.is_free), [false, true, false])
  const data = result.items[0]!.data
  assert.equal(data.title, 'Art & Music')
  assert.equal(data.description, 'First paragraph.\n\nSecond.')
  assert.equal(data.start_time, '2026-11-01T05:00:00.000Z')
  assert.equal(data.end_time, '2026-11-02T05:59:59.000Z')
  assert.equal(data.cover_image_url, 'https://www.choosechicago.com/uploads/poster.jpg')
  assert.equal(data.location, 'Theatre, 24 W. Randolph St., Chicago')
  assert.equal(data.category, 'arts')
  assert.equal(data.is_cancelled, false)
  assert.equal(result.items[0]!.related_url, 'https://organizer.example/show')
  assert.match(result.warnings.join(' '), /missing poster/)
  const moved = await fetchChooseChicago(async () => response([event(10267502, { utc_start_date: '2026-11-02 06:00:00', utc_end_date: '2026-11-03 05:59:59' })]), now)
  assert.equal(moved.items[0]!.external_id, result.items[0]!.external_id)
})

test('Choose Chicago reads every page within the explicit lookback/future window', async () => {
  const urls: string[] = []
  const result = await fetchChooseChicago(async value => {
    urls.push(value)
    const url = new URL(value)
    assert.equal(url.searchParams.get('start_date'), '2026-06-22 00:00:00')
    assert.equal(url.searchParams.get('end_date'), '2027-09-20 23:59:59')
    if (url.searchParams.get('page') === '1') {
      url.pathname += '/'
      url.searchParams.set('page', '2')
      return response(Array.from({ length: 50 }, (_, i) => event(i + 1)), { total: 51, total_pages: 2, next_rest_url: url.href })
    }
    return response([event(51)], { total: 51, total_pages: 2 })
  }, now)
  assert.equal(urls.length, 2)
  assert.equal(result.items.length, 51)
  assert.equal(new Set(result.items.map(i => i.external_id)).size, 51)
})

test('Choose Chicago rejects unsafe pagination before fetching and fails truncation/drift/loops', async () => {
  for (const transform of [
    (u: URL) => { u.hostname = 'untrusted.example' },
    (u: URL) => { u.pathname = '/wp-json/users' },
    (u: URL) => { u.searchParams.set('page', '1') },
    (u: URL) => { u.searchParams.set('end_date', '2030-01-01') },
    (u: URL) => { u.searchParams.append('page', '3') },
  ]) {
    let calls = 0
    await assert.rejects(fetchChooseChicago(async value => {
      calls++
      const u = new URL(value)
      u.searchParams.set('page', '2')
      transform(u)
      return response(Array.from({ length: 50 }, (_, i) => event(i + 1)), { total: 51, total_pages: 2, next_rest_url: u.href })
    }, now), /pagination URL/)
    assert.equal(calls, 1)
  }
  await assert.rejects(fetchChooseChicago(async () => response([event()], { total: 20_001, total_pages: 401 }), now), /safety limit/)
  await assert.rejects(fetchChooseChicago(async () => response([event()], { total: 51, total_pages: 2 }), now), /incomplete/)
  await assert.rejects(fetchChooseChicago(async () => response(Array.from({ length: 50 }, (_, i) => event(i + 1)), { total: 51, total_pages: 2 }), now), /missing or extra/)
  let calls = 0
  await assert.rejects(fetchChooseChicago(async value => {
    if (++calls === 2) return response([event(51)], { total: 52, total_pages: 2 })
    const u = new URL(value)
    u.searchParams.set('page', '2')
    return response(Array.from({ length: 50 }, (_, i) => event(i + 1)), { total: 51, total_pages: 2, next_rest_url: u.href })
  }, now), /changed/)
})

test('Choose Chicago cancellation requires explicit markers; hidden/absent is not cancelled', async () => {
  const result = await fetchChooseChicago(async () => response([
    event(1, { title: 'Cancelled: Show' }), event(2, { description: '<strong>Canceled</strong>' }),
    event(3, { description: '<p>Cancel your booking any time.</p>' }), event(4, { hide_from_listings: true }),
  ]), now)
  assert.deepEqual(result.items.map(i => i.data.is_cancelled), [true, true, false])
  assert.match(result.warnings.join(' '), /not a cancellation/)
  assert.deepEqual((await fetchChooseChicago(async () => response([]), now)).items, [])
})

test('Choose Chicago source errors and malformed or duplicate records fail the whole fetch', async () => {
  for (const body of ['<html>Error</html>', '{}', response([event(1, { utc_start_date: '2026-02-30 05:00:00' })]), response([event(1, { id: null })]), response([event(), event()])]) {
    await assert.rejects(fetchChooseChicago(async () => body, now))
  }
  await assert.rejects(fetchChooseChicago(async () => { throw new Error('network failed') }, now), /network failed/)
})
