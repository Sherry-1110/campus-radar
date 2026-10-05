import { appendFile, writeFile } from 'node:fs/promises'
import { parseArgs } from 'node:util'
import { setTimeout as delay } from 'node:timers/promises'
import { captureSource, loadReplay, pipelineRpc, PROCESSOR_VERSION, stageItems } from './pipeline.ts'
import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import { storePosters } from './posters.ts'
import { enrichSource } from './enrichment.ts'
import { fetchOriginal } from './original-fetch.ts'
import { createJev } from './semantic.ts'
import { evaluateJev } from './semantic-eval.ts'
import { sources as registry } from './registry.ts'
import type { Candidate, SourceResult } from './types.ts'

interface Source { name: string; fetch: () => Promise<SourceResult> }
type Apply = (source: string, items: Candidate[]) => Promise<Record<string, number>>
export interface SourceSummary {
  name: string
  status: 'preview' | 'applied' | 'failed'
  candidates: number
  posters: number
  cancellations: number
  warnings: string[]
  details?: SourceResult['details']
  semantic?: SourceResult['semantic']
  changes?: Record<string, number>
  error?: string
  error_code?: 'fetch_failed' | 'validation_failed' | 'sync_failed' | 'monitoring_failed'
}
interface Monitor {
  start: (source: string) => Promise<string>
  finish: (runId: string, summary: SourceSummary) => Promise<void>
}

const fields = ['title', 'description', 'cover_image_url', 'start_time', 'end_time', 'location',
  'location_url', 'is_free', 'fee_text', 'category', 'is_cancelled', 'is_all_day', 'source_url'] as const
const categories = ['arts', 'music', 'sports', 'academic', 'career', 'social', 'wellness', 'food', 'other']

export function normalizeCandidate(item: Candidate): Candidate {
  if (!item.external_id || item.external_id.length > 200) throw new Error('Invalid source identity')
  if (!item.data || fields.some(key => !Object.hasOwn(item.data, key))) throw new Error('Incomplete event fields')
  const data = { ...item.data }
  if (typeof data.title !== 'string' || !data.title.trim()) throw new Error('Missing event title')
  for (const key of ['is_free', 'is_cancelled', 'is_all_day'] as const) {
    if (typeof data[key] !== 'boolean') throw new Error(`Invalid ${key}`)
  }
  if (!categories.includes(data.category)) throw new Error('Invalid event category')
  for (const [key, limit] of [['title', 200], ['description', 5000], ['location', 300], ['fee_text', 100]] as const) {
    const value = data[key]
    if (value !== null && typeof value !== 'string') throw new Error(`Invalid ${key}`)
    if (value !== null) data[key] = value.trim().length > limit ? `${value.trim().slice(0, limit - 1)}…` : value.trim()
  }
  for (const key of ['start_time', 'end_time'] as const) {
    if (data[key] === null && key === 'end_time') continue
    if (typeof data[key] !== 'string' || !/(?:Z|[+-]\d\d:\d\d)$/.test(data[key]!) || !Number.isFinite(Date.parse(data[key]!))) {
      throw new Error(`Invalid event date: ${key}`)
    }
    data[key] = new Date(data[key]!).toISOString()
  }
  if (data.end_time && data.end_time < data.start_time) throw new Error('Event end precedes start')
  for (const value of [data.source_url, data.cover_image_url, data.location_url, item.related_url, item.listing_url ?? null]) {
    if (value === null) continue
    const parsed = new URL(value)
    if (!['https:', 'http:'].includes(parsed.protocol) || parsed.username || parsed.password) throw new Error('Invalid event URL')
  }
  if (!data.source_url) throw new Error('Missing source URL')
  return { external_id: item.external_id, related_url: item.related_url, listing_url: item.listing_url ?? item.data.source_url, ...(item.enrichment ? { enrichment: item.enrichment } : {}), ...(item.semantic ? {semantic:item.semantic}:{}), data }
}

