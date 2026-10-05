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

export async function pipelineRpc<T>(client: SupabaseClient, name: string, args: Record<string, unknown>): Promise<T> {
  const result = await client.rpc(name, args)
  if (result.error) {
    const safe = result.error.message === 'Cannot publish capture older than latest successful run' ? result.error.message : result.error.code
    throw new Error(`Pipeline ${name}: ${safe}`)
  }
  return result.data as T
}
export async function stageItems(client: SupabaseClient, run: string, items: Candidate[], stage: 'normalized' | 'enriched') {
  for (let offset = 0; offset < items.length; offset += 100) await pipelineRpc(client, 'stage_source_events', {
    p_run_id: run, p_items: items.slice(offset, offset + 100), p_stage: stage,
  })
  await pipelineRpc(client, 'complete_source_stage', { p_run_id: run, p_stage: stage, p_count: items.length })
}
export async function loadReplay(client: SupabaseClient, run: string) {
  const metadata = await pipelineRpc<{ source_key: string; source_name: string; captured_at: string }>(client, 'get_source_pipeline', { p_run_id: run })
  if (!metadata) throw new Error('Pipeline run not found')
  const documents: RawDocument[] = []
  for (let offset = 0; ; offset += 10) {
    const result = await client.rpc('get_source_documents', { p_run_id: run }).range(offset, offset + 9)
    if (result.error) throw new Error(`Replay read failed: ${result.error.code}`)
    documents.push(...result.data as RawDocument[])
    if (result.data.length < 10) break
  }
  if (!documents.length) throw new Error('Run has no retained raw responses to replay')
  return { ...metadata, documents }
}
