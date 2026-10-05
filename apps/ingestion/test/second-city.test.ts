import assert from 'node:assert/strict'
import test from 'node:test'
import { fetchSecondCity, parseSecondCity } from '../src/sources/second-city.ts'

const now = new Date('2026-10-05T12:00:00Z')
const instance = (id: string, date: string, extra = {}) => ({ id, formattedDates: { ISO8601: date }, purchaseUrl: `https://us.tickets.secondcity.com/checkout/${id}?useEmbed=true`, name: 'Performance', saleState: 'onSale', allocations: [{ levels: [{ name: 'General Admission', price: 15, fee: '0' }] }], ...extra })
const show = (instances: unknown[], extra = {}) => ({ id: 'show1', title: 'Sketch &amp; Improv', uri: '/shows/chicago/sketch-chi', showAttributes: { description: '<p>A comedy show.</p>', image: { mediaItemUrl: 'https://platform.secondcity.com/poster.jpg' }, venue: [{ name: "Donny’s Skybox Theater - Chicago" }] }, patronticketData: { patronticketData: Buffer.from(JSON.stringify({ instances })).toString('base64') }, ...extra })
const page = (nodes: unknown[], hasNextPage = false, endCursor: string | null = null) => JSON.stringify({ data: { shows: { nodes, pageInfo: { hasNextPage, endCursor } } } })

test('Second City preserves performance IDs, UTC DST boundaries, and occurrence pricing', () => {
  const rows = [instance('a', '2026-10-31T01:00:00.000Z'), instance('b', '2026-11-02T02:00:00.000Z', { soldOut: 1, saleState: 'notAvailable' })]
  const result = parseSecondCity(page([show(rows)]), now)
  assert.equal(result.items.length, 2)
  assert.equal(result.items[0]!.external_id, 'a')
  assert.equal(result.items[1]!.data.start_time, '2026-11-02T02:00:00.000Z')
  assert.equal(result.items[1]!.data.is_cancelled, false)
  assert.equal(result.items[0]!.data.title, 'Sketch & Improv')
  assert.equal(result.items[0]!.data.fee_text, 'General Admission: $15')
  assert.equal(result.items[0]!.data.is_free, false)
  assert.equal(parseSecondCity(page([show([instance('a', '2026-11-03T02:00:00Z')])]), now).items[0]!.external_id, 'a')
})

test('Second City distinguishes unknown, free, mixed admission and fees without inferring cancellation from sales', () => {
  const date = '2026-10-31T01:00:00Z'
  const rows = [instance('unknown', date, { allocations: [] }), instance('free', date, { allocations: [{ levels: [{ name: 'General', price: 0, fee: 0 }] }] }), instance('mixed', date, { allocations: [{ levels: [{ price: 0 }, { price: 20, fee: 2 }] }] }), instance('fee', date, { allocations: [{ levels: [{ price: 0, fee: 2 }] }] }), instance('cancel', date, { saleStatus: 'Cancelled' })]
  const items = parseSecondCity(page([show(rows)]), now).items
  assert.deepEqual(items.map(x => x.data.is_free), [false, true, false, false, false])
  assert.equal(items[0]!.data.fee_text, null)
  assert.match(items[2]!.data.fee_text!, /\$20 \+ \$2 fee/)
  assert.equal(items[4]!.data.is_cancelled, true)
})

test('Second City fetch follows every cursor and fails closed on pagination loops', async () => {
  let calls = 0
  const result = await fetchSecondCity(async address => {
    const u = new URL(address)
    assert.equal(u.origin, 'https://platform.secondcity.com')
    const query = u.searchParams.get('query')!
    calls++
    return query.includes('after: "next"') ? page([show([instance('b', '2026-10-31T02:00:00Z')])]) : page([show([instance('a', '2026-10-31T01:00:00Z')])], true, 'next')
  }, now)
  assert.equal(calls, 2)
  assert.deepEqual(result.items.map(x => x.external_id), ['a', 'b'])
  await assert.rejects(fetchSecondCity(async () => page([], true, 'loop'), now), /cursor/i)
})

test('Second City rejects malformed schedules and never invents occurrences from show descriptions', () => {
  assert.equal(parseSecondCity(page([show([])]), now).items.length, 0)
  for (const data of ['{}', '{"errors":[{"message":"upstream"}]}', page([show([instance('', '2026-10-31T01:00:00Z')])]), page([show([instance('a', '2026-10-31T01:00:00')])])]) assert.throws(() => parseSecondCity(data, now))
})