// Bounded, credential-free fetching of configured publisher sites only.
// Redirects are checked before following; feed content never chooses arbitrary hosts.
export async function fetchText(url: string, hosts = ['planitpurple.northwestern.edu', 'www.music.northwestern.edu']): Promise<string> {
  let last: unknown
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      let target = new URL(url)
      for (let redirects = 0; redirects < 5; redirects++) {
        if (target.protocol !== 'https:' || !hosts.includes(target.hostname)
          || target.username || target.password || target.port) throw new Error('Unapproved source URL')
        const response = await fetch(target, {
          headers: { 'User-Agent': 'CampusRadar/1.0 (+https://campus-radar.com)', Accept: 'application/json, application/xml, text/html;q=0.9' },
          redirect: 'manual', signal: AbortSignal.timeout(60_000),
        })
        if ([301, 302, 303, 307, 308].includes(response.status)) {
          const location = response.headers.get('location')
          await response.body?.cancel()
          if (!location) throw new Error('Source redirect missing location')
          target = new URL(location, target)
          continue
        }
        if (!response.ok) { await response.body?.cancel(); throw new Error(`Source HTTP ${response.status}`) }
        const chunks: Uint8Array[] = []
        let size = 0
        for await (const chunk of response.body!) {
          size += chunk.length
          if (size > 32 * 1024 * 1024) throw new Error('Source exceeds 32 MB; split fetch window before retrying')
          chunks.push(chunk)
        }
        return Buffer.concat(chunks).toString('utf8')
      }
      throw new Error('Too many source redirects')
    } catch (error) { last = error }
    if (attempt < 2) await delay(1000 * 2 ** attempt)
  }
  throw last
}

export async function runSync(sources: Source[], apply: Apply | null, monitor?: Monitor) {
  const summaries: SourceSummary[] = []
  for (const source of sources) {
    const summary: SourceSummary = { name: source.name, status: 'failed', candidates: 0, posters: 0, cancellations: 0, warnings: [] }
    let runId: string | undefined
    let phase: SourceSummary['error_code'] = 'monitoring_failed'
    try {
      if (apply && monitor) runId = await monitor.start(source.name)
      phase = 'fetch_failed'
      const result = await source.fetch()
      phase = 'validation_failed'
      const items = result.items.map(normalizeCandidate)
      if (!items.length) throw new Error('Refusing empty source snapshot')
      if (new Set(items.map(item => item.external_id)).size !== items.length) throw new Error('Duplicate source IDs')
      summary.details = result.details
      summary.semantic = result.semantic
      summary.candidates = items.length
      summary.posters = items.filter(item => item.data.cover_image_url).length
      summary.cancellations = items.filter(item => item.data.is_cancelled).length
      // Summarize missing images by count; retain actionable parsing/access warnings.
      summary.warnings = result.warnings.filter(warning => !warning.includes('missing poster'))
      phase = 'sync_failed'
      if (apply) summary.changes = await apply(source.name, items)
      summary.status = apply ? 'applied' : 'preview'
    } catch (error) {
      // Never log HTTP request objects, auth headers, or raw source payloads.
      summary.error = error instanceof Error ? error.message : 'Source sync failed'
      summary.error_code = phase
    }
    if (runId && monitor) {
      try { await monitor.finish(runId, summary) } catch (error) {
        summary.status = 'failed'
        summary.error_code = 'monitoring_failed'
        summary.error = `${summary.error ? `${summary.error}; ` : ''}Health recording failed: ${error instanceof Error ? error.message : 'unknown error'}`
      }
    }
    summaries.push(summary)
    console.log(`${source.name}: ${summary.status}; ${summary.candidates} events, ${summary.posters} with posters${summary.error ? `; ${summary.error}` : ''}`)
  }
  return { completed_at: new Date().toISOString(), mode: apply ? 'apply' : 'dry-run', sources: summaries }
}

