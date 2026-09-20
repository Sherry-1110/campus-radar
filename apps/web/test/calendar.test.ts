import assert from 'node:assert/strict'
import { test } from 'node:test'
import * as calendar from '../src/lib/calendar.ts'
import { formatWhenLong, formatWhenShort } from '../src/lib/dates.ts'
import type { EventRow } from '../src/lib/events.ts'

test('all-day display and exports preserve the Chicago date across the 25-hour DST day', () => {
  const event = {
    id: 'test', title: 'Exhibition', description: 'Open all day', location: 'Gallery',
    start_time: '2026-11-01T05:00:00.000Z', end_time: '2026-11-02T05:59:59.999Z',
    is_all_day: true, is_cancelled: false,
  } as EventRow
  assert.equal(formatWhenLong(event.start_time, event.end_time, true).time, 'All day')
  assert.match(formatWhenShort(event.start_time, event.end_time, true), /All day/)
  assert.equal(typeof calendar.renderIcs, 'function')
  const ics = calendar.renderIcs(event, 'https://campus-radar.com/events/test')
  assert.match(ics, /DTSTART;VALUE=DATE:20261101/)
  assert.match(ics, /DTEND;VALUE=DATE:20261102/)
  assert.equal(new URL(calendar.googleCalendarUrl(event, 'https://campus-radar.com/events/test')).searchParams.get('dates'), '20261101/20261102')
})

test('cancellation export keeps identity and explicitly records cancellation', () => {
  assert.equal(typeof calendar.renderIcs, 'function')
  const event = {
    id: 'same-id', title: 'Concert, rescheduled', description: null, location: null,
    start_time: '2026-10-02T23:00:00Z', end_time: null, is_all_day: false, is_cancelled: true,
  } as EventRow
  const ics = calendar.renderIcs(event, 'https://campus-radar.com/events/same-id')
  assert.match(ics, /UID:same-id@campus-radar/)
  assert.match(ics, /STATUS:CANCELLED/)
  assert.match(ics, /DTSTART:20261002T230000Z/)
  assert.match(ics, /SUMMARY:Concert\\, rescheduled/)
})
