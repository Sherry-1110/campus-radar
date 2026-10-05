import assert from 'node:assert/strict'
import { test } from 'node:test'
import { summary } from '../worker/summary.ts'

test('the no-JavaScript summary lists each pick once, in Chicago time, with titles escaped', () => {
  const html = summary([
    { id: 'a', title: 'Bank of America Chicago Marathon', start_time: '2026-10-11T05:00:00Z', is_all_day: true, location: null },
    { id: 'b', title: 'Chicago Art Fair', start_time: '2026-10-07T22:00:00Z', is_all_day: false, location: 'THE MART' },
    { id: 'c', title: 'Chicago Art Fair', start_time: '2026-10-08T16:00:00Z', is_all_day: false, location: 'THE MART' },
    { id: 'd', title: '<script>alert(1)</script> & Friends', start_time: '2026-10-09T23:00:00Z', is_all_day: false, location: null },
  ])
  assert.match(html, /^<noscript>[\s\S]*<\/noscript>$/)
  assert.match(html, /<a href="\/events\/a">Bank of America Chicago Marathon<\/a> \(Sun, Oct 11\)/)
  assert.match(html, /<a href="\/events\/b">Chicago Art Fair<\/a> \(Wed, Oct 7, 5:00 PM · THE MART\)/)
  assert.equal(html.match(/Chicago Art Fair/g)!.length, 1)
  assert.ok(!html.includes('<script>'), 'Titles are escaped')
  assert.match(html, /&lt;script&gt;alert\(1\)&lt;\/script&gt; &amp; Friends/)
  assert.ok(!summary([]).includes("This week's picks"), 'No list without picks')
})
