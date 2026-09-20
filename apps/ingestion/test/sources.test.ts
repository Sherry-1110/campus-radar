import assert from 'node:assert/strict'
import test from 'node:test'
import { fetchBienen, fetchPlanItPurple, parseBienen, parsePlanItPurple } from '../src/sources.ts'

const now = new Date('2026-09-20T12:00:00Z')
const xmlEvent = (extra = '') => `<event><title>Art &amp; Music</title><ppurl>https://planitpurple.northwestern.edu/event/42</ppurl><time/><start_datetime>1793509200</start_datetime><end_datetime>1793509200</end_datetime><location>Evanston</location><description_html><![CDATA[<p>Come &amp; enjoy.</p><p>Second paragraph.</p>]]></description_html>${extra}</event>`
const xml = (extra = '') => `<planitpurple>${xmlEvent(extra)}</planitpurple>`
const single = (extra = {}) => ({ nid: [{ value: 12 }], title: [{ value: 'A concert' }], path: [{ alias: '/events/a-concert' }], event_date: [{ value: '2026-10-02T19:30:00-05:00' }], status: [{ value: true }], include_on_calendar: [{ value: true }], repeat_event: [{ value: false }], body: [{ value: '<p>Music &amp; friends.</p>' }], ...extra })
const repeat = (id: number, date: string) => ({ nid: '13', title: 'Opera', path: [{ alias: '/events/opera' }], status: [{ value: true }], repeat_event: [{ value: true }], event_data: { id: [{ value: id }], field_event_date: [{ value: date }], field_detail: [{ value: '<p>Opera</p>' }], field_free_event: [{ value: false }] } })

test('PiP keeps empty cancellation marker, unknown prices/posters, entities and 25-hour all-day DST day', () => {
  const result = parsePlanItPurple(xml('<cancelled/>'))
  const event = result.items[0]!
  assert.equal(event.external_id, '42')
  assert.equal(event.data.is_cancelled, true)
  assert.equal(event.data.is_free, false)
  assert.equal(event.data.fee_text, null)
  assert.equal(event.data.cover_image_url, null)
  assert.equal(event.data.title, 'Art & Music')
  assert.equal(event.data.description, 'Come & enjoy.\n\nSecond paragraph.')
  assert.equal(event.data.start_time, '2026-11-01T05:00:00.000Z')
  assert.equal(event.data.end_time, '2026-11-02T05:59:59.999Z')
  assert.ok(result.warnings.some(w => /poster/i.test(w)))
})

test('PiP rejects malformed XML or incomplete events instead of silently losing them', () => {
  for (const feed of ['<html>error</html>', '<planitpurple>upstream error</planitpurple>', '<planitpurple><event>', '<planitpurple><event><title>Oops</title></event></planitpurple>']) assert.throws(() => parsePlanItPurple(feed))
})

test('PiP fetch merges lookback and full future occurrences without truncation', async () => {
  const result = await fetchPlanItPurple(async url => {
    assert.equal(new URL(url).searchParams.has('max'), false)
    return new URL(url).searchParams.has('archive') ? xml('<cancelled/>') : xml()
  }, now)
  assert.equal(result.items.length, 1)
  assert.equal(result.items[0]!.data.is_cancelled, true)
})

test('Bienen uses stable repeat identities and preserves source DST offsets on reschedule', () => {
  const first = parseBienen(JSON.stringify([repeat(21, '2026-10-30T19:30:00-05:00'), repeat(22, '2026-11-01T19:30:00-06:00')]), now)
  const moved = parseBienen(JSON.stringify([repeat(21, '2026-11-03T19:30:00-06:00')]), now)
  assert.notEqual(first.items[0]!.external_id, first.items[1]!.external_id)
  assert.equal(first.items[0]!.external_id, moved.items[0]!.external_id)
  assert.equal(first.items[0]!.data.start_time, '2026-10-31T00:30:00.000Z')
  assert.equal(first.items[1]!.data.start_time, '2026-11-02T01:30:00.000Z')
})

