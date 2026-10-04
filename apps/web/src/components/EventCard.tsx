import { Clock, Link2, MapPin } from 'lucide-react'
import { Link } from 'react-router'
import { formatDateRange, formatWhenShort } from '@/lib/dates'
import type { EventListItem } from '@/lib/events'
import { cardFee } from '@/lib/fee'
import { eventPageUrl } from '@/lib/maps'
import { cardPlace } from '@/lib/place'
import { Poster } from './Poster'
import { CategoryChips } from './CategoryChip'
import { SaveButton } from './SaveButton'

export function EventCard({ event }: { event: EventListItem }) {
  const source = eventPageUrl(event)
  const price = cardFee(event)
  const range = (event.matching_dates ?? 1) > 1 && event.last_start_time ? formatDateRange(event.start_time, event.last_start_time, 'short') : null
  return <article className="group relative overflow-hidden rounded-2xl border border-line bg-surface shadow-card motion-safe:transition motion-safe:duration-200 hover:border-brand-200 hover:shadow-card-hover motion-safe:hover:-translate-y-0.5">
    <Link to={`/events/${event.id}`} aria-label={`View ${event.title}`} className="block">
      <Poster key={event.cover_image_url} src={event.cover_image_url} title={event.title} category={event.category} natural />
      <div className="flex flex-col gap-1.5 p-2 sm:p-3 [overflow-wrap:anywhere]">
        {event.is_cancelled && <p className="text-sm font-bold text-danger">Canceled</p>}
        <h2 className="text-sm sm:text-base font-bold leading-snug group-hover:text-brand-700">{event.title}</h2>
        <p className="flex items-start gap-1.5 text-xs sm:text-sm text-ink-muted"><Clock className="mt-0.5 size-3.5 sm:size-4 shrink-0" aria-hidden="true" />
          <span>{range ?? formatWhenShort(event.start_time, event.end_time, event.is_all_day)}</span></p>
        <p className="flex items-start gap-1.5 text-xs sm:text-sm text-ink-muted"><MapPin className="mt-0.5 size-3.5 sm:size-4 shrink-0" aria-hidden="true" />
          <span>{cardPlace(event) ?? 'Location not listed'}</span></p>
        {price && <p className="text-sm font-bold">{price}</p>}
      </div>
    </Link>
    <div className="px-2 pb-2 sm:px-3 sm:pb-3"><CategoryChips event={event} /></div>
    <div className="absolute right-2 top-2 flex gap-2">
      {source && <a href={source} target="_blank" rel="noopener noreferrer" aria-label={`Open source for ${event.title} (opens in a new tab)`}
        className="inline-flex size-11 items-center justify-center rounded-full border border-line bg-brand-50/70 text-brand-700 opacity-0 shadow-card backdrop-blur-sm transition-opacity hover:bg-brand-50/90 focus-visible:opacity-100 group-hover:opacity-100 [@media(hover:none)]:opacity-100">
        <Link2 className="size-5" aria-hidden="true" /></a>}
      <SaveButton id={event.id} title={event.title} />
    </div>
  </article>
}

export function EventCardSkeleton() {
  return <div className="overflow-hidden rounded-2xl border border-line bg-surface motion-safe:animate-pulse" aria-hidden="true">
    <div className="aspect-[4/3] bg-brand-100" /><div className="space-y-3 p-3">
      <div className="h-5 rounded bg-brand-100" /><div className="h-4 w-3/4 rounded bg-brand-50" /><div className="h-4 w-1/2 rounded bg-brand-50" />
    </div>
  </div>
}
