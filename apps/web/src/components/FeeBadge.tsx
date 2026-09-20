import { Ticket } from 'lucide-react'
import { feeLabel, type EventRow } from '@/lib/events'

export function FeeBadge({ event }: { event: Pick<EventRow, 'is_free' | 'fee_text'> }) {
  const free = event.is_free
  return (
    <span
      className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-sm font-semibold ${
        free ? 'bg-free-soft text-free' : 'bg-brand-50 text-brand-800'
      }`}
    >
      <Ticket className="size-4" aria-hidden="true" />
      {feeLabel(event)}
    </span>
  )
}
