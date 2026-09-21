import assert from 'node:assert/strict'
import { test } from 'node:test'
import { createSavedStore, isPastEvent, readSavedIds } from '../src/lib/savedEvents.ts'

const id = '00000000-0000-4000-8000-000000000001'
test('saved IDs are validated and blocked storage keeps in-memory saves', () => {
  assert.deepEqual(readSavedIds('{bad'), [])
  assert.deepEqual(readSavedIds(JSON.stringify([id, id, 'bad', null])), [id])
  const store = createSavedStore(() => { throw new Error('blocked') })
  store.toggle(id)
  assert.deepEqual(store.getSnapshot().ids, [id])
  assert.equal(store.getSnapshot().storageError, true)
  store.toggle(id)
  assert.deepEqual(store.getSnapshot().ids, [])
})
test('saved events partition by end time, retaining unknown-end events until local midnight', () => {
  const now = new Date('2026-09-24T01:00:00Z') // Sep 23, 8pm Chicago
  const event = { start_time: '2026-09-23T15:00:00Z', end_time: null, is_all_day: false }
  assert.equal(isPastEvent(event, now), false)
  assert.equal(isPastEvent({ ...event, end_time: '2026-09-24T00:00:00Z' }, now), true)
  assert.equal(isPastEvent(event, new Date('2026-09-24T05:00:00Z')), true)
  assert.equal(isPastEvent({ ...event, is_all_day: true, end_time: '2026-09-24T05:00:00Z' }, now), false)
  assert.equal(isPastEvent({ start_time: '2026-09-23T05:00:00Z', end_time: '2026-09-23T05:00:00Z', is_all_day: true }, now), false)
})
