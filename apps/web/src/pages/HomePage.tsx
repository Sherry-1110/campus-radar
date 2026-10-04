import { CalendarX, CloudOff, ListChecks, Map, LayoutGrid } from 'lucide-react'
import { useCallback, useEffect, useRef, useState } from 'react'
import { useNavigate, useSearchParams } from 'react-router'
import { EventCardSkeleton } from '@/components/EventCard'
import { EventGrid } from '@/components/EventGrid'
import { EventMap } from '@/components/EventMap'
import { FilterBar } from '@/components/FilterBar'
import { buttonPrimary, buttonSecondary, StateMessage } from '@/components/StateMessage'
import { useEvents, useMapEvents } from '@/lib/events'
import { matchesNothing } from '@/lib/filters'
import { parseBounds, writeBounds, type MapBounds } from '@/lib/geo'
import { useDocumentTitle } from '@/lib/useDocumentTitle'
import { useFilters } from '@/lib/useFilters'

export function HomePage() {
  useDocumentTitle()
  const { filters, update, clear, isFiltered } = useFilters()
  const [params, setParams] = useSearchParams()
  const [showMap, setShowMap] = useState(false)
  const [mapActivated, setMapActivated] = useState(false)
  const bounds = parseBounds(params.get('bounds'))
  const query = useEvents(filters, bounds)
  const loadMoreRef = useRef<HTMLDivElement>(null)
  const mapQuery = useMapEvents(filters, bounds, showMap && Boolean(import.meta.env.VITE_GOOGLE_MAPS_API_KEY))
  const navigate = useNavigate()
  const setQuery = useCallback((q: string) => update({ q }), [update])
  const searchArea = (area: MapBounds | null) => setParams(prev => {
    const next = new URLSearchParams(prev)
    if (area) next.set('bounds', writeBounds(area))
    else next.delete('bounds')
    next.delete('page'); next.delete('event')
    return next
  }, { replace: true })
  const seen = new Set<string>()
  const items = (query.data?.pages.flatMap(batch => batch.items) ?? []).filter(event => {
    const key = event.series_id ?? event.id
    if (seen.has(key)) return false
    seen.add(key)
    return true
  })
  const total = query.data?.pages[0]?.total ?? 0
  const { hasNextPage, isFetching, isFetchNextPageError, fetchNextPage } = query
  useEffect(() => {
    const target = loadMoreRef.current
    if (!target || !hasNextPage || isFetching || isFetchNextPageError) return
    const observer = new IntersectionObserver(entries => {
      if (entries.some(entry => entry.isIntersecting)) void fetchNextPage({ cancelRefetch: false })
    }, { rootMargin: '400px' })
    observer.observe(target)
    return () => observer.disconnect()
  }, [hasNextPage, isFetching, isFetchNextPageError, fetchNextPage, items.length])
  // Old numbered-page links still open the discovery feed and retain their filters.
  useEffect(() => {
    if (params.has('page')) setParams(prev => {
      const next = new URLSearchParams(prev)
      next.delete('page')
      return next
    }, { replace: true })
  }, [params, setParams])
  const nothingSelected = matchesNothing(filters)

  return <div className="mx-auto max-w-[1600px] px-4 py-6 sm:px-6 sm:py-8">
    <div className="mb-6 flex flex-wrap items-end justify-between gap-3">
      <div>
        <h1 className="text-3xl font-extrabold tracking-tight sm:text-4xl">Find something fun</h1>
        <p className="mt-2 text-sm text-ink-muted">Good things are happening nearby, right now.</p>
      </div>
      <button type="button" className={buttonSecondary} aria-pressed={showMap} onClick={() => { setShowMap(value => !value); setMapActivated(true) }}>
        {showMap ? <LayoutGrid className="size-4" /> : <Map className="size-4" />}{showMap ? 'Cards' : 'Map'}
      </button>
    </div>
    <FilterBar filters={filters} onChange={update} onSearch={setQuery} />
    {bounds && <div className="mt-4 flex flex-wrap items-center gap-3 text-sm"><span>Showing mapped events in your selected area. Unmapped venues are excluded.</span><button type="button" className="min-h-11 font-bold text-brand-700 underline" onClick={() => searchArea(null)}>Clear area</button></div>}
    <div className={`discovery-layout ${showMap ? 'with-map' : ''} mt-5`}>
      <section aria-label="Events" className={`${showMap ? 'hidden lg:block' : ''} min-w-0`}>
        <p className="mb-5 text-sm text-ink-muted" role="status" aria-live="polite">
          {query.isPending ? 'Loading events' : query.isError && !items.length ? 'Events unavailable' : total ? `${total} events · ${items.length} shown` : '0 events'}
        </p>
        {query.isPending && <ul className="event-grid" aria-label="Loading events">{Array.from({ length: 6 }, (_, i) => <li key={i}><EventCardSkeleton /></li>)}</ul>}
        {query.isError && !items.length && <StateMessage icon={CloudOff} tone="error" title="Couldn't load events" action={<button type="button" onClick={() => query.refetch()} className={buttonPrimary}>Try again</button>}>Check your connection and try again.</StateMessage>}
        {query.isSuccess && !items.length && <StateMessage icon={nothingSelected ? ListChecks : CalendarX}
          title={nothingSelected ? 'Nothing selected' : isFiltered || bounds ? 'No events match your filters' : 'No events in the next 7 days'}
          action={<button type="button" onClick={clear} className={buttonPrimary}>Reset filters</button>}>
          Try another date, category, or area.
        </StateMessage>}
        <EventGrid items={items} />
        {items.length > 0 && <div ref={loadMoreRef} className="flex min-h-20 items-center justify-center py-6 text-sm text-ink-muted">
          {query.isFetchNextPageError ? <div role="alert">Couldn't load more events. <button type="button" className={buttonSecondary} onClick={() => query.fetchNextPage()}>Try again</button></div>
            : query.isRefetchError ? <div role="alert">Couldn't refresh events. <button type="button" className={buttonSecondary} onClick={() => query.refetch()}>Try again</button></div>
              : <p role="status">{query.isFetchingNextPage ? 'Loading more events…' : query.hasNextPage ? 'Scroll for more events' : 'You’ve seen all events matching these filters.'}</p>}
        </div>}
      </section>
      <aside className={`${showMap ? '' : 'hidden'} map-column`}>
        {mapActivated && <EventMap events={mapQuery.data?.located ?? []} selectedId={null} onSelect={id => navigate(`/events/${id}`)}
          bounds={bounds} onSearchArea={searchArea} loading={mapQuery.isFetching} error={Boolean(mapQuery.error)} />}
      </aside>
    </div>
  </div>
}
