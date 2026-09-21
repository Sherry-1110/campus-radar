import assert from 'node:assert/strict'
import { test } from 'node:test'
import * as geo from '../src/lib/geo.ts'

test('bounds reject invalid URLs and round-trip a geographic rectangle', () => {
  assert.equal(geo.parseBounds('NaN,-88,43,-87'), null)
  assert.equal(geo.parseBounds('43,-88,41,-87'), null)
  assert.equal(geo.parseBounds('41,-181,43,-87'), null)
  assert.equal(geo.parseBounds('41,,43,-87'), null)
  const bounds = { south: 41.7, west: -87.9, north: 42.1, east: -87.5 }
  assert.deepEqual(geo.parseBounds(geo.writeBounds(bounds)), bounds)
  assert.equal(geo.withinBounds({ latitude: 41.7, longitude: -87.9 }, bounds), true)
  assert.equal(geo.withinBounds({ latitude: 42.2, longitude: -87.8 }, bounds), false)
})
