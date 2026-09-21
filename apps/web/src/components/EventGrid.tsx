import type { EventListItem } from '@/lib/events'
import { EventCard } from './EventCard'

export function EventGrid({ items, onSelect, selectedId }: { items: EventListItem[]; onSelect?: (id: string, trigger: HTMLElement) => void; selectedId?: string | null }) {
  return <ul className="event-grid">
    {items.map(event => <li key={event.id} className="mb-5 break-inside-avoid"><EventCard event={event} onSelect={onSelect} selected={selectedId === event.id} /></li>)}
  </ul>
}
