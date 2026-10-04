import { useLayoutEffect, useRef } from 'react'
import type { EventListItem } from '@/lib/events'
import { EventCard } from './EventCard'

export function EventGrid({ items, onSelect }: { items: EventListItem[]; onSelect?: (id: string, trigger: HTMLElement) => void }) {
  const grid = useRef<HTMLUListElement>(null)
  useLayoutEffect(() => {
    if (!grid.current) return
    // Small grid tracks keep DOM/date order and avoid CSS columns redistributing old cards on append.
    const size = (item: HTMLElement) => { item.style.gridRowEnd = `span ${Math.ceil((item.getBoundingClientRect().height + (parseFloat(getComputedStyle(grid.current!).getPropertyValue('--feed-gap')) || 20)) / 2)}` }
    const observer = new ResizeObserver(entries => entries.forEach(entry => size(entry.target as HTMLElement)))
    for (const item of grid.current.children) {
      size(item as HTMLElement)
      observer.observe(item)
    }
    return () => observer.disconnect()
  }, [items])
  return <ul ref={grid} className="event-grid event-feed">
    {items.map(event => <li key={event.id}><EventCard event={event} onSelect={onSelect} /></li>)}
  </ul>
}
