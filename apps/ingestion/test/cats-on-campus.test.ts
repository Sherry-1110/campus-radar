import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'
import { fetchCatsOnCampus } from '../src/sources/cats-on-campus.ts'

const rows = JSON.parse(await readFile(new URL('./fixtures/cats-on-campus.json', import.meta.url), 'utf8'))
const detail = await readFile(new URL('./fixtures/cats-on-campus.html', import.meta.url), 'utf8')
const shell = await readFile(new URL('./fixtures/cats-on-campus-shell.html', import.meta.url), 'utf8')
const calendar = await readFile(new URL('./fixtures/cats-on-campus.ics', import.meta.url), 'utf8')
const migratedRows = JSON.parse(await readFile(new URL('./fixtures/cats-on-campus-migrated.json', import.meta.url), 'utf8'))
const fetcher = async (address: string) => {
  const url = new URL(address)
  if (url.pathname.includes('mobile_events_list')) return JSON.stringify(url.searchParams.get('range') === '0' ? rows : [])
  const id = url.searchParams.get('id')
  if (id === '376563') return detail
  return detail.replaceAll('MCC Monday', id === '376637' ? '(FREE FOOD!) NU Quizbowl Trivia Night' : 'Sunday Practice')
    .replaceAll('2026-10-05T15:00:00-05:00', id === '376637' ? '2026-10-05T18:30:00-05:00' : '2026-11-01T15:00:00-06:00')
    .replaceAll('2026-10-05T17:00:00-05:00', id === '376637' ? '2026-10-05T21:00:00-05:00' : '2026-11-01T17:00:00-06:00')
}

test('Cats preserves occurrence IDs, source offsets, unknown admission and hidden locations', async () => {
  const { items } = await fetchCatsOnCampus(fetcher)
  assert.equal(items.length, 3)
  assert.equal(items[0]!.external_id, '376563')
  assert.equal(items[0]!.data.start_time, '2026-10-05T20:00:00.000Z')
  assert.equal(items[0]!.data.location, null)
  assert.equal(items[0]!.data.is_free, true)
  assert.match(items[0]!.data.description!, /Block Printing Workshop/)
  assert.equal(items[1]!.data.is_free, false)
  assert.equal(items[1]!.data.fee_text, null)
  assert.equal(items[2]!.data.start_time, '2026-11-01T21:00:00.000Z')
})

test('Cats fails visibly on malformed listing or missing timezone in detail', async () => {
  await assert.rejects(fetchCatsOnCampus(async () => '{}'), /listing/)
  await assert.rejects(fetchCatsOnCampus(async address => (await fetcher(address)).replaceAll('15:00:00-05:00', '15:00:00')), /datetime/)
})

test('Cats accepts the publisher’s escaped HTML entities without changing event dates', async () => {
  const {items} = await fetchCatsOnCampus(async address => (await fetcher(address)).replace('Join us for a Block Printing Workshop.', String.raw`\&quot;Workshop\&quot;`))
  assert.match(items[0]!.data.description!, /^"Workshop"/)
  assert.equal(items[0]!.data.start_time, '2026-10-05T20:00:00.000Z')
})

test('Cats continues past sparse public pages and rejects a repeated page', async () => {
  const {items} = await fetchCatsOnCampus(async address => {
    const url = new URL(address)
    if (!url.pathname.includes('mobile_events_list')) return fetcher(address)
    return JSON.stringify(url.searchParams.get('range') === '0' ? [rows[0]] : url.searchParams.get('range') === '100' ? [rows[2]] : [])
  })
  assert.deepEqual(items.map(item => item.external_id), ['376563', '376726'])
  await assert.rejects(fetchCatsOnCampus(async () => JSON.stringify(rows)), /repeated pagination/)
})

const migratedFetcher = async (address: string) => {
  const url = new URL(address)
  if (url.pathname.includes('mobile_events_list')) return JSON.stringify(url.searchParams.get('range') === '0' ? [...migratedRows, ...rows] : [])
  if (url.pathname.endsWith('.ics')) return calendar
  return shell
}

test('Cats uses the public calendar when detail pages migrate to the app shell', async () => {
  const {items, warnings} = await fetchCatsOnCampus(migratedFetcher)
  assert.deepEqual(items.map(item => item.external_id), ['376923', '376563', '376637', '376726'])
  assert.equal(items[0]!.data.title, 'Snapshot! - Fall Photo Contest')
  assert.equal(items[0]!.data.start_time, '2026-10-07T18:00:00.000Z')
  assert.equal(items[0]!.data.end_time, '2026-11-21T05:55:00.000Z')
  assert.match(items[0]!.data.description!, /Submit our midwestern fall themed photos/)
  assert.equal(items[0]!.data.is_free, false)
  assert.equal(items[0]!.data.fee_text, null)
  assert.match(items[0]!.data.cover_image_url!, /Groupcover_photo/)
  assert.equal(items[1]!.data.location, null)
  assert.equal(items[1]!.data.is_free, true)
  assert.ok(warnings.some(warning => /376563.*location requires sign-in/.test(warning)))
  assert.equal(items[1]!.data.start_time, '2026-10-05T20:00:00.000Z')
  assert.equal(items[3]!.data.start_time, '2026-11-01T21:00:00.000Z')
})

test('Cats unfolds calendar text and preserves explicit cancellations', async () => {
  const {items} = await fetchCatsOnCampus(async address => (await migratedFetcher(address))
    .replace('SUMMARY;ENCODING=QUOTED-PRINTABLE:Snapshot! - Fall Photo Contest', 'STATUS:CANCELLED\r\nSUMMARY;ENCODING=QUOTED-PRINTABLE:Snapshot! - Fall \r\n Photo Contest')
    .replace('Submit our midwestern fall themed photos', String.raw`Photos\, prints\; art\\craft\nSubmit photos`))
  assert.equal(items[0]!.data.title, 'Snapshot! - Fall Photo Contest')
  assert.match(items[0]!.data.description!, /Photos, prints; art\\craft\nSubmit photos/)
  assert.equal(items[0]!.data.is_cancelled, true)
})

test('Cats refuses incomplete calendars, ambiguous IDs, and unsupported dates', async () => {
  for (const [before, after, message] of [
    ['END:VCALENDAR', '', /calendar/],
    ['rsvp?id=376923\n', 'rsvp?id=999999\n', /376923.*calendar/],
    ['rsvp?id=376923\n', 'rsvp?id=376563\n', /duplicate.*376563/],
    ['20261007T180000Z', '20261007T180000', /datetime/],
    ['20261007T180000Z', '20260230T180000Z', /datetime/],
    ['DTSTART:20261007T180000Z', 'RRULE:FREQ=WEEKLY\nDTSTART:20261007T180000Z', /recurrence/],
  ] as const) {
    await assert.rejects(fetchCatsOnCampus(async address => (await migratedFetcher(address)).replace(before, after)), message)
  }
})

test('Cats still rejects a challenged or unrecognized detail page', async () => {
  await assert.rejects(fetchCatsOnCampus(async address => new URL(address).pathname.includes('mobile_events_list')
    ? migratedFetcher(address) : '<html><title>Just a moment...</title><div id="root"></div></html>'), /missing public Event data/)
})
