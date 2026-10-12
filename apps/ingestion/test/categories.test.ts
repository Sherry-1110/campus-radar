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


test('borderline labels get one focused second pass; unresolved results never invent a category', async () => {
  const event = { title: 'Dinos!', description: 'Dig for fossils and explore life-size dinosaurs at the zoo.' }
  let calls = 0
  const resolution = { type: 'choice', choice: 'activities', confidence: .93,
    probabilities: { music: .01, arts: .01, sports: .01, activities: .94, fests: .01, parties: .01, other: .01 } }
  const transport: typeof fetch = async (_input, init) => {
    calls++
    const body = JSON.parse(String(init?.body))
    if (calls === 1) return Response.json(response({ activities: .75 }))
    assert.equal(body.questions.resolution.type, 'choice')
    assert.deepEqual(Object.keys(body.questions.resolution.criteria), [...CATEGORY_GROUPS.map(g => g.value), 'other'])
    return Response.json({ model: 'jev-1.13.0', answers: { resolution } })
  }
  const classified = await classifyEvent(event, 'key', transport)
  assert.deepEqual(classified.categories, ['play'])
  assert.equal(calls, 2)
  assert.deepEqual(classified.scores.resolution, resolution)
  calls = 0
  resolution.probabilities.music = 0; resolution.probabilities.sports = 0
  assert.deepEqual((await classifyEvent(event, 'key', transport)).categories, ['play'], 'Rounded probabilities totaling 0.98 are still valid')
  calls = 0
  resolution.choice = 'other'; resolution.confidence = .24
  resolution.probabilities = { music: .1, arts: .1, sports: .1, activities: .2, fests: .1, parties: .1, other: .3 }
  assert.equal((await classifyEvent(event, 'key', transport)).categories, null)
  assert.equal(calls, 2, 'A still-uncertain second pass must stop')
  calls = 0
  resolution.choice = 'unrecognized'
  await assert.rejects(classifyEvent(event, 'key', transport), /Invalid Jev category resolution/)
})
