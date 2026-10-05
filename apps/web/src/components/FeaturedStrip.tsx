import { ChevronLeft, ChevronRight } from 'lucide-react'
import { useCallback, useEffect, useRef } from 'react'
import { Link } from 'react-router'
import { eventGroups } from '@/lib/categories'
import { formatWhenShort } from '@/lib/dates'
import { localized, useLang } from '@/lib/i18n'
import type { EventListItem } from '@/lib/events'
import { isMobileViewport } from '@/lib/useEventSelection'

const AUTO_MS = 4500
const SHRINK = 0.4 // how much smaller the outermost posters are
const DIM = 0.72 // how dark the outermost posters are
const HOLD_MS = 9000 // how long auto-play stays off after the visitor touches the banner

/**
 * A full-width banner of 4:3, cropped posters with a visible edge and shadow, overlapping like a fanned deck. You swipe through it and it
 * also advances by itself, looping for ever: the list is rendered three times and, once the scroll has
 * come to rest, quietly jumps back by exactly one copy so the visitor never reaches an end.
 * Scroll-snap targets the plain list items while the transform is applied to a card inside each, so the
 * snapping never chases the animation.
 * The poster nearest the middle sits in front, full size and lit; the rest shrink, dim and stack behind it. Every poster carries its title.
 */
