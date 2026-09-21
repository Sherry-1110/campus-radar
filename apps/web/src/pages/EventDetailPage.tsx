import {
  ArrowLeft,
  CalendarDays,
  CalendarPlus,
  Check,
  CloudOff,
  Download,
  ExternalLink,
  Link2,
  MapPin,
  SearchX,
} from 'lucide-react'
import { useState } from 'react'
import { Link, useLocation, useNavigate, useParams } from 'react-router'
import { CategoryChip } from '@/components/CategoryChip'
import { FeeBadge } from '@/components/FeeBadge'
import { Poster } from '@/components/Poster'
import { buttonPrimary, buttonSecondary, StateMessage } from '@/components/StateMessage'
import { downloadIcs, googleCalendarUrl } from '@/lib/calendar'
import { formatWhenLong } from '@/lib/dates'
import { useEvent } from '@/lib/events'
import { eventSource } from '@/lib/eventSource'
import { useDocumentTitle } from '@/lib/useDocumentTitle'

export function EventDetailPage() {
  const { id } = useParams()
  const query = useEvent(id)
  useDocumentTitle(query.data?.title)

  const navigate = useNavigate()
  const location = useLocation()
  const goBack = () => {
    if (location.key !== 'default') navigate(-1)
    else navigate('/')
  }

  return (
    <div className="mx-auto max-w-6xl px-4 py-6 sm:py-8">
      <button type="button" onClick={goBack} className={`${buttonSecondary} mb-5`}>
        <ArrowLeft className="size-4" aria-hidden="true" />
        Back to events
      </button>

      {query.isPending && <DetailSkeleton />}

      {query.isError && (
        <StateMessage
          icon={CloudOff}
          tone="error"
          title="Couldn't load this event"
          action={
            <button type="button" onClick={() => query.refetch()} className={buttonPrimary}>
              Try again
            </button>
          }
        >
          Check your connection and try again.
        </StateMessage>
      )}

      {query.isSuccess && !query.data && (
        <StateMessage
          icon={SearchX}
          title="Event not found"
          action={
            <Link to="/" className={buttonPrimary}>
              Browse events
            </Link>
          }
        >
          It may have been removed, or the link is wrong.
        </StateMessage>
      )}

      {query.data && <EventDetail event={query.data} />}
    </div>
  )
}

type EventWithSources = NonNullable<ReturnType<typeof useEvent>['data']>

function EventDetail({ event }: { event: EventWithSources }) {
  const when = formatWhenLong(event.start_time, event.end_time, event.is_all_day)
  const pageUrl = window.location.href
  const [copied, setCopied] = useState(false)

  const source = eventSource(event)

  async function copyLink() {
    try {
      await navigator.clipboard.writeText(pageUrl)
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    } catch {
      window.prompt('Copy this link', pageUrl)
    }
  }

  return (
    <article className="grid gap-8 lg:grid-cols-[minmax(0,5fr)_minmax(0,6fr)] lg:gap-12">
      <div className="lg:sticky lg:top-6 lg:self-start">
        <div className="overflow-hidden rounded-3xl border border-line bg-brand-100 shadow-card">
          <div className="relative mx-auto aspect-[4/5] max-h-[70vh] w-full sm:aspect-[4/3] lg:aspect-[4/5]">
            <Poster
              src={event.cover_image_url}
              title={event.title}
              category={event.category}
            />
          </div>
        </div>
      </div>

      <div className="flex flex-col gap-6">
        {event.is_cancelled && (
          <p role="status" className="rounded-xl bg-red-100 p-4 font-semibold text-red-800">
            This event has been canceled. Check the organizer’s source page for updates.
          </p>
        )}
        <header className="flex flex-col gap-3">
          <div className="flex flex-wrap items-center gap-2">
            <CategoryChip category={event.category} />
            <FeeBadge event={event} />
          </div>
          <h1 className="text-3xl font-extrabold leading-tight tracking-tight sm:text-4xl">
            {event.title}
          </h1>
        </header>

        <dl className="flex flex-col gap-4 rounded-2xl border border-line bg-surface p-5 shadow-card">
          <div className="flex gap-3">
            <dt className="mt-0.5 text-brand-600">
              <CalendarDays className="size-5" aria-hidden="true" />
              <span className="sr-only">When</span>
            </dt>
            <dd>
              <p className="font-semibold">{when.date}</p>
              <p className="text-ink-muted">{when.time} (Central Time)</p>
            </dd>
          </div>
          {event.location && (
            <div className="flex gap-3">
              <dt className="mt-0.5 text-brand-600">
                <MapPin className="size-5" aria-hidden="true" />
                <span className="sr-only">Where</span>
              </dt>
              <dd>
                <p className="font-semibold">{event.location}</p>
                {event.location_url && (
                  <a
                    href={event.location_url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex items-center gap-1 text-sm font-semibold text-brand-700 underline underline-offset-2"
                  >
                    View map
                    <ExternalLink className="size-3.5" aria-hidden="true" />
                    <span className="sr-only">(opens in a new tab)</span>
                  </a>
                )}
              </dd>
            </div>
          )}
        </dl>

        <div className="flex flex-wrap gap-3">
          {!event.is_cancelled && <a
            href={googleCalendarUrl(event, pageUrl)}
            target="_blank"
            rel="noopener noreferrer"
            className={buttonPrimary}
          >
            <CalendarPlus className="mr-2 size-4" aria-hidden="true" />
            Add to Google Calendar
            <span className="sr-only">(opens in a new tab)</span>
          </a>}
          <button type="button" onClick={() => downloadIcs(event, pageUrl)} className={buttonSecondary}>
            <Download className="size-4" aria-hidden="true" />
            {event.is_cancelled ? 'Download cancellation (.ics)' : 'Download .ics'}
          </button>
          <button type="button" onClick={copyLink} className={buttonSecondary}>
            {copied ? (
              <Check className="size-4 text-free" aria-hidden="true" />
            ) : (
              <Link2 className="size-4" aria-hidden="true" />
            )}
            <span aria-live="polite">{copied ? 'Link copied' : 'Copy link'}</span>
          </button>
        </div>

        {event.description && (
          <section aria-labelledby="about-heading">
            <h2 id="about-heading" className="mb-2 text-xl font-bold">
              About this event
            </h2>
            <p className="max-w-prose whitespace-pre-line leading-relaxed text-ink">
              {event.description}
            </p>
          </section>
        )}

        {source && (
          <section aria-labelledby="source-heading">
            <h2 id="source-heading" className="mb-2 text-sm font-bold uppercase tracking-wider text-ink-muted">
              Source
            </h2>
            <a
              href={source.url}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-1.5 font-semibold text-brand-700 underline underline-offset-2"
            >
              {source.name}
              <ExternalLink className="size-3.5" aria-hidden="true" />
              <span className="sr-only">(opens in a new tab)</span>
            </a>
          </section>
        )}
      </div>
    </article>
  )
}

function DetailSkeleton() {
  return (
    <div className="grid gap-8 motion-safe:animate-pulse lg:grid-cols-[5fr_6fr]" aria-hidden="true">
      <div className="aspect-[4/5] rounded-3xl bg-brand-100" />
      <div className="flex flex-col gap-4">
        <div className="h-6 w-32 rounded-full bg-brand-100" />
        <div className="h-10 w-3/4 rounded bg-brand-100" />
        <div className="h-32 rounded-2xl bg-brand-50" />
        <div className="h-11 w-56 rounded-xl bg-brand-100" />
      </div>
    </div>
  )
}
