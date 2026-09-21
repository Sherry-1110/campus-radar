import { CalendarX, CloudOff, ListChecks } from 'lucide-react'
import { Fragment, useCallback, useEffect } from 'react'
import { Link, useSearchParams } from 'react-router'
import { EventCard, EventCardSkeleton } from '@/components/EventCard'
import { FilterBar } from '@/components/FilterBar'
import { buttonPrimary, buttonSecondary, StateMessage } from '@/components/StateMessage'
import { useEvents } from '@/lib/events'
import { matchesNothing } from '@/lib/filters'
import { PAGE_SIZE, parsePage, pageNumbers } from '@/lib/pagination'
import { useDocumentTitle } from '@/lib/useDocumentTitle'
import { useFilters } from '@/lib/useFilters'

export function HomePage() {
  useDocumentTitle()
  const { filters, update, clear, isFiltered } = useFilters()
  const [params, setParams] = useSearchParams()
  const page = parsePage(params.get('page'))
  const query = useEvents(filters, page)
  const setQuery = useCallback((q: string) => update({ q }), [update])

  const items = query.data?.items ?? []
  const total = query.data?.total ?? 0
  const currentPage = query.data?.page ?? page
  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE))
  const numbers = pageNumbers(currentPage, totalPages)
  const pageUrl = (n: number) => {
    const next = new URLSearchParams(params)
    if (n === 1) next.delete('page')
    else next.set('page', String(n))
    return `?${next.toString()}`
  }
  useEffect(() => {
    if (query.data && query.data.page !== page) {
      setParams(prev => {
        const next = new URLSearchParams(prev)
        if (query.data.page === 1) next.delete('page')
        else next.set('page', String(query.data.page))
        return next
      }, { replace: true })
    }
  }, [query.data, page, setParams])
  const nothingSelected = matchesNothing(filters)

  return (
    <div className="mx-auto max-w-6xl px-4 py-6 sm:py-8">
      <h1 className="sr-only">Campus Radar events</h1>

      <FilterBar filters={filters} onChange={update} onSearch={setQuery} />

      <p className="mt-5 text-sm text-ink-muted" role="status" aria-live="polite">
        {query.isPending
          ? 'Loading events'
          : query.isError ? 'Events unavailable'
            : total ? `Showing ${(currentPage - 1) * PAGE_SIZE + 1}–${(currentPage - 1) * PAGE_SIZE + items.length} of ${total} events · Page ${currentPage} of ${totalPages}`
              : '0 events'}
      </p>

      <div className="mt-6">
        {query.isPending && (
          <ul className="grid gap-5 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4" aria-label="Loading events">
            {Array.from({ length: PAGE_SIZE }, (_, i) => (
              <li key={i}>
                <EventCardSkeleton />
              </li>
            ))}
          </ul>
        )}

        {query.isError && (
          <StateMessage
            icon={CloudOff}
            tone="error"
            title="Couldn't load events"
            action={
              <button type="button" onClick={() => query.refetch()} className={buttonPrimary}>
                Try again
              </button>
            }
          >
            Check your connection and try again.
          </StateMessage>
        )}

        {query.isSuccess && items.length === 0 && (
          <StateMessage
            icon={nothingSelected ? ListChecks : CalendarX}
            title={
              nothingSelected
                ? 'Nothing selected'
                : isFiltered
                  ? 'No events match your filters'
                  : 'No upcoming events yet'
            }
            action={
              isFiltered ? (
                <button type="button" onClick={clear} className={buttonPrimary}>
                  Reset filters
                </button>
              ) : undefined
            }
          >
            {nothingSelected
              ? 'Pick at least one option in every filter to see events.'
              : isFiltered
                ? 'Try a different place, date, category, or search term.'
                : 'Check back soon, new events are added regularly.'}
          </StateMessage>
        )}

        {items.length > 0 && (
          <>
            <ul className="grid gap-5 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
              {items.map((event) => (
                <li key={event.id}>
                  <EventCard event={event} />
                </li>
              ))}
            </ul>
            {totalPages > 1 && (
              <nav aria-label="Event pages" className="mt-8 flex flex-wrap items-center justify-center gap-2">
                {currentPage > 1 && <Link to={pageUrl(currentPage - 1)} className={buttonSecondary} onClick={() => window.scrollTo(0, 0)}>Previous</Link>}
                {numbers.map((n, i) => (
                  <Fragment key={n}>
                    {i > 0 && n - numbers[i - 1] > 1 && <span className="px-1 text-ink-muted" aria-hidden="true">…</span>}
                    <Link
                      to={pageUrl(n)}
                      aria-label={`Page ${n}`}
                      aria-current={n === currentPage ? 'page' : undefined}
                      className={`${n === currentPage ? buttonPrimary : buttonSecondary} min-w-11`}
                      onClick={() => window.scrollTo(0, 0)}
                    >{n}</Link>
                  </Fragment>
                ))}
                {currentPage < totalPages && <Link to={pageUrl(currentPage + 1)} className={buttonSecondary} onClick={() => window.scrollTo(0, 0)}>Next</Link>}
              </nav>
            )}
          </>
        )}
      </div>
    </div>
  )
}
