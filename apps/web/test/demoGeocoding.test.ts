import assert from 'node:assert/strict'
import { test } from 'node:test'
import { demoGeocode } from '../src/lib/demoGeocoding.ts'

test('hosted demo validates requests, shares lookups, handles quota and expires its bounded cache', async () => {
  const originalFetch = globalThis.fetch
  const originalNow = Date.now
  let now = originalNow(), calls = 0, quota = false
  Date.now = () => now
  globalThis.fetch = async (url, init) => {
    calls++
    assert.match(String(url), /^https:\/\/geocode.googleapis.com\/v4\/geocode\/address\//)
    assert.equal(new Headers(init?.headers).get('X-Goog-Api-Key'), 'test-demo-key')
    return quota ? new Response('', { status: 429 }) : Response.json({ results: [{
      placeId: 'venue', types: ['premise'], granularity: 'ROOFTOP',
      postalAddress: { regionCode: 'US' }, location: { latitude: 42.05, longitude: -87.67 },
    }] })
  }
  const request = (address: string, method = 'GET') => new Request(`https://example.com/api/demo/geocode?${new URLSearchParams({ address })}`, { method })
  try {
    assert.equal((await demoGeocode(request('Venue', 'POST'), 'test-demo-key')).status, 405)
    assert.equal((await demoGeocode(request(''), 'test-demo-key')).status, 400)
    assert.equal((await demoGeocode(request('x'.repeat(401)), 'test-demo-key')).status, 400)
    assert.equal((await demoGeocode(request('Venue'), undefined)).status, 503)
    assert.equal(calls, 0)
    const results = await Promise.all([demoGeocode(request('Venue'), 'test-demo-key'), demoGeocode(request('Venue'), 'test-demo-key')])
    assert.equal(calls, 1)
    assert.deepEqual(await results[0].json(), { latitude: 42.05, longitude: -87.67, place_id: 'venue' })
    assert.equal(results[0].headers.get('Cache-Control'), 'no-store')
    quota = true
    assert.equal((await demoGeocode(request('Quota venue'), 'test-demo-key')).status, 429)
    quota = false
    assert.equal((await demoGeocode(request('Quota venue'), 'test-demo-key')).status, 200)
    for (let i = 2; i < 50; i++) assert.equal((await demoGeocode(request(`Venue ${i}`), 'test-demo-key')).status, 200)
    assert.equal((await demoGeocode(request('Overflow'), 'test-demo-key')).status, 429)
    const before = calls
    now += 60 * 60 * 1000 + 1
    assert.equal((await demoGeocode(request('Venue'), 'test-demo-key')).status, 200)
    assert.equal(calls, before + 1)
  } finally { globalThis.fetch = originalFetch; Date.now = originalNow }
})
