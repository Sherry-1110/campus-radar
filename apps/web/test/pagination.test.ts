import assert from 'node:assert/strict'
import { test } from 'node:test'
import { parsePage, pageNumbers, pageRange } from '../src/lib/pagination.ts'

test('validates page URLs and fetches non-overlapping twelve-event ranges', () => {
  for (const raw of [null, '', '0', '-1', '1.5', 'oops', '1e3', '9007199254740991']) assert.equal(parsePage(raw), 1)
  assert.equal(parsePage('3'), 3)
  assert.deepEqual(pageRange(1), [0, 11])
  assert.deepEqual(pageRange(2), [12, 23])
  assert.deepEqual(pageRange(3), [24, 35])
})

test('keeps first, last and nearby page links without rendering every page', () => {
  assert.deepEqual(pageNumbers(1, 1), [1])
  assert.deepEqual(pageNumbers(2, 3), [1, 2, 3])
  assert.deepEqual(pageNumbers(50, 100), [1, 49, 50, 51, 100])
  assert.deepEqual(pageNumbers(100, 100), [1, 99, 100])
})
