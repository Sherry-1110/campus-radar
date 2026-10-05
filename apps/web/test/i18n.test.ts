import assert from 'node:assert/strict'
import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { test } from 'node:test'
import { CATEGORY_GROUPS } from '../src/lib/categoryGroups.ts'
import { TIME_OPTIONS } from '../src/lib/filters.ts'
import { ZH } from '../src/lib/zh.ts'

const files = (dir: string): string[] => readdirSync(dir, { withFileTypes: true })
  .flatMap(e => e.isDirectory() ? files(join(dir, e.name)) : /\.tsx?$/.test(e.name) ? [join(dir, e.name)] : [])

test('every text passed to t() and every filter label has a Chinese translation', () => {
  const missing = new Set<string>()
  for (const file of files('src')) {
    for (const [, , text] of readFileSync(file, 'utf8').matchAll(/\bt\((['"])((?:\\.|(?!\1).)*)\1/g)) {
      const key = text!.replace(/\\(['"])/g, '$1')
      if (!(key in ZH)) missing.add(key)
    }
  }
  for (const label of [...CATEGORY_GROUPS.map(g => g.label), ...TIME_OPTIONS.map(o => o.label), 'Free', 'Price varies', 'Saved', 'Today', 'This weekend', 'Explore']) {
    if (!(label in ZH)) missing.add(label)
  }
  assert.deepEqual([...missing], [])
})
