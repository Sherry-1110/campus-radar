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
