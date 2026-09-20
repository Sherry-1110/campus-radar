import { useQuery } from '@tanstack/react-query'
import { AlertCircle, LoaderCircle } from 'lucide-react'
import { supabase } from '@/lib/supabase'
import { sourceStatus } from '@/lib/sourceStatus'
import { useDocumentTitle } from '@/lib/useDocumentTitle'
import { StateMessage, buttonSecondary } from '@/components/StateMessage'

const date = (value: string | null | undefined) => value ? new Intl.DateTimeFormat('en-US', { timeZone: 'America/Chicago', dateStyle: 'medium', timeStyle: 'short' }).format(new Date(value)) : 'Never'
const errors: Record<string, string> = {
  fetch_failed: 'Could not read the publisher’s feed.', validation_failed: 'Source data did not pass validation.',
  sync_failed: 'Database update failed; some batches may have committed.', monitoring_failed: 'Could not record the run result.',
}

export function SourcesPage() {
  useDocumentTitle('Source status')
  const query = useQuery({
    queryKey: ['source-health'], refetchInterval: 60_000,
    queryFn: async () => {
      const [sources, health] = await Promise.all([
        supabase.from('sources').select('name,url,is_active,adapter_key').not('adapter_key', 'is', null).order('name'),
        supabase.from('source_health').select('*'),
      ])
      if (sources.error) throw sources.error
      if (health.error) throw health.error
      return sources.data.map(source => ({ ...source, health: health.data.find(row => row.source_name === source.name) }))
    },
  })
  return (
    <div className="mx-auto max-w-6xl px-4 py-10">
      <div className="mb-8 flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-3xl font-extrabold tracking-tight text-brand-900">Source status</h1>
          <p className="mt-3 max-w-2xl text-ink-muted">Each source runs independently every night. We add new events and update changed listings; an event disappearing from a feed does not mean it was canceled.</p>
          <p className="mt-2 text-sm text-ink-muted">Times are in Chicago time. Updates at 3:17 a.m. during daylight time, 2:17 a.m. otherwise. This page refreshes every minute.</p>
        </div>
        <button className={buttonSecondary} onClick={() => void query.refetch()} disabled={query.isFetching}>{query.isFetching ? 'Refreshing…' : 'Refresh status'}</button>
      </div>
      {query.isPending ? <StateMessage icon={LoaderCircle} title="Loading source status" /> : query.isError ? (
        <StateMessage icon={AlertCircle} title="Status unavailable" tone="error">We could not load monitoring data. Event listings remain available; please try refreshing.</StateMessage>
      ) : !query.data.length ? <StateMessage icon={AlertCircle} title="No automated sources configured" /> : (
        <div className="grid gap-5 md:grid-cols-2">
          {query.data.map(source => {
            const h = source.health
            const status = sourceStatus(source.is_active, h)
            const healthy = status === 'Healthy'
            const problem = ['Failed', 'Overdue', 'Stalled'].includes(status)
            return (
              <article key={source.name} className="rounded-2xl border border-line bg-surface p-6">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <h2 className="text-xl font-bold">{source.url ? <a href={source.url} target="_blank" rel="noreferrer" className="underline decoration-brand-200 underline-offset-4">{source.name}</a> : source.name}</h2>
                  <span className={`rounded-full px-3 py-1 text-sm font-semibold ${healthy ? 'bg-green-50 text-green-800' : problem ? 'bg-red-50 text-red-800' : 'bg-brand-50 text-brand-800'}`}>{status}</span>
                </div>
                <dl className="mt-5 grid grid-cols-2 gap-x-4 gap-y-3 text-sm">
                  <dt className="text-ink-muted">Last attempt</dt><dd>{date(h?.started_at)}</dd>
                  <dt className="text-ink-muted">Last success</dt><dd>{date(h?.last_success_at)}</dd>
                  {h?.completed_at && <><dt className="text-ink-muted">Events fetched</dt><dd>{h.candidates.toLocaleString()}</dd><dt className="text-ink-muted">With posters</dt><dd>{h.posters.toLocaleString()} / {h.candidates.toLocaleString()}</dd></>}
                  {h?.status === 'succeeded' && <><dt className="text-ink-muted">Latest changes</dt><dd>{h.inserted} new · {h.updated} updated · {h.linked} linked · {h.unchanged} unchanged</dd><dt className="text-ink-muted">Linked-page details</dt><dd>{h.detail_enriched} enriched / {h.detail_checked} checked</dd><dt className="text-ink-muted">Preserved edits</dt><dd>{h.conflicts}</dd></>}
                </dl>
                {Boolean(h?.detail_failed) && <p className="mt-4 text-sm text-amber-800">{h!.detail_failed} original-page checks were unavailable. Calendar updates continued; previous verified details were kept where possible.</p>}
                {h?.error_code && <p className="mt-4 text-sm text-red-800">{errors[h.error_code] || 'The latest sync failed.'}</p>}
                {status === 'Stalled' && <p className="mt-4 text-sm text-red-800">This run has not reported completion. Check the job log.</p>}
                {status === 'Overdue' && <p className="mt-4 text-sm text-red-800">No successful update in the last 36 hours.</p>}
                {h?.run_url && <a href={h.run_url} target="_blank" rel="noreferrer" className="mt-4 inline-block text-sm font-semibold text-brand-700 underline">View run details on GitHub</a>}
              </article>
            )
          })}
        </div>
      )}
      <p className="mt-8 text-sm text-ink-muted">“Healthy” means the latest full import succeeded within 36 hours. Publishers control coverage and poster availability; check the original listing before attending.</p>
    </div>
  )
}
