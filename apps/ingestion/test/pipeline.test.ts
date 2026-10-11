import assert from 'node:assert/strict'
import { test } from 'node:test'
import { captureSource, requestKey } from '../src/pipeline.ts'

test('raw capture persists before parsing; replay is offline and strips transport credentials', async () => {
  const saved: unknown[] = []
  const capture = captureSource(async document => { saved.push(document) })
  const fetcher = capture.text(async () => '{"events":[]}')
  assert.equal(await fetcher('https://source.example/feed?page=2&apikey=public-browser-key&_=123'), '{"events":[]}')
  assert.equal(saved.length, 1)
  assert.equal(JSON.stringify(saved).includes('public-browser-key'), false)
  assert.equal(requestKey('https://source.example/feed?_=456&page=2&apikey=changed'), 'https://source.example/feed?page=2')
  let requested = false
  const replay = captureSource(async () => {}, saved as Parameters<typeof captureSource>[1])
  assert.equal(await replay.text(async () => { requested = true; return '' })('https://source.example/feed?page=2&_=new'), '{"events":[]}')
  await assert.rejects(replay.text(async () => '')('https://source.example/missing'), /not captured/)
  assert.equal(requested, false)
  const broken = captureSource(async () => { throw new Error('DB offline') })
  await assert.rejects(broken.text(async () => 'source')('https://source.example'), /DB offline/)
  assert.throws(() => broken.check(), /DB offline/, 'Optional enrichment cannot swallow raw persistence failures')
})

// A rolled-back timeout is safe to retry; transport failures can have committed.
test('pipeline RPC retries only rolled-back database errors and never logs raw transport details', async () => {
  const { createClient } = await import('@supabase/supabase-js')
  const { pipelineRpc } = await import('../src/pipeline.ts')
  let calls = 0
  let code = '57014'
  const client = createClient('https://project.supabase.co', 'test-key', { global: { fetch: async () => {
    calls++
    return calls === 2 ? Response.json('saved') : Response.json({ code, message: 'sensitive upstream payload' }, { status: 500 })
  } } })
  assert.equal(await pipelineRpc(client, 'store_source_document', {}), 'saved')
  assert.equal(calls, 2)
  for (code of ['42501', '']) {
    calls = 0
    await assert.rejects(pipelineRpc(client, 'store_source_document', {}), error => {
      assert.equal(calls, 1)
      assert.doesNotMatch(String(error), /sensitive upstream payload/)
      assert.match(String(error), code ? /42501/ : /transport_error/)
      return true
    })
  }
})

test('staging shrinks timed-out batches and only completes after all candidates are stored', async () => {
  const { createClient } = await import('@supabase/supabase-js')
  const { stageItems } = await import('../src/pipeline.ts')
  const saved: string[] = []
  const items = Array.from({ length: 125 }, (_, n) => ({ external_id: String(n) })) as Parameters<typeof stageItems>[2]
  let completed = false
  const client = createClient('https://project.supabase.co', 'test-key', { global: { fetch: async (input, init) => {
    const args = JSON.parse(String(init?.body))
    if (String(input).endsWith('stage_source_events')) {
      if (args.p_items.length > 25) return Response.json({ code: '57014', message: 'statement timeout' }, { status: 500 })
      saved.push(...args.p_items.map((i: { external_id: string }) => i.external_id))
    } else {
      assert.deepEqual(saved, items.map(i => i.external_id))
      assert.equal(args.p_count, items.length)
      completed = true
    }
    return Response.json(null)
  } } })
  await stageItems(client, 'run', items, 'normalized')
  assert.equal(completed, true)
})
