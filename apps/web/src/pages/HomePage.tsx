import { CalendarX, CloudOff, ListChecks } from 'lucide-react'
import { useCallback, useEffect, useRef, useState } from 'react'
import { useSearchParams } from 'react-router'
import { EventCardSkeleton } from '@/components/EventCard'
import { EventDetailColumn, EventDetailPanel } from '@/components/EventDetailPanel'
import { EventGrid } from '@/components/EventGrid'
import { EventMap } from '@/components/EventMap'
import { FeaturedStrip } from '@/components/FeaturedStrip'
import { CategoryTabs, FilterBar } from '@/components/FilterBar'
import { buttonPrimary, buttonSecondary, StateMessage } from '@/components/StateMessage'
import { useEvents, useFeaturedEvents, useMapEvents } from '@/lib/events'
import { matchesNothing } from '@/lib/filters'
import { useLang } from '@/lib/i18n'
import { parseBounds, writeBounds, type MapBounds } from '@/lib/geo'
import { useDocumentTitle } from '@/lib/useDocumentTitle'
import { isMobileViewport, isWideViewport, useEventSelection } from '@/lib/useEventSelection'
import { useFilters } from '@/lib/useFilters'

export function HomePage() {
  useDocumentTitle()
  const { t } = useLang()
  const { filters, update, clear, isFiltered } = useFilters()
  const [params, setParams] = useSearchParams()
  const [showMap, setShowMap] = useState(false)
  const [mapActivated, setMapActivated] = useState(false)
  const bounds = parseBounds(params.get('bounds'))
  const query = useEvents(filters, bounds)
  const featured = useFeaturedEvents()
  const loadMoreRef = useRef<HTMLDivElement>(null)
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
  // From the map an event opens in place: beside the map on wide screens, in the lower half on smaller ones.
  const besideMap = showMap && selection.selectedId && isWideViewport() ? selection.selectedId : null
  const sheet = selection.selectedId && (isMobileViewport() || (showMap && !isWideViewport()))

  return <>
    <FeaturedStrip items={featured.data ?? []} onSelect={selection.open} />
  <div className="mx-auto max-w-[1600px] px-1.5 py-6 sm:px-6 sm:py-8">
    <FilterBar filters={filters} onChange={update} onSearch={setQuery} mapOn={showMap} onToggleMap={() => { if (showMap && selection.selectedId) selection.close(); setShowMap(value => !value); setMapActivated(true) }} />
    <CategoryTabs filters={filters} onChange={update} />
    {bounds && <div className="mt-4 flex flex-wrap items-center gap-3 text-sm"><span>{t('Showing mapped events in your selected area. Unmapped venues are excluded.')}</span><button type="button" className="min-h-11 font-bold text-brand-700 underline" onClick={() => searchArea(null)}>{t('Clear area')}</button></div>}
    <div className={`discovery-layout ${showMap ? 'with-map' : ''} mt-5`}>
      <section aria-label={t('Events')} className={`${showMap ? 'hidden lg:block' : ''} min-w-0`}>
        {besideMap && <EventDetailColumn id={besideMap} onClose={selection.close} />}
        {/* Kept mounted while an event is open beside the map, so the list keeps its place. */}
        <div className={besideMap ? 'hidden' : ''}>
        <p className="mb-3 px-1.5 text-sm text-ink-muted sm:mb-5 sm:px-0" role="status" aria-live="polite">
          {query.isPending ? t('Loading events') : query.isError && !items.length ? t('Events unavailable') : total ? t('{0} events · {1} shown', total, items.length) : t('0 events')}
        </p>
        {query.isPending && <ul className="event-grid" aria-label={t('Loading events')}>{Array.from({ length: 6 }, (_, i) => <li key={i}><EventCardSkeleton /></li>)}</ul>}
        {query.isError && !items.length && <StateMessage icon={CloudOff} tone="error" title={t("Couldn't load events")} action={<button type="button" onClick={() => query.refetch()} className={buttonPrimary}>{t('Try again')}</button>}>{t('Check your connection and try again.')}</StateMessage>}
        {query.isSuccess && !items.length && <StateMessage icon={nothingSelected ? ListChecks : CalendarX}
          title={nothingSelected ? t('Nothing selected') : isFiltered || bounds ? t('No events match your filters') : t('No events in the next 7 days')}
          action={<button type="button" onClick={clear} className={buttonPrimary}>{t('Reset filters')}</button>}>
          {t('Try another date, category, or area.')}
        </StateMessage>}
        <EventGrid items={items} onSelect={selection.open} />
        {items.length > 0 && <div ref={loadMoreRef} className="flex min-h-20 items-center justify-center py-6 text-sm text-ink-muted">
          {query.isFetchNextPageError ? <div role="alert">{t("Couldn't load more events.")} <button type="button" className={buttonSecondary} onClick={() => query.fetchNextPage()}>{t('Try again')}</button></div>
            : query.isRefetchError ? <div role="alert">{t("Couldn't refresh events.")} <button type="button" className={buttonSecondary} onClick={() => query.refetch()}>{t('Try again')}</button></div>
              : <p role="status">{query.isFetchingNextPage ? t('Loading more events…') : query.hasNextPage ? t('Scroll for more events') : t('You’ve seen all events matching these filters.')}</p>}
        </div>}
        </div>
      </section>
      <aside className={`${showMap ? '' : 'hidden'} map-column`}>
        {mapActivated && <EventMap events={mapQuery.data?.located ?? []} selectedId={showMap ? selection.selectedId : null} onSelect={selection.show}
          bounds={bounds} onSearchArea={searchArea} loading={mapQuery.isFetching} error={Boolean(mapQuery.error)} />}
      </aside>
    </div>
    {sheet && <EventDetailPanel id={selection.selectedId!} onClose={selection.close} returnFocus={selection.returnFocus} half={showMap} />}
  </div>
  </>
}
