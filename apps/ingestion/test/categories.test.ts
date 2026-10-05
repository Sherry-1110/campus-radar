import assert from 'node:assert/strict'
import { test } from 'node:test'
import { categoryRequest, interpretCategories, classifyEvent } from '../src/categories.ts'
import { CATEGORY_GROUPS } from '../../web/src/lib/categoryGroups.ts'

const response = (scores: Record<string, number>) => ({ model: 'jev-1.13.0', answers: Object.fromEntries(CATEGORY_GROUPS.map(g => [g.value, { type: 'noul', noul: scores[g.value] ?? 0.01 }])) })
test('Jev uses the frontend taxonomy, ranks multiple labels, and rejects unsafe responses', async () => {
  assert.deepEqual(Object.keys(categoryRequest({ title: 'Riot Fest', description: 'Live bands at a festival' }).questions), CATEGORY_GROUPS.map(g => g.value))
  assert.deepEqual(interpretCategories(response({ music: .99, fests: .95 })), ['music', 'market'])
  assert.deepEqual(interpretCategories(response({})), ['other'])
  assert.equal(interpretCategories(response({ music: .55 })), null)
  assert.throws(() => interpretCategories({ answers: {} }))
  assert.throws(() => interpretCategories(response({ music: 2 })))
  let calls = 0
  const result = await classifyEvent({ title: 'Concert', description: '' }, 'key', async () => {
    calls++
    return new Response(JSON.stringify(response({ music: .99 })), { status: 200 })
  })
  assert.deepEqual(result?.categories, ['music'])
  assert.equal(calls, 1)
  await assert.rejects(classifyEvent({ title: 'Concert', description: '' }, 'key', async () => new Response('', { status: 401 })), /401/)
})
