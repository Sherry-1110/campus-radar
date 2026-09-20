import { Clock, MapPin } from 'lucide-react'
import { Link } from 'react-router'
import { badgeParts, formatTimeOnly, formatWhenShort } from '@/lib/dates'
import type { EventListItem } from '@/lib/events'
import { cardFee } from '@/lib/fee'
import { cardPlace } from '@/lib/place'
import { Poster } from './Poster'

export function EventCard({ event }: { event: EventListItem }) {
  const badge = badgeParts(event.start_time)
  const place = cardPlace(event)
  const fee = cardFee(event)

  return (
    <Link
      to={`/events/${event.id}`}
      className="group flex h-full flex-col overflow-hidden rounded-2xl border border-line bg-surface shadow-card motion-safe:transition motion-safe:duration-200 hover:shadow-card-hover motion-safe:hover:-translate-y-0.5"
    >
      <div className="relative aspect-[4/3] bg-brand-100">
        <Poster src={event.cover_image_url} title={event.title} category={event.category} />

        <div
          className="absolute left-3 top-3 flex size-12 flex-col items-center justify-center gap-0.5 rounded-lg bg-white leading-none shadow-card"
          aria-hidden="true"
        >
          <span className="text-[10px] font-bold tracking-wide text-brand-600">{badge.month}</span>
          <span className="text-lg font-extrabold leading-none text-ink">{badge.day}</span>
          <span className="text-[10px] font-semibold text-ink-muted">{badge.weekday}</span>
        </div>

        {fee && (
          <span className="absolute right-3 top-3 line-clamp-2 max-w-[55%] text-right text-sm font-bold leading-tight text-white [text-shadow:0_1px_3px_rgb(0_0_0/0.9),0_0_10px_rgb(0_0_0/0.45)]">
            {fee}
          </span>
        )}
      </div>

      <div className="flex flex-1 flex-col gap-2 p-4">
        <h3 className="line-clamp-2 text-lg font-bold leading-snug text-ink group-hover:text-brand-700">
          {event.title}
        </h3>

        <span className="sr-only">
          {formatWhenShort(event.start_time, event.end_time, event.is_all_day)}
        </span>
        <p className="flex items-center gap-2 text-sm text-ink-muted" aria-hidden="true">
          <Clock className="size-4 shrink-0" />
          <span>{formatTimeOnly(event.start_time, event.end_time, event.is_all_day)}</span>
        </p>
        {place && (
          <p className="flex items-center gap-2 text-sm text-ink-muted">
            <MapPin className="size-4 shrink-0" aria-hidden="true" />
            <span className="line-clamp-1">{place}</span>
          </p>
        )}
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
        <div className="h-5 w-full rounded bg-brand-100" />
        <div className="h-5 w-2/3 rounded bg-brand-100" />
        <div className="h-4 w-1/2 rounded bg-brand-50" />
        <div className="h-4 w-1/3 rounded bg-brand-50" />
      </div>
    </div>
  )
}
