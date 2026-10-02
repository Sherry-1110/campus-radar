import { Clock, MapPin } from 'lucide-react'
import { Link } from 'react-router'
import { formatWhenShort } from '@/lib/dates'
import type { EventListItem } from '@/lib/events'
import { cardFee } from '@/lib/fee'
import { cardPlace } from '@/lib/place'
import { Poster } from './Poster'
import { CategoryChip } from './CategoryChip'
import { SaveButton } from './SaveButton'

export function EventCard({ event, onSelect, selected = false }: {
  event: EventListItem; onSelect?: (id: string, trigger: HTMLElement) => void; selected?: boolean
}) {
  return <article className={`overflow-hidden rounded-2xl border bg-surface shadow-card ${selected ? 'border-brand-700 ring-2 ring-brand-200' : 'border-line'}`}>
    <Link to={`/events/${event.id}`} aria-label={`View ${event.title}`} aria-current={selected ? 'true' : undefined}
      onClick={e => { if (onSelect && !e.metaKey && !e.ctrlKey && !e.shiftKey && !e.altKey) { e.preventDefault(); onSelect(event.id, e.currentTarget) } }}
      className="group block">
      <Poster key={event.cover_image_url} src={event.cover_image_url} title={event.title} category={event.category} natural />
      <div className="flex flex-col gap-1.5 p-2 sm:p-3 [overflow-wrap:anywhere]">
        {event.is_cancelled && <p className="text-sm font-bold text-danger">Canceled</p>}
        <h2 className="text-sm sm:text-base font-bold leading-snug group-hover:text-brand-700">{event.title}</h2>
        <p className="flex items-start gap-1.5 text-xs sm:text-sm text-ink-muted"><Clock className="mt-0.5 size-3.5 sm:size-4 shrink-0" aria-hidden="true" />
          <span>{formatWhenShort(event.start_time, event.end_time, event.is_all_day)}</span></p>
        {(event.matching_dates ?? 1) > 1 && <p className="text-xs sm:text-sm font-semibold text-brand-700">+{event.matching_dates! - 1} more {event.matching_dates === 2 ? 'date' : 'dates'} in this range</p>}
        <p className="flex items-start gap-1.5 text-xs sm:text-sm text-ink-muted"><MapPin className="mt-0.5 size-3.5 sm:size-4 shrink-0" aria-hidden="true" />
          <span>{cardPlace(event) ?? 'Location not listed'}</span></p>
        <p className="text-sm font-bold">{cardFee(event) ?? (event.fee_text?.trim() ? 'See source for price' : 'Price not listed')}</p>
      </div>
    </Link>
    <div className="flex flex-wrap items-center justify-between gap-1 px-2 pb-2 sm:gap-2 sm:px-3 sm:pb-3">
      <CategoryChip category={event.category} />
      {(event.matching_dates ?? 1) > 1 ? <Link to={`/events/${event.id}`} className="inline-flex min-h-11 items-center text-sm font-semibold text-brand-700"
        aria-label={`Choose a date for ${event.title}`}
        onClick={e => { if (onSelect && !e.metaKey && !e.ctrlKey && !e.shiftKey && !e.altKey) { e.preventDefault(); onSelect(event.id, e.currentTarget) } }}>Choose date</Link>
        : <SaveButton id={event.id} title={event.title} />}
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
