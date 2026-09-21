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
import { feeLabel, useEvent, type EventRow } from '@/lib/events'
import { eventPageUrl, googleMapsUrl } from '@/lib/maps'
import { useDocumentTitle } from '@/lib/useDocumentTitle'

const externalLink =
  'inline-flex items-center gap-1 font-semibold text-brand-700 underline underline-offset-2'

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

function EventDetail({ event }: { event: EventRow }) {
  const when = formatWhenLong(event.start_time, event.end_time, event.is_all_day)
  const pageUrl = window.location.href
  const [copied, setCopied] = useState(false)

  const eventPage = eventPageUrl(event)
  const mapUrl = googleMapsUrl(event.location, event.region)
  const category = <CategoryChip category={event.category} />

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
          {feeLabel(event) && (
            <div className="flex flex-wrap items-center gap-2">
              <FeeBadge event={event} />
            </div>
          )}
          <h1 className="text-3xl font-extrabold leading-tight tracking-tight sm:text-4xl">
            {event.title}
          </h1>
          {eventPage && (
            <a href={eventPage} target="_blank" rel="noopener noreferrer" className={`${externalLink} self-start`}>
              Event page
              <ExternalLink className="size-4" aria-hidden="true" />
              <span className="sr-only">(opens in a new tab)</span>
            </a>
          )}
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
          {event.location ? (
            <div className="flex gap-3">
              <dt className="mt-0.5 text-brand-600">
                <MapPin className="size-5" aria-hidden="true" />
                <span className="sr-only">Where</span>
              </dt>
              <dd className="flex flex-col items-start gap-2">
                <p className="font-semibold">{event.location}</p>
                {mapUrl && (
                  <a href={mapUrl} target="_blank" rel="noopener noreferrer" className={`${externalLink} text-sm`}>
                    Open in Google Maps
                    <ExternalLink className="size-3.5" aria-hidden="true" />
                    <span className="sr-only">(opens in a new tab)</span>
                  </a>
                )}
                {category}
              </dd>
            </div>
          ) : (
            <div className="flex gap-3">
              <dt className="sr-only">Category</dt>
              <dd className="pl-8">{category}</dd>
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
