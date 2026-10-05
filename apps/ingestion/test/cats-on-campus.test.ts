import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'
import { fetchCatsOnCampus } from '../src/sources/cats-on-campus.ts'

const rows = JSON.parse(await readFile(new URL('./fixtures/cats-on-campus.json', import.meta.url), 'utf8'))
const detail = await readFile(new URL('./fixtures/cats-on-campus.html', import.meta.url), 'utf8')
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
