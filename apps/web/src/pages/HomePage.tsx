import { CalendarX, CloudOff, ListChecks, Map, LayoutGrid } from 'lucide-react'
import { Fragment, useCallback, useEffect, useState } from 'react'
import { Link, useSearchParams } from 'react-router'
import { EventCardSkeleton } from '@/components/EventCard'
import { EventGrid } from '@/components/EventGrid'
import { EventMap } from '@/components/EventMap'
import { EventDetailPanel } from '@/components/EventDetailPanel'
import { FilterBar } from '@/components/FilterBar'
import { buttonPrimary, buttonSecondary, StateMessage } from '@/components/StateMessage'
import { useEvents, useMapEvents } from '@/lib/events'
import { matchesNothing } from '@/lib/filters'
import { PAGE_SIZE, parsePage, pageNumbers } from '@/lib/pagination'
import { parseBounds, writeBounds, type MapBounds } from '@/lib/geo'
import { useDocumentTitle } from '@/lib/useDocumentTitle'
import { useFilters } from '@/lib/useFilters'
import { useEventSelection } from '@/lib/useEventSelection'

export function HomePage() {
  useDocumentTitle()
  const { filters, update, clear, isFiltered } = useFilters()
  const [params, setParams] = useSearchParams()
  const [showMap, setShowMap] = useState(false)
  const [mapActivated, setMapActivated] = useState(false)
  const bounds = parseBounds(params.get('bounds'))
  const page = parsePage(params.get('page'))
  const query = useEvents(filters, page, bounds)
  const mapQuery = useMapEvents(filters, bounds, showMap && Boolean(import.meta.env.VITE_GOOGLE_MAPS_API_KEY))
  const selection = useEventSelection()
  const setQuery = useCallback((q: string) => update({ q }), [update])
  const searchArea = (area: MapBounds | null) => setParams(prev => {
    const next = new URLSearchParams(prev)
    if (area) next.set('bounds', writeBounds(area))
    else next.delete('bounds')
    next.delete('page'); next.delete('event')
    return next
  }, { replace: true })
  const items = query.data?.items ?? []
  const total = query.data?.total ?? 0
  const currentPage = query.data?.page ?? page
  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE))
  const numbers = pageNumbers(currentPage, totalPages)
  const pageUrl = (n: number) => {
    const next = new URLSearchParams(params)
    if (n === 1) next.delete('page')
    else next.set('page', String(n))
    next.delete('event')
    return `?${next.toString()}`
  }
  useEffect(() => {
    if (query.data && query.data.page !== page) setParams(prev => {
      const next = new URLSearchParams(prev)
      if (query.data.page === 1) next.delete('page')
      else next.set('page', String(query.data.page))
      return next
    }, { replace: true })
  }, [query.data, page, setParams])
  const nothingSelected = matchesNothing(filters)

  return <div className="mx-auto max-w-[1600px] px-4 py-6 sm:px-6 sm:py-8">
    <div className="mb-6 flex flex-wrap items-end justify-between gap-3">
      <div>
        <h1 className="text-3xl font-extrabold tracking-tight sm:text-4xl">Make room for something fun.</h1>
        <p className="mt-2 text-sm text-ink-muted">Explore events. Find your next plan.</p>
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
          {query.isPending ? 'Loading events' : query.isError ? 'Events unavailable' : total ? `${total} events · Page ${currentPage} of ${totalPages}` : '0 events'}
        </p>
        {query.isPending && <ul className="event-grid" aria-label="Loading events">{Array.from({ length: 6 }, (_, i) => <li key={i} className="mb-5 break-inside-avoid"><EventCardSkeleton /></li>)}</ul>}
        {query.isError && <StateMessage icon={CloudOff} tone="error" title="Couldn't load events" action={<button type="button" onClick={() => query.refetch()} className={buttonPrimary}>Try again</button>}>Check your connection and try again.</StateMessage>}
        {query.isSuccess && !items.length && <StateMessage icon={nothingSelected ? ListChecks : CalendarX}
          title={nothingSelected ? 'Nothing selected' : isFiltered || bounds ? 'No events match your filters' : 'No events in the next 7 days'}
          action={<button type="button" onClick={clear} className={buttonPrimary}>Reset filters</button>}>
          Try another date, category, or area.
        </StateMessage>}
        <EventGrid items={items} onSelect={selection.open} selectedId={selection.selectedId} />
        {totalPages > 1 && <nav aria-label="Event pages" className="my-8 flex flex-wrap items-center justify-center gap-2">
          {currentPage > 1 && <Link to={pageUrl(currentPage - 1)} className={buttonSecondary} onClick={() => window.scrollTo(0, 0)}>Previous</Link>}
          {numbers.map((n, i) => <Fragment key={n}>
            {i > 0 && n - numbers[i - 1] > 1 && <span aria-hidden="true">…</span>}
            <Link to={pageUrl(n)} aria-label={`Page ${n}`} aria-current={n === currentPage ? 'page' : undefined}
              className={`${n === currentPage ? buttonPrimary : buttonSecondary} min-w-11`} onClick={() => window.scrollTo(0, 0)}>{n}</Link>
          </Fragment>)}
          {currentPage < totalPages && <Link to={pageUrl(currentPage + 1)} className={buttonSecondary} onClick={() => window.scrollTo(0, 0)}>Next</Link>}
        </nav>}
      </section>
      <aside className={`${showMap ? '' : 'hidden'} map-column`}>
        {mapActivated && <EventMap events={mapQuery.data?.located ?? []} selectedId={selection.selectedId} onSelect={selection.open}
          bounds={bounds} onSearchArea={searchArea} loading={mapQuery.isFetching} error={mapQuery.error?.message || mapQuery.data?.warning || false} deferred={mapQuery.data?.deferred} />}
      </aside>
    </div>
    {selection.selectedId && <EventDetailPanel id={selection.selectedId} onClose={selection.close} returnFocus={selection.returnFocus} />}
  </div>
}
