import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { spawnSync } from 'node:child_process'
import test from 'node:test'
import { fetchDo312 } from '../src/sources/do312.ts'

const fixture = readFileSync(new URL('./fixtures/do312-browse.json', import.meta.url), 'utf8')
const now = new Date('2026-11-06T12:00:00Z')
const shell = '<main><div data-card-kind="event"></div></main><script>__sveltekit_example = {};</script>'
const page = () => JSON.parse(fixture) as { nodes: [null, { data: unknown[] }] }

test('Do312 reads redesigned listings without executing scripts and rejects truncated pagination', async () => {
  const requests: string[] = []
  const onePage = page()
  const data = onePage.nodes[1].data
  const root = data[0] as Record<string, number>
  const browse = data[root.browse] as Record<string, number>
  const meta = data[browse._meta] as Record<string, number>
  // Keep the captured first page's 20 rows and make it a complete one-page snapshot.
  data[meta.total] = 20
  data[meta.total_pages] = 1
  data[meta.has_next] = false
  const result = await fetchDo312(async href => {
    requests.push(href)
    return href.includes('__data.json') ? JSON.stringify(onePage) : shell
  }, now, 1)
  assert.equal(requests.length, 2)
  assert.match(requests[1]!, /\/events\/2026\/11\/6\/__data\.json$/)
  assert.equal(result.items.length, 19, 'Exclude the captured multi-day series without inventing a performance')
  const first = result.items[0]!
  assert.equal(first.external_id, '17826738')
  assert.equal(first.data.title, 'Kaskade')
  assert.equal(first.data.start_time, '2026-11-07T04:00:00.000Z')
  assert.equal(first.data.source_url, 'https://do312.com/events/2026/11/6/kaskade-tickets')
  assert.equal(first.data.location, 'Radius')
  assert.equal(first.data.is_free, false, 'No admission price is present in the new listing')
  assert.equal(first.data.fee_text, null)
  assert.equal(first.data.category, 'music')
  assert.match(result.warnings.join(), /series/)
  await assert.rejects(fetchDo312(async href => href.includes('__data.json') ? fixture : shell, now, 1), /pagination/i)
})

test('Do312 rejects malformed structured references and missing source data', async () => {
  const cyclic = page()
  cyclic.nodes[1].data[0] = { browse: 0 }
  await assert.rejects(fetchDo312(async href => href.includes('__data.json') ? JSON.stringify(cyclic) : shell, now, 1), /invalid.*data/i)
  await assert.rejects(fetchDo312(async href => href.includes('__data.json') ? '{"type":"data","nodes":[]}' : shell, now, 1), /missing.*data/i)
})

test('Do312 refuses unsafe source links and dates without an offset in the new feed', async () => {
  for (const [original, replacement, error] of [
    ['/events/2026/11/6/kaskade-tickets', 'https://evil.example/event', /identity/],
    ['2026-11-06T22:00:00-06:00', '2026-11-06T22:00:00', /datetime/],
  ] as const) {
    const malformed = fixture.replace(original, replacement)
    await assert.rejects(fetchDo312(async href => href.includes('__data.json') ? malformed : shell, now, 1), error)
  }
})

test('Do312 drains structured pages and resets pagination on the next day', async () => {
  const second = JSON.parse(readFileSync(new URL('./fixtures/do312-browse-page2.json', import.meta.url), 'utf8')) as ReturnType<typeof page>
  const first = page()
  for (const input of [first, second]) {
    const data = input.nodes[1].data
    const browse = data[(data[0] as Record<string, number>).browse] as Record<string, number>
    const meta = data[browse._meta] as Record<string, number>
    data[meta.total] = 40
    data[meta.total_pages] = 2
    data[meta.has_next] = input === first
  }
  const requests: string[] = []
  const result = await fetchDo312(async href => {
    requests.push(href)
    if (!href.includes('__data.json')) return shell
    return JSON.stringify(new URL(href).searchParams.get('page') === '2' ? second : first)
  }, now, 2)
  assert.deepEqual(requests.slice(1), [
    'https://do312.com/events/2026/11/6/__data.json',
    'https://do312.com/events/2026/11/6/__data.json?page=2',
    'https://do312.com/events/2026/11/7/__data.json',
    'https://do312.com/events/2026/11/7/__data.json?page=2',
  ])
  assert.equal(result.items.length, 39, 'Promoted occurrences across dates keep one stable identity')
})

test('Do312 decodes shared references without expanding them exponentially', () => {
  const input = page(), data = input.nodes[1].data
  let ref = data.push([]) - 1
  for (let n = 0; n < 23; n++) ref = data.push([ref, ref]) - 1
  ;(data[0] as Record<string, number>).shared = ref
  const result = spawnSync(process.execPath, ['--max-old-space-size=96', '--input-type=module', '-e', `
    import {readFileSync} from 'node:fs';
    import {fetchDo312} from ${JSON.stringify(new URL('../src/sources/do312.ts', import.meta.url).href)};
    const body = readFileSync(0, 'utf8');
    try { await fetchDo312(async url => url.includes('__data.json') ? body : ${JSON.stringify(shell)}, new Date('2026-11-06T12:00:00Z'), 1) }
    catch (error) { if (!/pagination/.test(error.message)) throw error }
  `], { input: JSON.stringify(input), encoding: 'utf8', timeout: 10_000 })
  assert.equal(result.status, 0, 'Reference reuse must fit within a bounded heap')
})
