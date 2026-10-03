import assert from 'node:assert/strict'
import { test } from 'node:test'
import { parseGeocoding } from '../src/coordinates.ts'

const result = { placeId: 'test-place', granularity: 'ROOFTOP', types: ['street_address'], postalAddress: { regionCode: 'US' }, location: { latitude: 42.05, longitude: -87.67 } }

test('geocoding accepts a precise unique venue but rejects partial, broad and ambiguous results', () => {
  assert.deepEqual(parseGeocoding({ results: [result] }), { latitude: 42.05, longitude: -87.67, place_id: 'test-place' })
  for (const rows of [[{ ...result, granularity: 'APPROXIMATE' }], [{ ...result, granularity: 'RANGE_INTERPOLATED' }], [result, result], [{ ...result, types: ['locality'] }], [{ ...result, location: { latitude: 100, longitude: -87 } }]]) {
    assert.equal(parseGeocoding({ results: rows }), null)
  }
  assert.equal(parseGeocoding({ results: [] }), null)
  assert.throws(() => parseGeocoding({ error: { status: 'PERMISSION_DENIED' } }), /PERMISSION_DENIED/)
})

// Regression: repeated ingestion must reuse stored coordinates, including across occurrences.
test('ingestion saves shared venue coordinates, reuses them on reruns, and refreshes stale locations', async () => {
  const { createClient } = await import('@supabase/supabase-js')
  const { syncCoordinates } = await import('../src/coordinates.ts')
  const now = new Date('2026-10-03T18:00:00Z')
  const events = [
    { id: 'one', location: 'Venue', region: 'chicago' },
    { id: 'two', location: 'Venue', region: 'chicago' },
    { id: 'online', location: 'Online', region: 'chicago' },
    { id: 'unresolved', location: 'Ambiguous', region: 'chicago' },
  ]
  let stored: Record<string, unknown>[] = []
  let writes = 0, lookups = 0
  const client = createClient('https://example.supabase.co', 'backend-test-key', { auth: { persistSession: false }, global: { fetch: async (input, init) => {
    const url = new URL(String(input))
    if (url.pathname.endsWith('/events')) {
      assert.equal(url.searchParams.get('start_time'), 'gte.2026-10-03T05:00:00.000Z', 'include today’s all-day events')
      assert.equal(url.searchParams.get('order'), 'start_time.asc,id.asc', 'prioritize upcoming venues')
      return Response.json(events)
    }
    assert.ok(url.pathname.endsWith('/event_coordinates'))
    if (init?.method === 'DELETE') {
      stored = stored.filter(row => String(row.expires_at) > now.toISOString())
      return new Response(null, { status: 204 })
    }
    if (init?.method === 'POST') {
      const rows = JSON.parse(String(init.body)) as Record<string, unknown>[]
      for (const row of rows) { stored = stored.filter(old => old.event_id !== row.event_id); stored.push(row); writes++ }
      return new Response(null, { status: 201 })
    }
    return Response.json(stored)
  } } })
  const locate = async (address: string) => { lookups++; return address.startsWith('Ambiguous') ? null : { latitude: 42.05, longitude: -87.67, place_id: 'venue' } }
  const options = { apply: true, limit: 10, key: 'demo-test-key', now }
  const preview = await syncCoordinates(client, { ...options, apply: false }, locate)
  assert.equal(preview.address_requests, 2); assert.equal(writes, 0); assert.equal(lookups, 0)
  const first = await syncCoordinates(client, options, locate)
  assert.equal(first.located, 2); assert.equal(first.unresolved, 2)
  assert.equal(lookups, 2); assert.equal(writes, 2)
  assert.equal(stored[0].expires_at, '2026-11-01T18:00:00.000Z')
  events.push({ id: 'three', location: 'Venue', region: 'chicago' })
  await syncCoordinates(client, options, locate)
  assert.equal(lookups, 3, 'only the unresolved venue is retried')
  assert.equal(writes, 3, 'only the new occurrence needs a coordinate write')
  stored.forEach(row => { row.expires_at = '2026-10-04T06:00:00Z' })
  await syncCoordinates(client, options, locate)
  assert.equal(lookups, 5, 'refresh once per venue before expiry')
  events[0].location = 'Changed venue'
  await syncCoordinates(client, options, locate)
  assert.equal(stored.find(row => row.event_id === 'one')?.coordinate_location, 'Changed venue')
  const limited = await syncCoordinates(client, { ...options, limit: 1 }, async () => { throw new Error('Google Geocoding HTTP 429') })
  assert.equal(limited.located, 3, 'quota failure retains existing pins')
  assert.equal(limited.warning, 'Google Geocoding HTTP 429')
  assert.equal(limited.deferred, 1)
})
