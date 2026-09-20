import { CalendarX, CloudOff } from 'lucide-react'
import { useCallback } from 'react'
import { EventCard, EventCardSkeleton } from '@/components/EventCard'
import { FilterBar } from '@/components/FilterBar'
import { SearchBox } from '@/components/SearchBox'
import { buttonPrimary, buttonSecondary, StateMessage } from '@/components/StateMessage'
import { useEvents } from '@/lib/events'
import { useDocumentTitle } from '@/lib/useDocumentTitle'
import { useFilters } from '@/lib/useFilters'

export function HomePage() {
  useDocumentTitle()
  const { filters, update, clear, isFiltered } = useFilters()
  const query = useEvents(filters)
  const setQuery = useCallback((q: string) => update({ q }), [update])

  const items = query.data?.pages.flatMap((p) => p.items) ?? []
  const total = query.data?.pages[0]?.total ?? 0

  return (
    <>
      <section className="relative overflow-hidden bg-gradient-to-br from-brand-900 via-brand-800 to-brand-600 text-white">
        <div className="absolute -right-24 -top-24 size-80 rounded-full bg-white/5" aria-hidden="true" />
        <div className="absolute -bottom-32 left-1/3 size-72 rounded-full bg-accent/10" aria-hidden="true" />
        <div className="relative mx-auto max-w-6xl px-4 pb-10 pt-10 sm:pb-14 sm:pt-14">
          <h1 className="max-w-2xl text-3xl font-extrabold leading-tight tracking-tight sm:text-5xl">
            What&rsquo;s happening around Northwestern
          </h1>
          <p className="mt-3 max-w-xl text-base text-brand-100 sm:text-lg">
            Concerts, talks, fitness classes and more, gathered in one place so you never miss out.
          </p>
          <div className="mt-6 max-w-2xl">
            <SearchBox value={filters.q} onChange={setQuery} />
          </div>
        </div>
      </section>

      <div className="mx-auto max-w-6xl px-4 py-6 sm:py-8">
        <FilterBar filters={filters} onChange={update} />

        <div className="mb-4 mt-6 flex items-center justify-between gap-3">
          <h2 className="text-xl font-bold sm:text-2xl" aria-live="polite">
            {query.isPending
              ? 'Loading events…'
              : `${total} upcoming ${total === 1 ? 'event' : 'events'}`}
          </h2>
          {isFiltered && (
            <button type="button" onClick={clear} className={buttonSecondary}>
              Clear filters
            </button>
          )}
        </div>

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
            icon={CalendarX}
            title={isFiltered ? 'No events match your filters' : 'No upcoming events yet'}
            action={
              isFiltered ? (
                <button type="button" onClick={clear} className={buttonPrimary}>
                  Clear filters
                </button>
              ) : undefined
            }
          >
            {isFiltered
              ? 'Try a different date, category, or search term.'
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
    </>
  )
}
