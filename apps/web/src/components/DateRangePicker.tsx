import { CalendarDays, ChevronLeft, ChevronRight } from 'lucide-react'
import { useEffect, useId, useRef, useState } from 'react'
import { chicagoDateString } from '@/lib/dates'
import { useLang } from '@/lib/i18n'

interface DateRangePickerProps {
  /** YYYY-MM-DD of the chosen day or the first day of the range; null when no dates are chosen. */
  from: string | null
  /** YYYY-MM-DD of the last day of the range; null for a single day. */
  to: string | null
  onPick: (from: string, to: string | null) => void
  onClear: () => void
}

// Calendar arithmetic on plain dates, done in UTC so no time zone can shift a day.
const toKey = (d: Date) => d.toISOString().slice(0, 10)
const parse = (key: string) => new Date(`${key}T00:00:00Z`)
const addDays = (key: string, n: number) => { const d = parse(key); d.setUTCDate(d.getUTCDate() + n); return toKey(d) }

/**
 * A button that opens a month calendar. Tap a day to see that day; tap a later day to stretch it into a range.
 */
export function DateRangePicker({ from, to, onPick, onClear }: DateRangePickerProps) {
  const { lang, t } = useLang()
  const locale = lang === 'zh' ? 'zh-CN' : 'en-US'
  const today = chicagoDateString(new Date())
  const [open, setOpen] = useState(false)
  const [month, setMonth] = useState(() => (from ?? today).slice(0, 7))
  // The first day of a range waiting for its second tap.
  const [pending, setPending] = useState<string | null>(null)
  const rootRef = useRef<HTMLDivElement>(null)
  const panelId = useId()

  useEffect(() => {
    if (!open) return
    const onPointerDown = (e: PointerEvent) => { if (!rootRef.current?.contains(e.target as Node)) setOpen(false) }
    const onKeyDown = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false) }
    document.addEventListener('pointerdown', onPointerDown)
    document.addEventListener('keydown', onKeyDown)
    return () => {
      document.removeEventListener('pointerdown', onPointerDown)
      document.removeEventListener('keydown', onKeyDown)
    }
  }, [open])

  const pick = (day: string) => {
    if (pending && day >= pending) {
      onPick(pending, day > pending ? day : null)
      setPending(null)
      setOpen(false)
    } else {
      onPick(day, null)
      setPending(day)
    }
  }

  const short = new Intl.DateTimeFormat(locale, { timeZone: 'UTC', month: 'short', day: 'numeric' })
  const label = from ? (to ? `${short.format(parse(from))} – ${short.format(parse(to))}` : short.format(parse(from))) : t('Pick dates')

  const first = parse(`${month}-01`)
  const daysInMonth = new Date(Date.UTC(first.getUTCFullYear(), first.getUTCMonth() + 1, 0)).getUTCDate()
  const cells: (string | null)[] = [
    ...Array<null>(first.getUTCDay()).fill(null),
    ...Array.from({ length: daysInMonth }, (_, i) => addDays(`${month}-01`, i)),
  ]
  const shiftMonth = (n: number) => setMonth(toKey(new Date(Date.UTC(first.getUTCFullYear(), first.getUTCMonth() + n, 1))).slice(0, 7))
  const weekdays = Array.from({ length: 7 }, (_, i) => new Intl.DateTimeFormat(locale, { timeZone: 'UTC', weekday: 'narrow' }).format(new Date(Date.UTC(2026, 0, 4 + i))))
  const end = to ?? from

  return (
    <div ref={rootRef} className="relative">
      <button
        type="button"
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-controls={open ? panelId : undefined}
        aria-label={from ? `${t('Pick dates')} (${label})` : t('Pick dates')}
        onClick={() => { setOpen(o => !o); setPending(null) }}
        className={`inline-flex min-h-11 items-center justify-center gap-2 rounded-xl border text-sm font-bold shadow-card motion-safe:transition max-sm:size-11 sm:px-3 ${
          from ? 'border-brand-700 bg-brand-50 text-brand-800' : 'border-line bg-surface text-ink hover:border-brand-300'
        }`}
      >
        <CalendarDays className="size-5 sm:size-4" aria-hidden="true" />
        {/* Icon only on phones. */}
        <span className="whitespace-nowrap max-sm:hidden">{label}</span>
      </button>

      {open && (
        <div id={panelId} role="dialog" aria-label={t('Pick dates')}
          className="absolute left-0 z-30 mt-2 w-72 rounded-xl border border-line bg-surface p-3 shadow-card-hover max-sm:fixed max-sm:inset-x-4 max-sm:w-auto">
          <div className="mb-2 flex items-center justify-between">
            <button type="button" aria-label={t('Previous month')} disabled={month <= today.slice(0, 7)} onClick={() => shiftMonth(-1)}
              className="grid size-9 place-items-center rounded-lg hover:bg-brand-50 disabled:opacity-30"><ChevronLeft className="size-5" aria-hidden="true" /></button>
            <p className="font-bold">{new Intl.DateTimeFormat(locale, { timeZone: 'UTC', month: 'long', year: 'numeric' }).format(first)}</p>
            <button type="button" aria-label={t('Next month')} onClick={() => shiftMonth(1)}
              className="grid size-9 place-items-center rounded-lg hover:bg-brand-50"><ChevronRight className="size-5" aria-hidden="true" /></button>
          </div>
          <div className="grid grid-cols-7 text-center text-xs font-semibold text-ink-muted" aria-hidden="true">
            {weekdays.map((w, i) => <span key={i} className="py-1">{w}</span>)}
          </div>
          <div className="grid grid-cols-7 gap-y-1 text-center text-sm">
            {cells.map((day, i) => {
              if (!day) return <span key={i} />
              const past = day < today
              const edge = day === from || day === end
              const inside = from && end && day > from && day < end
              return (
                <button key={day} type="button" disabled={past} aria-pressed={Boolean(edge || inside)} onClick={() => pick(day)}
                  className={`mx-auto grid size-9 place-items-center rounded-full disabled:text-ink-muted/40 ${
                    edge ? 'bg-brand-700 font-bold text-white' : inside ? 'bg-brand-100 text-brand-800' : 'hover:bg-brand-50'
                  } ${day === today && !edge ? 'font-bold text-brand-700' : ''}`}>
                  {Number(day.slice(8))}
                </button>
              )
            })}
          </div>
          <div className="mt-3 flex items-center justify-between gap-2 text-xs text-ink-muted">
            <span>{pending ? t('Tap a later date to choose a range') : t('Tap a date, or two for a range')}</span>
            {from && <button type="button" onClick={() => { onClear(); setPending(null); setOpen(false) }} className="min-h-9 shrink-0 rounded-lg px-2 font-bold text-brand-700 hover:bg-brand-50">{t('Clear')}</button>}
          </div>
        </div>
      )}
    </div>
  )
}