test('Bienen publication flags never imply cancellation and explicit title does', () => {
  const result = parseBienen(JSON.stringify([single({ status: [{ value: false }] }), single({ nid: [{ value: 14 }], title: [{ value: 'CANCELLED: Recital' }] })]), now)
  assert.equal(result.items.length, 1)
  assert.equal(result.items[0]!.data.is_cancelled, true)
  assert.ok(result.warnings.some(w => /unpublished/i.test(w)))
  assert.equal(result.items[0]!.data.is_free, false)
  assert.equal(result.items[0]!.data.cover_image_url, null)
})

test('Bienen fails malformed records, ambiguous repeat identities and duplicate conflicting IDs', () => {
  assert.throws(() => parseBienen('{}', now))
  assert.throws(() => parseBienen(JSON.stringify([single({ event_date: [] })]), now))
  assert.throws(() => parseBienen(JSON.stringify([single({ repeat_event: [{ value: true }] })]), now))
  assert.throws(() => parseBienen(JSON.stringify([single(), single({ event_date: [{ value: '2026-11-01T19:30:00-06:00' }] })]), now))
})

test('Bienen fetch enriches official detail venue and cancellation without site logo', async () => {
  const result = await fetchBienen(async url => url.includes('event_resource') ? JSON.stringify([single()]) : '<html><meta property="og:image" content="/logo.png"><h1>A concert</h1><div id="event-info"><div class="event-details"><p class="location">Galvin Recital Hall</p><h3>Canceled</h3><p>Music &amp; friends.</p></div></div></html>', now)
  assert.equal(result.items[0]!.data.location, 'Galvin Recital Hall')
  assert.equal(result.items[0]!.data.is_cancelled, true)
  assert.equal(result.items[0]!.data.cover_image_url, null)
})

test('Bienen failed detail fetch fails source instead of overwriting known venue with null', async () => {
  await assert.rejects(fetchBienen(async url => {
    if (url.includes('event_resource')) return JSON.stringify([single()])
    throw new Error('temporary outage')
  }, now), /outage/)
})

test('Bienen matches ticketless repeat details by local datetime without canceling sibling performances', async () => {
  const result = await fetchBienen(async url => url.includes('event_resource') ? JSON.stringify([repeat(21, '2026-10-30T19:30:00-05:00'), repeat(22, '2026-11-01T19:30:00-06:00')]) : '<h1>Opera</h1><div id="event-info"><div class="event-details" data-date="October 30, 2026 at 7:30pm"><p class="location">Hall A</p><h3>Cancelled</h3></div><div class="event-details" data-date="November 1, 2026 at 7:30pm"><p class="location">Hall B</p></div></div>', now)
  assert.equal(result.items[0]!.data.location, 'Hall A')
  assert.equal(result.items[0]!.data.is_cancelled, true)
  assert.equal(result.items[1]!.data.location, 'Hall B')
  assert.equal(result.items[1]!.data.is_cancelled, false)
})

test('Bienen shared ticket links do not mix recurring performance cancellation and venue', async () => {
  const performances = [repeat(21, '2026-10-30T19:30:00-05:00'), repeat(22, '2026-11-01T19:30:00-06:00')]
    .map(e => ({ ...e, event_data: { ...e.event_data, field_ticket_link: [{ uri: 'https://tickets.example/series' }] } }))
  const result = await fetchBienen(async url => url.includes('event_resource') ? JSON.stringify(performances) : '<h1>Opera</h1><div id="event-info"><div class="event-details" data-date="October 30, 2026 at 7:30pm"><p class="location">Hall A</p><h3>Cancelled</h3><a href="https://tickets.example/series">Tickets</a></div><div class="event-details" data-date="November 1, 2026 at 7:30pm"><p class="location">Hall B</p><a href="https://tickets.example/series">Tickets</a></div></div>', now)
  assert.equal(result.items[1]!.data.location, 'Hall B')
  assert.equal(result.items[1]!.data.is_cancelled, false)
})
