import assert from 'node:assert/strict'
import { test } from 'node:test'
import { censusAddress, geocodeCensus } from '../src/census.ts'

test('extracts street addresses without venue names or room numbers and rejects ambiguous locations', () => {
  assert.deepEqual(censusAddress('West Town Chicago Chamber of Commerce, 1363 W Ohio St., Chicago, IL, 60642'), { street: '1363 W Ohio St.', city: 'Chicago', state: 'IL', zip: '60642' })
  assert.deepEqual(censusAddress('Annoyance Theatre, 851 W. Belmont Ave., 2nd Fl., Chicago, 60657'), { street: '851 W. Belmont Ave.', city: 'Chicago', state: 'IL', zip: '60657' })
  assert.equal(censusAddress('360 Chicago, 875 N Michigan Ave, Chicago, IL, 60611')?.street, '875 N Michigan Ave')
  assert.equal(censusAddress('1800 Sherman Avenue, 8th floor, Café, 1800 Sherman Avenue, Evanston, IL, 60201')?.street, '1800 Sherman Avenue')
  assert.equal(censusAddress('Peppa Pig, 5 Woodfield Mall, Schaumburg, 60173')?.zip, '60173')
  for (const address of ['Pick-Staiger, Evanston, IL', 'Online', 'Tour, Chicago, 60601', '100 Main St, New York, NY, 10001', '100 Main St and 200 Other St, Chicago, IL', '100 Main St, 200 Other St, Chicago, IL']) assert.equal(censusAddress(address), null)
})

test('Census returns only a unique matching address in our region, with provider metadata and no API key', async () => {
  const originalFetch = globalThis.fetch
  const match = { matchedAddress: '1363 W OHIO ST, CHICAGO, IL, 60642', addressComponents: { state: 'IL', zip: '60642', city: 'CHICAGO' }, coordinates: { x: -87.661893, y: 41.892436 } }
  let matches: unknown[] = [match], calls = 0
  globalThis.fetch = async (input) => {
    calls++
    const url = new URL(String(input))
    assert.equal(url.hostname, 'geocoding.geo.census.gov')
    assert.equal(url.searchParams.get('street'), '1363 W Ohio St.')
    assert.equal(url.searchParams.has('key'), false)
    return Response.json({ result: { addressMatches: matches } })
  }
  try {
    const address = 'Venue, 1363 W Ohio St., Chicago, IL, 60642'
    assert.deepEqual(await geocodeCensus(address), { latitude: 41.892436, longitude: -87.661893, place_id: null, provider: 'census', matched_address: match.matchedAddress })
    for (const invalid of [[], [match, match], [{ ...match, matchedAddress: '1365 W OHIO ST, CHICAGO, IL, 60642' }], [{ ...match, matchedAddress: '1363 W OHIO AVE, CHICAGO, IL, 60642' }], [{ ...match, coordinates: { x: -80, y: 41 } }], [{ ...match, addressComponents: { state: 'IL', zip: '60201' } }]]) {
      matches = invalid; assert.equal(await geocodeCensus(address), null)
    }
    const before = calls
    assert.equal(await geocodeCensus('Venue only, Chicago, IL'), null)
    assert.equal(calls, before)
  } finally { globalThis.fetch = originalFetch }
})
