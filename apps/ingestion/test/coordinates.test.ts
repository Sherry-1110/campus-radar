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
