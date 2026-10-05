import { CalendarDays, CalendarPlus, Check, Copy, Download, ExternalLink, MapPin, Share2, Ticket } from 'lucide-react'
import { useState } from 'react'
import { CategoryChips } from './CategoryChip'
import { Poster } from './Poster'
import { SaveButton } from './SaveButton'
import { buttonPrimary, buttonSecondary } from './StateMessage'
import { downloadIcs, googleCalendarUrl } from '@/lib/calendar'
import { chicagoDateString, formatDateRange, formatWhenLong } from '@/lib/dates'
import { cardFee } from '@/lib/fee'
import { useSeriesDates, type EventRow } from '@/lib/events'
import { localized, useLang } from '@/lib/i18n'
import { eventPageUrl, googleMapsUrl } from '@/lib/maps'
const externalLink = 'inline-flex items-center gap-1 font-semibold text-brand-700 underline underline-offset-2'
const rowIcon = 'mt-0.5 text-brand-600'

export function EventDetail({ event }: { event: EventRow }) {
  const { lang, t } = useLang()
  const title = localized(lang, event.title, event.title_zh)
  const location = localized(lang, event.location ?? '', event.location_zh)
  const description = localized(lang, event.description ?? '', event.description_zh)
  const series = useSeriesDates(event.series_id)
  const dates = [...(series.data?.some(date => date.id === event.id) ? series.data : [event, ...(series.data ?? [])])]
    .sort((a, b) => a.start_time.localeCompare(b.start_time))
  const multi = dates.length > 1
  const when = formatWhenLong(event.start_time, event.end_time, event.is_all_day)
  const sameTime = dates.every(d => formatWhenLong(d.start_time, d.end_time, d.is_all_day).time === when.time)
  // Only state a time when it is known and shared by every date.
  const timeText = multi && !sameTime ? null : when.time
  const dateText = (multi && formatDateRange(dates[0].start_time, dates.at(-1)!.start_time)) || when.date
  const pageUrl = `${window.location.origin}/events/${event.id}`
  const [copied, setCopied] = useState(false)

  // Which calendar button the user pressed on a multi-date event, and the dates they chose.
  const [pick, setPick] = useState<'google' | 'ics' | null>(null)
  const dayOf = (d: { start_time: string }) => chicagoDateString(new Date(d.start_time))
  const [from, setFrom] = useState(() => dayOf(event))
  const [to, setTo] = useState('')
  // A single date, or every occurrence from the first date through the last.
  const [lo, hi] = [from, to || from].sort()
  const chosen = dates.filter(d => dayOf(d) >= lo && dayOf(d) <= hi)
  const live = chosen.filter(d => !d.is_cancelled)
  const toAdd = (live.length ? live : chosen).map(d => ({ ...event, ...d }) as EventRow)
  const asFile = pick === 'ics' || toAdd.length > 1
  function addToCalendar() {
    if (asFile) downloadIcs(toAdd, pageUrl)
    else window.open(googleCalendarUrl(toAdd[0], pageUrl), '_blank', 'noopener')
    setPick(null)
  }

  const eventPage = eventPageUrl(event)
  const mapUrl = googleMapsUrl(event.location, event.region)
  const price = cardFee(event)

  async function copyLink() {
    try {
      await navigator.clipboard.writeText(pageUrl)
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    } catch {
      window.prompt(t('Copy this link'), pageUrl)
    }
  }

  // Opens the system share sheet where the browser has one.
  async function shareLink(menu: HTMLDetailsElement | null) {
    if (menu) menu.open = false
    try {
      await navigator.share({ title, url: pageUrl })
    } catch (error) {
      if (!(error instanceof DOMException && error.name === 'AbortError')) await copyLink()
    }
  }

  return (
    <article className="grid grid-cols-[minmax(0,1fr)] gap-8 lg:grid-cols-[minmax(0,5fr)_minmax(0,6fr)] lg:gap-12">
      <div className="lg:sticky lg:top-6 lg:self-start">
        <div className="overflow-hidden rounded-3xl border border-line bg-brand-100 shadow-card">
          <div className="relative mx-auto w-full">
            <Poster natural src={event.cover_image_url} title={title} category={event.category} />
            <div className="absolute right-3 top-3"><SaveButton id={event.id} title={title} label /></div>
          </div>
        </div>
      </div>

      <div className="flex min-w-0 flex-col gap-6 [overflow-wrap:anywhere]">
        {event.is_cancelled && (
          <p role="status" className="rounded-xl bg-red-100 p-4 font-semibold text-red-800">
            {t('This event has been canceled. Check the organizer’s source page for updates.')}
          </p>
        )}
        <header className="flex flex-col gap-3">
          <div>
            <h1 className="inline text-3xl font-extrabold leading-tight tracking-tight sm:text-4xl">{title}</h1>
            {eventPage && (
              <a href={eventPage} target="_blank" rel="noopener noreferrer" className={`${externalLink} ml-3 align-middle text-sm`}>
                {t('View source')}
                <ExternalLink className="size-3.5" aria-hidden="true" />
                <span className="sr-only">{t('(opens in a new tab)')}</span>
              </a>
            )}
          </div>
          <CategoryChips event={event} />
        </header>

        <dl className="flex flex-col gap-4 rounded-2xl border border-line bg-surface p-5 shadow-card">
          <div className="flex gap-3">
            <dt className={rowIcon}>
              <CalendarDays className="size-5" aria-hidden="true" />
              <span className="sr-only">{t('When')}</span>
            </dt>
            <dd>
              <p className="font-semibold">{dateText}</p>
              {timeText && <p className="text-ink-muted">{t('{0} (Central Time)', timeText)}</p>}
            </dd>
          </div>
          {event.location && (
            <div className="flex gap-3">
              <dt className={rowIcon}>
                <MapPin className="size-5" aria-hidden="true" />
                <span className="sr-only">{t('Where')}</span>
              </dt>
              <dd className="font-semibold">
                {location}
                {mapUrl && (
                  <a href={mapUrl} target="_blank" rel="noopener noreferrer" className={`${externalLink} ml-2 align-baseline text-sm`}>
                    {t('Maps')}
                    <ExternalLink className="size-3.5" aria-hidden="true" />
                    <span className="sr-only">{t('(opens in a new tab)')}</span>
                  </a>
                )}
              </dd>
            </div>
          )}
          {price && (
            <div className="flex gap-3">
              <dt className={rowIcon}>
                <Ticket className="size-5" aria-hidden="true" />
                <span className="sr-only">{t('Price')}</span>
              </dt>
              <dd className="font-semibold">{t(price)}</dd>
            </div>
          )}
        </dl>

        <div className="flex flex-wrap gap-3">
          {!event.is_cancelled && (multi
            ? <button type="button" onClick={() => setPick('google')} className={buttonPrimary}>
                <CalendarPlus className="mr-2 size-4" aria-hidden="true" />
                {t('Add to Google Calendar')}
              </button>
            : <a href={googleCalendarUrl(event, pageUrl)} target="_blank" rel="noopener noreferrer" className={buttonPrimary}>
                <CalendarPlus className="mr-2 size-4" aria-hidden="true" />
                {t('Add to Google Calendar')}
                <span className="sr-only">{t('(opens in a new tab)')}</span>
              </a>)}
          <button type="button" onClick={() => multi ? setPick('ics') : downloadIcs(event, pageUrl)} className={buttonSecondary}>
            <Download className="size-4" aria-hidden="true" />
            {event.is_cancelled ? t('Download cancellation (.ics)') : t('Download .ics')}
          </button>
          <details className="relative" onToggle={e => {
            const menu = e.currentTarget
            if (!menu.open) return setCopied(false)
            // Align to the button's left edge, or its right edge when that would run off screen.
            const panel = menu.querySelector('div')!
            panel.style.left = '0'; panel.style.right = 'auto'
            if (panel.getBoundingClientRect().right > innerWidth - 8) { panel.style.left = 'auto'; panel.style.right = '0' }
          }}>
            <summary className={`${buttonSecondary} list-none [&::-webkit-details-marker]:hidden`}>
              <Share2 className="size-4" aria-hidden="true" />
              {t('Share')}
            </summary>
            <div className="absolute z-10 mt-2 flex min-w-48 flex-col rounded-xl border border-line bg-surface p-1 shadow-card-hover">
              <button type="button" onClick={copyLink} className="flex min-h-11 items-center gap-2 rounded-lg px-3 text-left text-sm font-semibold hover:bg-brand-50">
                {copied ? <Check className="size-4 text-free" aria-hidden="true" /> : <Copy className="size-4" aria-hidden="true" />}
                <span aria-live="polite">{copied ? t('Link copied') : t('Copy link')}</span>
              </button>
              {typeof navigator.share === 'function' && (
                <button type="button" onClick={e => shareLink(e.currentTarget.closest('details'))} className="flex min-h-11 items-center gap-2 rounded-lg px-3 text-left text-sm font-semibold hover:bg-brand-50">
                  <Share2 className="size-4" aria-hidden="true" />
                  {t('Share via…')}
                </button>
              )}
            </div>
          </details>
        </div>

        {multi && pick && (
          <fieldset className="flex flex-col gap-3 rounded-2xl border border-line bg-surface p-4">
            <legend className="px-1 text-sm font-bold">{t('Which dates? · Central Time')}</legend>
            <p className="text-sm text-ink-muted">{t('Pick a date, or add an end date for a range. This event runs {0}; days without an event are skipped.', dateText)}</p>
            <div className="grid gap-3 sm:grid-cols-2">
              <label className="flex flex-col gap-1 text-sm font-semibold">
                {t('Date')}
                <input type="date" value={from} min={dayOf(dates[0])} max={dayOf(dates.at(-1)!)} required
                  onChange={e => e.target.value && setFrom(e.target.value)}
                  className="min-h-11 w-full rounded-xl border border-line bg-surface px-3 font-normal" />
              </label>
              <label className="flex flex-col gap-1 text-sm font-semibold">
                {t('End date (optional)')}
                <input type="date" value={to} min={from} max={dayOf(dates.at(-1)!)}
                  onChange={e => setTo(e.target.value)}
                  className="min-h-11 w-full rounded-xl border border-line bg-surface px-3 font-normal" />
              </label>
            </div>
            {!chosen.length && <p role="status" className="text-sm font-semibold text-danger">{from === (to || from) ? t('No event on that date.') : t('No event on those dates.')}</p>}
            {pick === 'google' && toAdd.length > 1 && (
              <p className="text-sm text-ink-muted">{t('Google Calendar adds one date at a time, so several dates download as a calendar file you can import.')}</p>
            )}
            <div className="flex flex-wrap gap-3">
              <button type="button" onClick={addToCalendar} disabled={!chosen.length} className={`${buttonPrimary} disabled:opacity-50`}>
                {asFile ? <Download className="mr-2 size-4" aria-hidden="true" /> : <CalendarPlus className="mr-2 size-4" aria-hidden="true" />}
                {asFile ? t(toAdd.length === 1 ? 'Download .ics ({0} date)' : 'Download .ics ({0} dates)', toAdd.length) : t('Add to Google Calendar')}
              </button>
              <button type="button" onClick={() => setPick(null)} className={buttonSecondary}>{t('Cancel')}</button>
            </div>
          </fieldset>
        )}

        {description && (
          <section aria-labelledby="about-heading">
            <h2 id="about-heading" className="mb-2 text-xl font-bold">{t('About this event')}</h2>
            <p className="max-w-prose whitespace-pre-line leading-relaxed text-ink">{description}</p>
          </section>
        )}
      </div>
    </article>
  )
}