export function FeaturedStrip({ items, onSelect }: { items: EventListItem[]; onSelect: (id: string, trigger: HTMLElement) => void }) {
  const { lang, t } = useLang()
  const track = useRef<HTMLUListElement>(null)
  const rest = useRef<number>(0)
  let base = items
  while (base.length > 0 && base.length < 6) base = [...base, ...items]

  // Per frame we only write styles: positions are measured once (and on resize), never read while scrolling.
  // Posters shrink about their own centre, which would open gaps towards the edges, so each is also slid
  // towards the middle by exactly the amount the shrinking took away. That keeps every overlap the same width.
  const metrics = useRef<{ cards: HTMLElement[]; inner: HTMLElement[]; dims: HTMLElement[]; centers: number[]; half: number; c: number } | null>(null)
  const measure = useCallback(() => {
    const el = track.current
    if (!el || el.children.length < 2) return
    const cards = [...el.children] as HTMLElement[]
    const pitch = cards[1]!.offsetLeft - cards[0]!.offsetLeft
    const half = el.clientWidth / 2
    metrics.current = {
      cards, half,
      inner: cards.map(li => li.firstElementChild as HTMLElement),
      dims: cards.map(li => li.querySelector<HTMLElement>('[data-dim]')!),
      centers: cards.map(li => li.offsetLeft + li.offsetWidth / 2),
      c: (cards[0]!.offsetWidth * SHRINK) / (2 * pitch * half), // how fast visual spacing falls behind layout spacing
    }
  }, [])
  const light = useCallback(() => {
    const m = metrics.current
    const el = track.current
    if (!m || !el) return
    const mid = el.scrollLeft + m.half
    m.cards.forEach((li, i) => {
      const x = m.centers[i]! - mid
      const dist = Math.abs(x)
      const d = Math.min(dist / m.half, 1)
      const pulled = dist <= m.half ? m.c * dist * dist : m.c * m.half * (2 * dist - m.half) // quadratic, then straight on past the edge
      m.inner[i]!.style.transform = `translate3d(${(-Math.sign(x) * pulled).toFixed(1)}px,0,0) scale(${(1 - SHRINK * d).toFixed(3)})`
      li.style.zIndex = String(Math.round((1 - d) * 10))
      m.dims[i]!.style.opacity = (DIM * d).toFixed(3)
    })
  }, [])
  useEffect(() => {
    const redo = () => { measure(); light() }
    redo()
    window.addEventListener('resize', redo)
    return () => window.removeEventListener('resize', redo)
  }, [measure, light, items])

  // Width of one poster slot, and of one whole copy of the list.
  const pitch = () => {
    const kids = track.current?.children
    return kids && kids.length > 1 ? (kids[1] as HTMLElement).offsetLeft - (kids[0] as HTMLElement).offsetLeft : 0
  }
  const loopWidth = () => pitch() * base.length

  // Start with the first poster of the middle copy exactly in the middle.
  useEffect(() => {
    const el = track.current
    const li = el?.children[base.length] as HTMLElement | undefined
    if (el && li) el.scrollLeft = li.offsetLeft + li.offsetWidth / 2 - el.clientWidth / 2
    light()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [items])

  // Once scrolling has stopped (and no finger is down): centre the nearest poster ourselves in case the browser's
  // own snapping did not, then step back into the middle copy; the copies are identical so nothing visibly moves.
  const touching = useRef(false)
  const settle = () => {
    clearTimeout(rest.current)
    rest.current = window.setTimeout(() => {
      const el = track.current
      const m = metrics.current
      const w = loopWidth()
      if (!el || !m || !w || touching.current) return
      const mid = el.scrollLeft + m.half
      const off = m.centers.map(c => c - mid).reduce((best, o) => (Math.abs(o) < Math.abs(best) ? o : best))
      if (Math.abs(off) > 1.5) { el.scrollTo({ left: el.scrollLeft + off, behavior: 'smooth' }); return }
      if (el.scrollLeft < w * 0.5) el.scrollLeft += w
      else if (el.scrollLeft > w * 1.5) el.scrollLeft -= w
    }, 120)
  }
  const onScroll = () => { light(); settle() }
  useEffect(() => () => clearTimeout(rest.current), [])

  // Moves one poster along; scroll-snap settles it.
  const step = (dir: 1 | -1) => track.current?.scrollBy({ left: dir * pitch(), behavior: 'smooth' })

  // Advance on a timer, but stay out of the way while the pointer is over the banner or after a touch/scroll.
  const hold = useRef({ hover: false, until: 0 })
  const pause = () => { hold.current.until = Date.now() + HOLD_MS }
  const stepRef = useRef(step)
  useEffect(() => { stepRef.current = step })
  useEffect(() => {
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return
    const timer = setInterval(() => {
      if (!hold.current.hover && Date.now() > hold.current.until && !document.hidden) stepRef.current(1)
    }, AUTO_MS)
    return () => clearInterval(timer)
  }, [])

  if (!items.length) return null
  return (
    <section aria-label={t('Featured events')} className="relative overflow-hidden bg-[#0f0b1e]"
      style={{ backgroundImage: 'radial-gradient(ellipse 55% 100% at 50% 50%, rgba(124,77,255,.35), transparent 75%)' }}>
      <ul ref={track} onScroll={onScroll} onPointerEnter={e => { if (e.pointerType === 'mouse') hold.current.hover = true }}
        onPointerLeave={() => { hold.current.hover = false }} onPointerDown={pause} onWheel={pause}
        onTouchStart={() => { pause(); touching.current = true }} onTouchEnd={() => { touching.current = false; settle() }} onTouchCancel={() => { touching.current = false; settle() }}
        className="stage-track relative flex snap-x snap-mandatory items-center overflow-x-auto [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
        {[...base, ...base, ...base].map((event, i) => (
          <li key={i} aria-hidden={i < base.length || i >= base.length * 2 || undefined} className="stage-item -ml-8 shrink-0 snap-center snap-always sm:-ml-12">
            <div data-card className="stage-card relative">
            <Link to={`/events/${event.id}`} aria-label={t('View {0}', localized(lang, event.title, event.title_zh))} draggable={false}
              tabIndex={i < base.length || i >= base.length * 2 ? -1 : undefined}
              onClick={e => {
                if (isMobileViewport() && !e.metaKey && !e.ctrlKey && !e.shiftKey && !e.altKey) { e.preventDefault(); onSelect(event.id, e.currentTarget) }
              }}
              className="relative block aspect-[4/3] h-56 overflow-hidden shadow-[0_8px_28px_rgba(0,0,0,.7)] ring-1 ring-white/30 sm:h-80">
              <img src={event.cover_image_url!} alt={t('Poster for {0}', localized(lang, event.title, event.title_zh))} referrerPolicy="no-referrer" draggable={false} className="size-full object-cover" />
              <span className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/90 via-black/65 to-transparent px-4 pb-3 pt-16 text-white [text-shadow:0_1px_3px_rgb(0_0_0/.8)]">
                <span className="line-clamp-2 block text-sm font-bold leading-tight sm:text-base">{localized(lang, event.title, event.title_zh)}</span>
                <span className="line-clamp-1 mt-0.5 block text-xs text-white/80">{[eventGroups(event)[0] && t(eventGroups(event)[0]!.label), formatWhenShort(event.start_time, null, event.is_all_day)].filter(Boolean).join(' · ')}</span>
              </span>
            </Link>
            <span data-dim aria-hidden="true" className="pointer-events-none absolute inset-0 bg-black" style={{ opacity: DIM }} />
            </div>
          </li>
        ))}
      </ul>
      {([-1, 1] as const).map(dir => (
        <button key={dir} type="button" aria-label={dir < 0 ? t('Previous poster') : t('Next poster')} onClick={() => { pause(); step(dir) }}
          className={`absolute top-1/2 z-20 hidden size-11 -translate-y-1/2 place-items-center rounded-full bg-black/35 text-white backdrop-blur hover:bg-black/55 sm:grid ${dir < 0 ? 'left-4' : 'right-4'}`}>
          {dir < 0 ? <ChevronLeft className="size-6" aria-hidden="true" /> : <ChevronRight className="size-6" aria-hidden="true" />}
        </button>
      ))}
    </section>
  )
}
