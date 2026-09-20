import { Clock, MapPin } from 'lucide-react'
import { Link } from 'react-router'
import { badgeParts, eventTag, formatWhenShort } from '@/lib/dates'
import type { EventListItem } from '@/lib/events'
import { CategoryChip } from './CategoryChip'
import { FeeBadge } from './FeeBadge'
import { Poster } from './Poster'

export function EventCard({ event }: { event: EventListItem }) {
  const badge = badgeParts(event.start_time)
  const tag = eventTag(event.start_time, event.end_time)

  return (
    <Link
      to={`/events/${event.id}`}
      className="group flex h-full flex-col overflow-hidden rounded-2xl border border-line bg-surface shadow-card motion-safe:transition motion-safe:duration-200 hover:shadow-card-hover motion-safe:hover:-translate-y-0.5"
    >
      <div className="relative aspect-[4/3] bg-brand-100">
        <Poster src={event.cover_image_url} title={event.title} category={event.category} />
        <div
          className="absolute left-3 top-3 flex min-w-12 flex-col items-center rounded-xl bg-white px-2 py-1 leading-none shadow-card"
          aria-hidden="true"
        >
          <span className="text-[11px] font-bold tracking-wider text-brand-600">{badge.month}</span>
          <span className="text-xl font-extrabold text-ink">{badge.day}</span>
        </div>
      </div>

      <div className="flex flex-1 flex-col gap-2 p-4">
        <div className="flex flex-wrap items-center gap-2">
          <CategoryChip category={event.category} />
          {tag && (
            <span
              className={`rounded-full px-2.5 py-1 text-xs font-bold ${
                tag === 'Happening now' ? 'bg-accent text-ink' : 'bg-accent-soft text-amber-900'
              }`}
            >
              {tag}
            </span>
          )}
        </div>

        <h3 className="line-clamp-2 text-lg font-bold leading-snug text-ink group-hover:text-brand-700">
          {event.title}
        </h3>

        <p className="flex items-center gap-2 text-sm text-ink-muted">
          <Clock className="size-4 shrink-0" aria-hidden="true" />
          <span>{formatWhenShort(event.start_time, event.end_time)}</span>
        </p>
        {event.location && (
          <p className="flex items-center gap-2 text-sm text-ink-muted">
            <MapPin className="size-4 shrink-0" aria-hidden="true" />
            <span className="line-clamp-1">{event.location}</span>
          </p>
        )}

        <div className="mt-auto pt-2">
          <FeeBadge event={event} />
        </div>
      </div>
    </Link>
  )
}

export function EventCardSkeleton() {
  return (
    <div
      className="flex h-full flex-col overflow-hidden rounded-2xl border border-line bg-surface shadow-card motion-safe:animate-pulse"
      aria-hidden="true"
    >
      <div className="aspect-[4/3] bg-brand-100" />
      <div className="flex flex-col gap-3 p-4">
        <div className="h-5 w-20 rounded-full bg-brand-100" />
        <div className="h-5 w-full rounded bg-brand-100" />
        <div className="h-5 w-2/3 rounded bg-brand-100" />
        <div className="h-4 w-1/2 rounded bg-brand-50" />
        <div className="h-4 w-1/3 rounded bg-brand-50" />
      </div>
    </div>
  )
}
