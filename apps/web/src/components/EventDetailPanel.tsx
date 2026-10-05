import { ChevronDown, ChevronUp, X } from 'lucide-react'
import { useEffect, useRef, useState, type RefObject } from 'react'
import { useEvent } from '@/lib/events'
import { useLang } from '@/lib/i18n'
import { EventDetail } from './EventDetail'

/** Phone bottom sheet: swipe or tap up for full screen, swipe or tap down to shrink or close. */
export function EventDetailPanel({ id, onClose, returnFocus }: { id: string; onClose: () => void; returnFocus: RefObject<HTMLElement | null> }) {
  const { t } = useLang()
  const query = useEvent(id)
  const [expanded, setExpanded] = useState(false)
  const closeRef = useRef<HTMLButtonElement>(null)
  const scrollRef = useRef<HTMLDivElement>(null)
  const dragFrom = useRef<number | null>(null)
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
  function endDrag(clientY: number) {
    if (dragFrom.current === null) return
    const dy = clientY - dragFrom.current
    dragFrom.current = null
    if (dy < -40) setExpanded(true)
    else if (dy > 40) { if (expanded) setExpanded(false); else onClose() }
  }
  return <section role="dialog" aria-modal="false" aria-label={query.data?.title ?? t('Event details')} className={`event-panel ${expanded ? 'is-expanded' : ''}`}>
    <header className="shrink-0 touch-none border-b border-line px-4 pb-1 pt-2"
      onPointerDown={e => { dragFrom.current = e.clientY }}
      onPointerUp={e => endDrag(e.clientY)} onPointerCancel={() => { dragFrom.current = null }}>
      <div className="mx-auto mb-1 h-1.5 w-10 rounded-full bg-line" aria-hidden="true" />
      <div className="flex items-center justify-between">
        <button type="button" className="min-h-11 rounded-lg pr-3 text-sm font-semibold" aria-expanded={expanded}
          onClick={() => setExpanded(value => !value)}>
          {expanded ? <ChevronDown className="inline size-4" /> : <ChevronUp className="inline size-4" />} {expanded ? t('Collapse') : t('Full screen')}
        </button>
        <button ref={closeRef} type="button" onClick={onClose} aria-label={t('Close event details')} className="grid size-11 place-items-center rounded-full hover:bg-brand-50"><X className="size-5" /></button>
      </div>
    </header>
    <div ref={scrollRef} className="min-h-0 overflow-y-auto overscroll-contain p-4" tabIndex={0}>
      {query.isPending && <p role="status">{t('Loading event…')}</p>}
      {query.isError && <div role="alert"><p>{t("Couldn't load this event.")}</p><button type="button" className="mt-3 underline" onClick={() => query.refetch()}>{t('Try again')}</button></div>}
      {query.isSuccess && !query.data && <p>{t('Event not found. It may have been removed.')}</p>}
      {query.data && <EventDetail key={id} event={query.data} />}
    </div>
  </section>
}
