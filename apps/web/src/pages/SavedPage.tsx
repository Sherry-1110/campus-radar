import { Link } from 'react-router'
import { EventGrid } from '@/components/EventGrid'
import { EventDetailPanel } from '@/components/EventDetailPanel'
import { useSavedEvents } from '@/lib/useSavedEvents'
import { useSavedEventRows } from '@/lib/events'
import { isPastEvent } from '@/lib/savedEvents'
import { useEventSelection } from '@/lib/useEventSelection'
import { useDocumentTitle } from '@/lib/useDocumentTitle'

export function SavedPage() {
  useDocumentTitle('Saved events')
  const { ids, toggle } = useSavedEvents()
  const query = useSavedEventRows(ids)
  const selection = useEventSelection()
  const now = new Date()
  const items = query.data ?? []
  const upcoming = items.filter(event => !isPastEvent(event, now))
  const past = items.filter(event => isPastEvent(event, now))
  const unavailable = query.isSuccess ? ids.filter(id => !items.some(event => event.id === id)) : []
  return <div className="mx-auto max-w-6xl px-4 py-8">
    <h1 className="text-3xl font-extrabold">Your saved events</h1>
    <p className="mb-8 mt-2 text-sm text-ink-muted">Your plans, in date order. Saved in this browser.</p>
    {query.isPending && <p role="status">Loading saved events…</p>}
    {query.isError && <div role="alert"><p>Couldn't load saved events. Your saves are still here.</p><button type="button" className="min-h-11 underline" onClick={() => query.refetch()}>Try again</button></div>}
    {query.isSuccess && !upcoming.length && <p className="mb-6">No upcoming saved events. <Link to="/" className="font-bold text-brand-700 underline">Find something to do</Link></p>}
    <EventGrid items={upcoming} onSelect={selection.open} selectedId={selection.selectedId} />
    {past.length > 0 && <details className="mt-8 border-t border-line pt-4"><summary className="min-h-11 text-lg font-bold">Past events ({past.length})</summary><EventGrid items={past} onSelect={selection.open} selectedId={selection.selectedId} /></details>}
    {unavailable.length > 0 && <section className="mt-6"><h2 className="font-bold">No longer available</h2><p className="text-sm text-ink-muted">These events may have been removed by their organizers.</p>
      {unavailable.map((id, index) => <p key={id} className="flex items-center gap-4 py-2">Unavailable event {index + 1}<button type="button" className="min-h-11 underline" onClick={() => toggle(id)}>Remove saved event {index + 1}</button></p>)}
    </section>}
    {selection.selectedId && <EventDetailPanel id={selection.selectedId} onClose={selection.close} returnFocus={selection.returnFocus} />}
  </div>
}
