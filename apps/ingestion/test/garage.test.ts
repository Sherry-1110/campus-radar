import assert from 'node:assert/strict'
import test from 'node:test'
import { fetchGarage } from '../src/sources/garage.ts'

const now = new Date('2026-09-20T12:00:00Z')
const event = (extra = '', start = '20260929T180000', end = '20260929T190000') => `BEGIN:VEVENT
UID:family123@addevent.com
SUMMARY:Family Dinner
DESCRIPTION:For Resident Teams Only\\nBring a guest\\, if registered.
DTSTART;TZID=America/Chicago:${start}
DTEND;TZID=America/Chicago:${end}
LOCATION:2311 Campus Dr.\\, Evanston
STATUS:CONFIRMED
${extra}
BEGIN:VALARM
DESCRIPTION:Reminder
END:VALARM
END:VEVENT`
const feed = (...events: string[]) => `BEGIN:VCALENDAR\nVERSION:2.0\n${events.join('\n')}\nEND:VCALENDAR`
const detail = (extra = '') => `<link rel="canonical" href="https://www.addevent.com/event/family123"><meta property="og:title" content="Family Dinner">${extra}`
const fetcher = (ics: string, page = detail()) => async (url: string) => url.endsWith('.ics') ? ics : page

test('Garage expands weekly occurrences through DST, keeps restrictions and stable IDs', async () => {
  const result = await fetchGarage(fetcher(feed(event('RRULE:FREQ=WEEKLY;INTERVAL=2;COUNT=4;BYDAY=TU'))), now)
  assert.equal(result.items.length, 4)
  assert.equal(new Set(result.items.map(item => item.external_id)).size, 4)
  assert.equal(result.items[0]!.data.start_time, '2026-09-29T23:00:00.000Z')
  assert.equal(result.items[3]!.data.start_time, '2026-11-11T00:00:00.000Z')
  assert.match(result.items[0]!.data.description!, /For Resident Teams Only\nBring a guest, if registered\./)
  assert.doesNotMatch(result.items[0]!.data.description!, /Reminder/)
  assert.equal(result.items[0]!.data.location, '2311 Campus Dr., Evanston')
  assert.equal(result.items[0]!.data.is_free, false)
  assert.equal(result.items[0]!.data.cover_image_url, null)
  assert.ok(result.warnings.some(w => /poster/i.test(w)))
})

test('Garage preserves single-event identity on reschedule and explicit cancellation', async () => {
  const first = await fetchGarage(fetcher(feed(event())), now)
  const moved = await fetchGarage(fetcher(feed(event().replace('20260929', '20261001').replace('20260929', '20261001').replace('STATUS:CONFIRMED', 'STATUS:CANCELLED'))), now)
  assert.equal(first.items[0]!.external_id, moved.items[0]!.external_id)
  assert.equal(moved.items[0]!.data.is_cancelled, true)
  assert.notEqual(first.items[0]!.data.start_time, moved.items[0]!.data.start_time)
})

test('Garage honors recurrence exceptions and explicit exclusions', async () => {
  const base = event('RRULE:FREQ=WEEKLY;COUNT=3;BYDAY=TU\nEXDATE;TZID=America/Chicago:20261013T180000')
  const moved = event('RECURRENCE-ID;TZID=America/Chicago:20261006T180000', '20261007T180000', '20261007T190000')
  const result = await fetchGarage(fetcher(feed(base, moved)), now)
  assert.equal(result.items.length, 3)
  assert.equal(result.items[1]!.external_id, 'family123:20261006T180000')
  assert.equal(result.items[1]!.data.start_time, '2026-10-07T23:00:00.000Z')
  assert.equal(result.items[2]!.data.is_cancelled, true)
})

test('Garage accepts cancellation-only exceptions with UTC recurrence identity', async () => {
  const base = event('RRULE:FREQ=WEEKLY;COUNT=2;BYDAY=TU')
  const exception = 'BEGIN:VEVENT\nUID:family123@addevent.com\nRECURRENCE-ID:20261006T230000Z\nSTATUS:CANCELLED\nEND:VEVENT'
  const result = await fetchGarage(fetcher(feed(base, exception)), now)
  assert.equal(result.items[1]!.external_id, 'family123:20261006T180000')
  assert.equal(result.items[1]!.data.is_cancelled, true)
  assert.equal(result.items[1]!.data.title, 'Family Dinner')
})

test('Garage unfolds ICS and uses real posters while ignoring provider generic images', async () => {
  const result = await fetchGarage(fetcher(feed(event().replace('SUMMARY:Family Dinner', 'SUMMARY:Family\r\n Dinner')), detail('<meta property="og:image" content="https://example.org/poster.jpg">')), now)
  assert.equal(result.items[0]!.data.title, 'FamilyDinner')
  assert.equal(result.items[0]!.data.cover_image_url, 'https://example.org/poster.jpg')
  const generic = await fetchGarage(fetcher(feed(event()), detail('<meta property="og:image" content="https://cdn.addevent.com/web/images/opengraph-image.png">')), now)
  assert.equal(generic.items[0]!.data.cover_image_url, null)
})

test('Garage fails malformed, incomplete, unsupported and conflicting data', async () => {
  for (const broken of ['<html>challenge</html>', feed(), feed(event().replace('END:VEVENT', '')), feed(event().replace('20260929T180000', '20260230T180000')), feed(event('', '20260308T023000', '20260308T040000')), feed(event().replace('UID:family123@addevent.com', 'UID:../bad@addevent.com')), feed(event('RRULE:FREQ=MONTHLY;COUNT=3')), feed(event(), event('', '20261001T180000', '20261001T190000'))]) {
    await assert.rejects(fetchGarage(fetcher(broken), now))
  }
})

test('Garage uses inclusive local all-day end without requiring a poster', async () => {
  const allDay = event().replace('DTSTART;TZID=America/Chicago:20260929T180000', 'DTSTART;VALUE=DATE:20261101').replace('DTEND;TZID=America/Chicago:20260929T190000', 'DTEND;VALUE=DATE:20261102')
  const result = await fetchGarage(fetcher(feed(allDay)), now)
  assert.equal(result.items[0]!.data.is_all_day, true)
  assert.equal(result.items[0]!.data.start_time, '2026-11-01T05:00:00.000Z')
  assert.equal(result.items[0]!.data.end_time, '2026-11-02T05:59:59.999Z')
  assert.equal(result.items[0]!.data.cover_image_url, null)
})

test('Garage aborts on failed or unexpected detail pages instead of clearing stored posters', async () => {
  await assert.rejects(fetchGarage(async url => { if (url.endsWith('.ics')) return feed(event()); throw new Error('HTTP 503') }, now), /503/)
  for (const page of ['', '<html>Just a moment: verify you are human</html>', detail().replace('/event/family123', '/event/different'), '<link rel="canonical" href="https://www.addevent.com/event/family123">']) {
    await assert.rejects(fetchGarage(fetcher(feed(event()), page), now), /unexpected event page/i)
  }
})
