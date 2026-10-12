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
  assert.deepEqual(interpretCategories(response({ music: .99, activities: .5 })), ['music'], 'An uncertain secondary label must not discard a clear primary tag')
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


test('a focused second pass can accept multiple tags without discarding a confident first tag', async () => {
  const event = { title: 'ZooLights', description: 'A holiday light festival with illuminated trails and seasonal attractions.' }
  let calls = 0
  const transport: typeof fetch = async (_input, init) => {
    calls++
    if (calls === 1) return Response.json(response({ activities: .75, fests: .65 }))
    const body = JSON.parse(String(init?.body))
    assert.deepEqual(Object.keys(body.questions), ['activities', 'fests'])
    assert.ok(Object.values(body.questions).every(q => (q as { type: string }).type === 'noul'))
    return Response.json({ model: 'jev-1.13.0', answers: { activities: { type: 'noul', noul: .94 }, fests: { type: 'noul', noul: .92 } } })
  }
  const classified = await classifyEvent(event, 'key', transport)
  assert.deepEqual(classified.categories, ['play', 'market'])
  assert.equal(calls, 2)
  assert.equal((classified.scores.resolution as { type: string }).type, 'multi-label')

  calls = 0
  const withPrimary = await classifyEvent(event, 'key', async () => {
    calls++
    return calls === 1 ? Response.json(response({ activities: .99, fests: .65 }))
      : Response.json({ model: 'jev-1.13.0', answers: { fests: { type: 'noul', noul: .93 } } })
  })
  assert.deepEqual(withPrimary.categories, ['play', 'market'], 'A strong primary tag must not skip review of an uncertain secondary tag')
})

test('independent second-pass uncertainty stays unresolved and malformed answers fail', async () => {
  let calls = 0
  let answer: unknown = { type: 'noul', noul: .6 }
  const transport: typeof fetch = async () => {
    calls++
    return calls % 2 === 1 ? Response.json(response({ activities: .7 }))
      : Response.json({ model: 'jev-1.13.0', answers: { activities: answer } })
  }
  const event = { title: 'Unknown outing', description: '' }
  assert.equal((await classifyEvent(event, 'key', transport)).categories, null)
  assert.equal(calls, 2)
  answer = { type: 'noul', noul: 2 }
  await assert.rejects(classifyEvent(event, 'key', transport), /Invalid Jev/)
  answer = undefined
  await assert.rejects(classifyEvent(event, 'key', transport), /Invalid Jev/)
})
