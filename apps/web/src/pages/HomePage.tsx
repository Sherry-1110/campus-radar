import { CalendarX, CloudOff, ListChecks } from 'lucide-react'
import { useCallback } from 'react'
import { EventCard, EventCardSkeleton } from '@/components/EventCard'
import { FilterBar } from '@/components/FilterBar'
import { buttonPrimary, buttonSecondary, StateMessage } from '@/components/StateMessage'
import { useEvents } from '@/lib/events'
import { matchesNothing } from '@/lib/filters'
import { useDocumentTitle } from '@/lib/useDocumentTitle'
import { useFilters } from '@/lib/useFilters'

export function HomePage() {
  useDocumentTitle()
  const { filters, update, clear, isFiltered } = useFilters()
  const query = useEvents(filters)
  const setQuery = useCallback((q: string) => update({ q }), [update])

  const items = query.data?.pages.flatMap((p) => p.items) ?? []
  const nothingSelected = matchesNothing(filters)

  return (
    <div className="mx-auto max-w-6xl px-4 py-6 sm:py-8">
      <h1 className="sr-only">Campus Radar events</h1>

      <FilterBar filters={filters} onChange={update} onSearch={setQuery} />

      <p className="sr-only" role="status" aria-live="polite">
        {query.isPending
          ? 'Loading events'
          : `${items.length}${query.hasNextPage ? ' or more' : ''} events shown`}
      </p>

      <div className="mt-6">
        {query.isPending && (
          <ul className="grid gap-5 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4" aria-label="Loading events">
            {Array.from({ length: 8 }, (_, i) => (
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
            {query.hasNextPage && (
              <div className="mt-8 flex justify-center">
                <button
                  type="button"
                  onClick={() => query.fetchNextPage()}
                  disabled={query.isFetchingNextPage}
                  className={`${buttonSecondary} min-w-40 disabled:opacity-50`}
                >
                  {query.isFetchingNextPage ? 'Loading…' : 'Load more'}
                </button>
              </div>
            )}
          </>
        )}
      </div>
    </div>
  )
}
