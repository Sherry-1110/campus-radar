import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'
import { fetchDowntownEvanston } from '../src/sources/downtown-evanston.ts'
const fixture = JSON.parse(await readFile(new URL('./fixtures/downtown-evanston.json', import.meta.url), 'utf8'))
const now = new Date('2026-10-05T12:00:00Z')

test('Downtown retains returned recurring instances and converts each Chicago offset', async () => {
  const { items } = await fetchDowntownEvanston(async () => JSON.stringify(fixture), now)
  assert.equal(items.length, 3)
  assert.equal(items[0]!.external_id, '41d7937d-c8c1-4547-ba92-587013be6442')
  assert.equal(items[0]!.data.start_time, '2026-10-06T22:30:00.000Z')
  assert.equal(items[1]!.external_id, '526ca9d4-e21c-490d-bc4b-cbb8587abf28:2026-10-15T19:30:00')
  assert.equal(items[1]!.data.start_time, '2026-10-16T00:30:00.000Z')
  assert.equal(items[2]!.data.start_time, '2026-11-17T01:30:00.000Z')
  assert.equal(items[0]!.data.is_free, false)
  assert.equal(items[0]!.data.fee_text, null)
})

test('Downtown rejects ambiguous/nonexistent local times and does not infer free from zero', async () => {
  const copy = structuredClone(fixture)
  copy.results.features[0].properties.price = 0
  copy.results.features[0].properties.event_status = 'CANCELLED'
  const {items} = await fetchDowntownEvanston(async () => JSON.stringify(copy), now)
  assert.equal(items[0]!.data.is_free, false)
  assert.equal(items[0]!.data.is_cancelled, true)
  for (const start of ['2026-11-01T01:30:00', '2026-03-08T02:30:00']) {
    copy.results.features[0].properties.start_date = start
    await assert.rejects(fetchDowntownEvanston(async () => JSON.stringify(copy), now), /local time/)
  }
})

test('Downtown never follows pagination to an arbitrary host', async () => {
  await assert.rejects(fetchDowntownEvanston(async () => JSON.stringify({...fixture,next:'https://evil.example/private',total_pages:2}), now), /pagination/)
})
