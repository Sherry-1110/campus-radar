import { CalendarDays, CalendarPlus, Check, Download, ExternalLink, Link2, MapPin } from 'lucide-react'
import { useState } from 'react'
import { CategoryChip } from './CategoryChip'
import { FeeBadge } from './FeeBadge'
import { Poster } from './Poster'
import { SaveButton } from './SaveButton'
import { buttonPrimary, buttonSecondary } from './StateMessage'
import { downloadIcs, googleCalendarUrl } from '@/lib/calendar'
import { formatWhenLong } from '@/lib/dates'
import { feeLabel, type EventRow } from '@/lib/events'
import { eventPageUrl, googleMapsUrl } from '@/lib/maps'
const externalLink = 'inline-flex items-center gap-1 font-semibold text-brand-700 underline underline-offset-2'

export function EventDetail({ event, compact = false }: { event: EventRow; compact?: boolean }) {
  const when = formatWhenLong(event.start_time, event.end_time, event.is_all_day)
  const pageUrl = `${window.location.origin}/events/${event.id}`
  const [copied, setCopied] = useState(false)

  const eventPage = eventPageUrl(event)
  const mapUrl = googleMapsUrl(event.location, event.region)
  const category = <CategoryChip category={event.category} />

  async function copyLink() {
    try {
      if (navigator.share) { await navigator.share({ title: event.title, url: pageUrl }); return }
      await navigator.clipboard.writeText(pageUrl)
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    } catch (error) {
      if (error instanceof DOMException && error.name === 'AbortError') return
      window.prompt('Copy this link', pageUrl)
    }
  }

  return (
    <article className={compact ? "flex flex-col gap-5" : "grid gap-8 lg:grid-cols-[minmax(0,5fr)_minmax(0,6fr)] lg:gap-12"}>
      <div className={compact ? "" : "lg:sticky lg:top-6 lg:self-start"}>
        <div className="overflow-hidden rounded-3xl border border-line bg-brand-100 shadow-card">
          <div className="relative mx-auto w-full">
            <Poster
              natural
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
              View source
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
          <SaveButton id={event.id} title={event.title} />
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
            <span aria-live="polite">{copied ? 'Link copied' : 'Share'}</span>
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
