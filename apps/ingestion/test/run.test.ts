import assert from 'node:assert/strict'
import { test } from 'node:test'
import * as runner from '../src/run.ts'

test('runner validates data, reports partial failure, and never writes in dry-run mode', async () => {
  assert.equal(typeof runner.runSync, 'function', 'runSync must exist')
  const item = {
    external_id: '123', related_url: null,
    data: { title: 'Concert', description: 'a'.repeat(5100), cover_image_url: null,
      start_time: '2026-10-03T00:30:00.000Z', end_time: null, location: null, location_url: null,
      is_free: false, fee_text: null, category: 'music' as const, is_cancelled: false,
      is_all_day: false, source_url: 'https://planitpurple.northwestern.edu/event/123' },
  }
  let writes = 0
  const sources = [
    { name: 'PlanItPurple', fetch: async () => ({ items: [item], warnings: [] }) },
    { name: 'Bienen School of Music', fetch: async () => { throw new Error('HTTP 503') } },
  ]
  const apply = async () => { writes++; return { inserted: 1 } }
  const preview = await runner.runSync(sources, null)
  assert.equal(writes, 0)
  assert.equal(preview.sources[0].candidates, 1)
  assert.equal(preview.sources[0].posters, 0)
  assert.equal(preview.sources[0].status, 'preview')
  assert.equal(preview.sources[1].status, 'failed')
  const applied = await runner.runSync(sources, apply)
  assert.equal(writes, 1, 'One failing source must not stop the other')
  assert.equal(applied.sources[0].status, 'applied')
  assert.equal(applied.sources[1].status, 'failed')
  const normalized = runner.normalizeCandidate(item)
  assert.ok(normalized.data.description!.length <= 5000)
  assert.equal(normalized.data.is_free, false)
  assert.throws(() => runner.normalizeCandidate({ ...item, data: { ...item.data, start_time: 'yesterday' } }), /date/i)
  assert.throws(() => runner.normalizeCandidate({ ...item, data: { ...item.data, end_time: '2026-10-01T00:00:00Z' } }), /end/i)
  assert.throws(() => runner.normalizeCandidate({ ...item, data: { ...item.data, cover_image_url: 'javascript:alert(1)' } }), /URL/i)
  const empty = await runner.runSync([{ name: 'PlanItPurple', fetch: async () => ({ items: [], warnings: [] }) }], apply)
  assert.equal(empty.sources[0].status, 'failed')
  assert.equal(writes, 1, 'Empty feed must not call the writer')
})

test('large sources use bounded database transactions and report partial failures honestly', async () => {
  assert.equal(typeof runner.writeBatches, 'function')
  const items = Array.from({ length: 251 }, (_, n) => ({ external_id: String(n) })) as Parameters<typeof runner.writeBatches>[1]
  const committed: string[] = []
  const stats = await runner.writeBatches('PlanItPurple', items, async (_source, batch) => {
    assert.ok(batch.length <= 100, 'No transaction should exceed 100 candidates')
    committed.push(...batch.map(item => item.external_id))
    return { inserted: batch.length, unchanged: 0 }
  })
  assert.equal(stats.inserted, 251)
  assert.deepEqual(committed, items.map(item => item.external_id))
  await assert.rejects(runner.writeBatches('PlanItPurple', items, async (_source, batch) => {
    if (batch[0].external_id === '100') throw new Error('statement timeout')
    return { inserted: batch.length }
  }), /100 candidates committed.*safe to retry.*statement timeout/i)
})


test('monitor records failures independently, skips previews, and detects monitoring failures', async () => {
  const calls: string[] = []
  const monitor = {
    start: async (name: string) => { calls.push(`start:${name}`); return name },
    finish: async (id: string, summary: { status: string; error_code?: string }) => { calls.push(`finish:${id}:${summary.status}:${summary.error_code}`) },
  }
  const sources = [{ name: 'Broken', fetch: async () => { throw new Error('private detail') } }]
  await runner.runSync(sources, null, monitor)
  assert.deepEqual(calls, [], 'Previews must not overwrite production health')
  const report = await runner.runSync(sources, async () => ({}), monitor)
  assert.deepEqual(calls, ['start:Broken', 'finish:Broken:failed:fetch_failed'])
  assert.equal(report.sources[0].status, 'failed')
  const unavailable = await runner.runSync(sources, async () => ({}), {
    start: async () => { throw new Error('monitor unavailable') }, finish: monitor.finish,
  })
  assert.equal(unavailable.sources[0].error_code, 'monitoring_failed')
  const later = await runner.runSync(sources, async () => ({}), {
    start: monitor.start, finish: async () => { throw new Error('database offline') },
  })
  assert.equal(later.sources[0].error_code, 'monitoring_failed')
  assert.match(later.sources[0].error!, /private detail.*Health recording failed/, 'Keep the original failure in private logs')
})


test('network allowlists and source registry keep adapters isolated', async () => {
  const { sources } = await import('../src/registry.ts')
  assert.equal(new Set(sources.map(source => source.id)).size, sources.length)
  await assert.rejects(runner.fetchText('https://www.choosechicago.com/events/', ['planitpurple.northwestern.edu']), /Unapproved/)
})
