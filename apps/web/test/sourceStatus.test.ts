import assert from 'node:assert/strict'
import { test } from 'node:test'
import { sourceStatus } from '../src/lib/sourceStatus.ts'

test('source health distinguishes failures, stalled attempts, and missed nightly runs', () => {
  const now = Date.parse('2026-09-20T12:00:00Z')
  const health = { status: 'succeeded', started_at: '2026-09-20T08:17:00Z', last_success_at: '2026-09-20T08:20:00Z' }
  assert.equal(sourceStatus(true, health, now), 'Healthy')
  assert.equal(sourceStatus(true, { ...health, status: 'failed' }, now), 'Failed')
  assert.equal(sourceStatus(true, { ...health, status: 'running' }, now), 'Stalled')
  assert.equal(sourceStatus(true, { ...health, status: 'running', started_at: '2026-09-20T11:50:00Z' }, now), 'Running')
  assert.equal(sourceStatus(true, health, now + 2 * 86_400_000), 'Overdue')
  assert.equal(sourceStatus(true, undefined, now), 'Awaiting first run')
  assert.equal(sourceStatus(false, health, now), 'Paused')
})
