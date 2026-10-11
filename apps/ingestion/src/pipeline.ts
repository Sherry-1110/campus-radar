import { setTimeout as delay } from 'node:timers/promises'
import type { SupabaseClient } from '@supabase/supabase-js'
import type { Candidate, FetchText } from './types.ts'

export const PROCESSOR_VERSION = 'shared-v1'
export type RawDocument = { scope: 'feed' | 'original'; request_url: string; response_url: string; body: string }
export function requestKey(raw: string) {
  const u = new URL(raw)
  u.hash = ''
  for (const key of Array.from(u.searchParams.keys())) if (/^_$|^(api[-_]?key|key|token|access_token|signature|sig)$/i.test(key)) u.searchParams.delete(key)
  u.searchParams.sort()
  return u.href
}

export function captureSource(save: (document: RawDocument) => Promise<void>, replay?: RawDocument[]) {
  const records = replay && new Map(replay.map(d => [`${d.scope}:${requestKey(d.request_url)}`, d]))
  let writeError: unknown
  async function read(scope: RawDocument['scope'], url: string, fetcher: () => Promise<{ body: string; url: string }>) {
    const request_url = requestKey(url)
    let document: RawDocument
    if (records) {
      const found = records.get(`${scope}:${request_url}`)
      if (!found) throw new Error(`Replay input not captured: ${scope} ${request_url}`)
      document = found
    } else {
      const fetched = await fetcher()
      document = { scope, request_url, response_url: requestKey(fetched.url), body: fetched.body }
    }
    try { await save(document) } catch (error) { writeError = error; throw error }
    return document
  }
  return {
    check() { if (writeError) throw writeError },
    text(fetcher: FetchText): FetchText { return async url => (await read('feed', url, async () => ({ body: await fetcher(url), url }))).body },
    original(fetcher: (url: string) => Promise<{ html: string; url: string }>) {
      return async (url: string) => { const d = await read('original', url, async () => { const p = await fetcher(url); return { body: p.html, url: p.url } }); return { html: d.body, url: d.response_url } }
    },
  }
}

// Retry only explicit transaction rollbacks. A lost HTTP response may have committed.
export async function pipelineRpc<T>(client: SupabaseClient, name: string, args: Record<string, unknown>, range?: [number, number]): Promise<T> {
  for (let attempt = 0; ; attempt++) {
    const query = client.rpc(name, args)
    const result = await (range ? query.range(...range) : query)
    if (!result.error) return result.data as T
    const code = result.error.code || 'transport_error'
    if (attempt < 2 && ['57014', '40001', '40P01', '55P03'].includes(code)) {
      await delay(250 * 2 ** attempt)
      continue
    }
    const safe = result.error.message === 'Cannot publish capture older than latest successful run' ? result.error.message : code
    throw Object.assign(new Error(`Pipeline ${name}: ${safe}`), { code })
  }
}

export async function writeBatches(source: string, items: Candidate[], write: (source: string, items: Candidate[]) => Promise<Record<string, number>>) {
  const totals: Record<string, number> = {}
  // Atomic per batch; only rolled-back timeouts shrink it. Earlier commits are retained.
  let batchSize = 100
  for (let offset = 0; offset < items.length;) {
    const batch = items.slice(offset, offset + batchSize)
    try {
      const stats = await write(source, batch)
      for (const [key, value] of Object.entries(stats)) totals[key] = (totals[key] ?? 0) + value
      offset += batch.length
    } catch (error) {
      if (error instanceof Error && 'code' in error && error.code === '57014' && batch.length > 1) {
        batchSize = Math.floor(batch.length / 2)
        console.warn(`${source}: database statement timed out; retrying at ${offset} with batches of ${batchSize}`)
        continue
      }
      throw new Error(`${offset} candidates committed; safe to retry. ${error instanceof Error ? error.message : 'Batch failed'}`)
    }
  }
  return totals
}

export async function stageItems(client: SupabaseClient, run: string, items: Candidate[], stage: 'normalized' | 'enriched') {
  await writeBatches(`Stage ${stage}`, items, async (_source, batch) => {
    await pipelineRpc(client, 'stage_source_events', { p_run_id: run, p_items: batch, p_stage: stage })
    return {}
  })
  await pipelineRpc(client, 'complete_source_stage', { p_run_id: run, p_stage: stage, p_count: items.length })
}

export async function cleanupSource(client: SupabaseClient, source: string) {
  let total = 0, batchSize = 100
  // ponytail: bounded maintenance per source; a large backlog resumes next run.
  for (let batch = 0; batch < 500; batch++) {
    try {
      const removed = await pipelineRpc<number>(client, 'prune_source_documents', { p_source_key: source, p_limit: batchSize })
      total += removed
      if (!removed) return total
    } catch (error) {
      if (error instanceof Error && 'code' in error && error.code === '57014' && batchSize > 1) {
        batchSize = Math.max(1, Math.floor(batchSize / 2))
        continue
      }
      throw error
    }
  }
  throw new Error(`Raw cleanup ${source}: maintenance budget reached after ${total} rows; retry next run`)
}
export async function loadReplay(client: SupabaseClient, run: string) {
  const metadata = await pipelineRpc<{ source_key: string; source_name: string; captured_at: string }>(client, 'get_source_pipeline', { p_run_id: run })
  if (!metadata) throw new Error('Pipeline run not found')
  const documents: RawDocument[] = []
  for (let offset = 0; ; offset += 10) {
    const rows = await pipelineRpc<RawDocument[]>(client, 'get_source_documents', { p_run_id: run }, [offset, offset + 9])
    documents.push(...rows)
    if (rows.length < 10) break
  }
  if (!documents.length) throw new Error('Run has no retained raw responses to replay')
  return { ...metadata, documents }
}
