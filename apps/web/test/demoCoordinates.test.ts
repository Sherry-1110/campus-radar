import assert from 'node:assert/strict'
import { test } from 'node:test'
import { locateDemoEvents } from '../src/lib/demoCoordinates.ts'

test('demo quota failure preserves located events and stops new lookups', async () => {
  const original = globalThis.fetch
  let calls = 0
  globalThis.fetch = async () => ++calls === 1
    ? Response.json({ latitude: 42.05, longitude: -87.67, place_id: 'venue' })
    : Response.json({ error: 'Google demo geocoding quota reached. Try again later.' }, { status: 429 })
  try {
    const events = ['First venue', 'Second venue', 'Third venue'].map((location, i) => ({ id: String(i), title: location, location, region: 'evanston' }))
    const result = await locateDemoEvents(events as Parameters<typeof locateDemoEvents>[0])
    assert.equal(result.located.length, 1)
    assert.equal(result.deferred, 2)
    assert.match(result.warning, /quota/)
    assert.equal(calls, 2)
  } finally { globalThis.fetch = original }
})
