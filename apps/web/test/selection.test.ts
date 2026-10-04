import assert from 'node:assert/strict'
import { test } from 'node:test'
import { selectEvent } from '../src/lib/selection.ts'

test('event selection and close preserve the discovery URL context', () => {
  const before = new URLSearchParams('time=weekend&page=2&bounds=41,-88,43,-87')
  const opened = selectEvent(before, 'event-a')
  assert.equal(opened.get('page'), '2')
  assert.equal(opened.get('bounds'), '41,-88,43,-87')
  assert.equal(selectEvent(opened, 'event-b').get('event'), 'event-b')
  assert.equal(selectEvent(opened, null).toString(), before.toString())
})
