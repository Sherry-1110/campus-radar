import assert from 'node:assert/strict'
import { test } from 'node:test'
import { nextPage, pageRange } from '../src/lib/pagination.ts'

test('fetches disjoint batches and stops at the end or when results shrink', () => {
  assert.deepEqual(pageRange(1), [0, 11])
  assert.deepEqual(pageRange(2), [12, 23])
  assert.equal(nextPage({ page: 1, total: 25, items: Array(12) }), 2)
  assert.equal(nextPage({ page: 2, total: 25, items: Array(12) }), 3)
  assert.equal(nextPage({ page: 3, total: 25, items: [{}] }), undefined)
  assert.equal(nextPage({ page: 2, total: 24, items: Array(12) }), undefined)
  assert.equal(nextPage({ page: 3, total: 0, items: [] }), undefined)
  assert.equal(nextPage({ page: 3, total: 40, items: [] }), undefined)
})
