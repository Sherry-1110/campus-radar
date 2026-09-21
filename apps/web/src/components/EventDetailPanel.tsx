import { ChevronDown, ChevronUp, X } from 'lucide-react'
import { useEffect, useRef, useState, type RefObject } from 'react'
import { useEvent } from '@/lib/events'
import { EventDetail } from './EventDetail'

export function EventDetailPanel({ id, onClose, returnFocus }: { id: string; onClose: () => void; returnFocus: RefObject<HTMLElement | null> }) {
  const query = useEvent(id)
  const [expanded, setExpanded] = useState(false)
  const closeRef = useRef<HTMLButtonElement>(null)
  const scrollRef = useRef<HTMLDivElement>(null)
  useEffect(() => {
    closeRef.current?.focus({ preventScroll: true })
    scrollRef.current?.scrollTo(0, 0)
  }, [id])
  useEffect(() => {
    const escape = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    document.addEventListener('keydown', escape)
    return () => document.removeEventListener('keydown', escape)
  }, [onClose])
  useEffect(() => () => { returnFocus.current?.focus({ preventScroll: true }) }, [returnFocus])
  return <section role="dialog" aria-modal="false" aria-label={query.data?.title ?? 'Event details'} className={`event-panel ${expanded ? 'is-expanded' : ''}`}>
    <header className="flex shrink-0 items-center justify-between border-b border-line px-4 py-2">
      <span className="text-sm font-bold">Event details</span>
      <div className="flex gap-2">
        <button type="button" className="min-h-11 rounded-lg px-3 text-sm font-semibold lg:hidden" aria-expanded={expanded}
          onClick={() => setExpanded(value => !value)}>
          {expanded ? <ChevronDown className="inline size-4" /> : <ChevronUp className="inline size-4" />} {expanded ? 'Collapse' : 'Expand'}
        </button>
        <button ref={closeRef} type="button" onClick={onClose} aria-label="Close event details" className="grid size-11 place-items-center rounded-full hover:bg-brand-50"><X className="size-5" /></button>
      </div>
    </header>
    <div ref={scrollRef} className="min-h-0 overflow-y-auto overscroll-contain p-5" tabIndex={0}>
      {query.isPending && <p role="status">Loading event…</p>}
      {query.isError && <div role="alert"><p>Couldn't load this event.</p><button type="button" className="mt-3 underline" onClick={() => query.refetch()}>Try again</button></div>}
      {query.isSuccess && !query.data && <p>Event not found. It may have been removed.</p>}
      {query.data && <EventDetail key={id} event={query.data} compact />}
    </div>
  </section>
}