export async function writeBatches(source: string, items: Candidate[], write: Apply) {
  const totals: Record<string, number> = {}
  // ponytail: atomic per batch; the workflow result records whole-source
  // success. A failed later batch leaves safe, idempotently resumable progress.
  let batchSize = 100
  for (let offset = 0; offset < items.length;) {
    const batch = items.slice(offset, offset + batchSize)
    try {
      const stats = await write(source, batch)
      for (const [key, value] of Object.entries(stats)) totals[key] = (totals[key] ?? 0) + value
      offset += batch.length
    } catch (error) {
      // PostgreSQL canceled and rolled back this transaction. Retry fewer items,
      // keeping earlier commits and leaving permanent/ambiguous failures visible.
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

async function enrich(base: SourceResult, fetchPage: typeof fetchOriginal, now: Date) {
  const mode = process.env.JEV_MODE
  if (!['shadow', 'apply'].includes(mode || '') || !base.items.some(i => i.related_url)) return enrichSource(base, fetchPage, now)
  const options = { key: process.env.TYPESAFE_API_KEY || '', cacheDir: '.jev-cache' }
  const evaluation = await evaluateJev(createJev({ ...options, maxRequests: 12 }))
  console.log(JSON.stringify({ semantic_evaluation: evaluation }))
  const jev = createJev(options)
  const result = await enrichSource(base, fetchPage, now, evaluation.passed ? { mode: mode as 'shadow' | 'apply', select: jev.select } : undefined)
  if (!evaluation.passed && mode === 'apply') for (const item of result.items) if (item.enrichment) item.enrichment.status = 'unavailable'
  result.semantic = { mode: mode!, evaluation_passed: evaluation.passed, stats: jev.stats, samples: result.items.flatMap(i => (i.semantic || []).map(a => ({ external_id: i.external_id, title: i.data.title, outcome: a.outcome, relationship: a.relationship, selected_text: (a.selected_text || []).slice(0, 4).map(text => text.slice(0, 800)) }))).slice(0, 30) }
  if (!evaluation.passed) result.warnings.push('Jev evaluation failed or API key unavailable; semantic enrichment disabled, calendar and rule-based updates continued')
  if (jev.stats.failed || jev.stats.deferred) result.warnings.push(`Jev: ${jev.stats.failed} unavailable and ${jev.stats.deferred} budget-deferred decisions; previous enrichment retained where possible`)
  return result
}

async function main() {
  const { values } = parseArgs({ options: {
    apply: { type: 'boolean', default: false }, 'dry-run': { type: 'boolean', default: false },
    replay: { type: 'string' }, source: { type: 'string', default: 'all' }, report: { type: 'string', default: 'sync-report.json' },
  } })
  if (values.apply && values['dry-run']) throw new Error('Choose --apply or --dry-run')
  if (!['all', ...registry.map(source => source.id)].includes(values.source)) throw new Error('Unknown --source')
  let apply: Apply | null = null
  let monitor: Monitor | undefined
  const clock = new Date()
  const runIds = new Map<string, string>()
  let client: SupabaseClient | undefined
  let replay: Awaited<ReturnType<typeof loadReplay>> | undefined
  if (values.apply || values.replay) {
    const url = process.env.SUPABASE_URL
    const key = process.env.SUPABASE_SECRET_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY
    if (!url || !key) throw new Error('Apply requires SUPABASE_URL and a backend Supabase secret')
    if (key.startsWith('sb_publishable_')) throw new Error('A publishable key cannot run the importer')
    client = createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } })
    if (values.replay) {
      replay = await loadReplay(client, values.replay)
      if (values.source !== 'all' && values.source !== replay.source_key) throw new Error('Replay source does not match --source')
      values.source = replay.source_key
      clock.setTime(Date.parse(replay.captured_at))
    }
  }
  if (values.apply && client) {
    const db = client
    monitor = {
      start: async source => {
        const runUrl = process.env.GITHUB_RUN_ID ? `https://github.com/Sherry-1110/campus-radar/actions/runs/${process.env.GITHUB_RUN_ID}` : null
        const data = await pipelineRpc<string>(db, 'begin_source_pipeline', { p_source_name: source, p_run_url: runUrl, p_captured_at: clock.toISOString(), p_version: PROCESSOR_VERSION })
        runIds.set(source, data as string)
        return data as string
      },
      finish: async (runId, summary) => {
        const { error } = await db.rpc('finish_source_pipeline', {
          p_run_id: runId, p_status: summary.status === 'applied' ? 'succeeded' : 'failed',
          p_summary: { ...summary.changes, candidates: summary.candidates, posters: summary.posters, error_code: summary.error_code,
            detail_checked: summary.details?.checked ?? 0, detail_enriched: summary.details?.enriched ?? 0, detail_failed: summary.details?.failed ?? 0 },
        })
        if (error) throw new Error(`Cannot finish source monitor: ${error.code}`)
      },
    }
    apply = async (source, items) => {
      const { failures: _, ...posters } = await storePosters(db, items.flatMap(item => item.data.cover_image_url ? [item.data.cover_image_url] : []), undefined, 5 * 60_000)
      console.log(JSON.stringify({ poster_storage: posters }))
      return writeBatches(source, items, async (name, batch) => {
        const { data, error } = await db.rpc('publish_staged_events', { p_external_ids: batch.map(item => item.external_id), p_run_id: runIds.get(name) })
        if (error) throw Object.assign(new Error(`Database sync ${error.code}: ${error.message}`), { code: error.code })
        return data as Record<string, number>
      })
    }
  }
  const sources = registry.filter(source => values.source === 'all' || values.source === source.id)
    .map(source => ({ name: source.name, fetch: async () => {
      const run = runIds.get(source.name)
      const capture = captureSource(async document => {
        if (client && run) await pipelineRpc(client, 'store_source_document', {
          p_run_id: run, p_scope: document.scope, p_request_url: document.request_url,
          p_response_url: document.response_url, p_body: document.body,
        })
      }, replay?.documents)
      const base = await source.fetch(capture.text(url => fetchText(url, source.hosts)), clock)
      capture.check()
      base.items = base.items.map(normalizeCandidate)
      if (!base.items.length) throw new Error('Refusing empty source snapshot')
      if (new Set(base.items.map(i => i.external_id)).size !== base.items.length) throw new Error('Duplicate source IDs')
      const cached = new Map<string, Candidate>()
      if (client && run) {
        await stageItems(client, run, base.items, 'normalized')
        if (!replay) for (let offset = 0; offset < base.items.length; offset += 100) {
          const rows = await pipelineRpc<Candidate[]>(client, 'get_staged_enrichment', {
            p_run_id: run, p_external_ids: base.items.slice(offset, offset + 100).map(i => i.external_id),
          })
          for (const item of rows) cached.set(item.external_id, item)
        }
      }
      const pending = { ...base, items: base.items.filter(i => !cached.has(i.external_id)) }
      const result = await enrich(pending, capture.original(fetchOriginal), clock)
      capture.check()
      const enriched = new Map(result.items.map(i => [i.external_id, i]))
      result.items = base.items.map(i => normalizeCandidate(cached.get(i.external_id) || enriched.get(i.external_id)!))
      if (cached.size) result.warnings.push(`Reused verified enrichment for ${cached.size} unchanged source records`)
      if (client && run) await stageItems(client, run, result.items, 'enriched')
      return result
    } }))
  const report = await runSync(sources, apply, monitor)
  await writeFile(values.report, `${JSON.stringify(report, null, 2)}\n`)
  if (process.env.GITHUB_STEP_SUMMARY) {
    const rows = report.sources.map(s => `| ${s.name} | ${s.status} | ${s.candidates} | ${s.posters} | ${s.changes?.inserted ?? '—'} | ${s.changes?.updated ?? '—'} | ${s.changes?.unchanged ?? '—'} |`)
    await appendFile(process.env.GITHUB_STEP_SUMMARY, `## Nightly event sync (${report.mode})\n\n| Source | Result | Candidates | Posters | New | Updated | Unchanged |\n|---|---|---:|---:|---:|---:|---:|\n${rows.join('\n')}\n\nSee the report artifact for conflicts and errors. Missing source records are never treated as cancellations.\n`)
    for(const source of report.sources) if(source.semantic)await appendFile(process.env.GITHUB_STEP_SUMMARY,`\n### ${source.name}: Jev (${source.semantic.mode})\n\nEvaluation: ${source.semantic.evaluation_passed?'passed':'FAILED — fallback active'}\n\n\`\`\`json\n${JSON.stringify(source.semantic.stats,null,2)}\n\`\`\`\n`)
  }
  if (report.sources.some(source => source.status === 'failed')) process.exitCode = 1
}

if (import.meta.main) main().catch(error => {
  console.error(error instanceof Error ? error.message : 'Sync failed')
  process.exitCode = 1
})
