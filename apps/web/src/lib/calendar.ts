import type { EventRow } from './events'
import { zonedParts } from './dates.ts'

const DEFAULT_DURATION_MS = 60 * 60 * 1000

function icsDate(d: Date): string {
  return d.toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '')
}

function endOf(event: Pick<EventRow, 'start_time' | 'end_time'>): Date {
  return event.end_time
    ? new Date(event.end_time)
    : new Date(new Date(event.start_time).getTime() + DEFAULT_DURATION_MS)
}

function icsEscape(text: string): string {
  return text.replace(/\\/g, '\\\\').replace(/;/g, '\\;').replace(/,/g, '\\,').replace(/\r?\n/g, '\\n')
}

function allDayDates(event: EventRow): [string, string] {
  const start = zonedParts(new Date(event.start_time))
  const end = zonedParts(new Date(event.end_time ?? event.start_time))
  const day = (year: number, month: number, date: number) =>
    new Date(Date.UTC(year, month - 1, date)).toISOString().slice(0, 10).replaceAll('-', '')
  // Source all-day end is inclusive; calendar formats require exclusive next day.
  return [day(start.year, start.month, start.day), day(end.year, end.month, end.day + 1)]
}

export function googleCalendarUrl(event: EventRow, pageUrl: string): string {
  const params = new URLSearchParams({
    action: 'TEMPLATE',
    text: event.title,
    dates: event.is_all_day ? allDayDates(event).join('/') : `${icsDate(new Date(event.start_time))}/${icsDate(endOf(event))}`,
    details: [event.description, pageUrl].filter(Boolean).join('\n\n'),
    location: event.location ?? '',
  })
  return `https://calendar.google.com/calendar/render?${params.toString()}`
}

export function renderIcs(event: EventRow, pageUrl: string): string {
  const days = event.is_all_day ? allDayDates(event) : null
  const lines = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//Campus Radar//EN',
    'BEGIN:VEVENT',
    `UID:${event.id}@campus-radar`,
    `DTSTAMP:${icsDate(new Date())}`,
    days ? `DTSTART;VALUE=DATE:${days[0]}` : `DTSTART:${icsDate(new Date(event.start_time))}`,
    days ? `DTEND;VALUE=DATE:${days[1]}` : `DTEND:${icsDate(endOf(event))}`,
    `STATUS:${event.is_cancelled ? 'CANCELLED' : 'CONFIRMED'}`,
    `SUMMARY:${icsEscape(event.title)}`,
    ...(event.location ? [`LOCATION:${icsEscape(event.location)}`] : []),
    `DESCRIPTION:${icsEscape([event.description, pageUrl].filter(Boolean).join('\n\n'))}`,
    `URL:${pageUrl}`,
    'END:VEVENT',
    'END:VCALENDAR',
  ]
  return lines.join('\r\n') + '\r\n'
}

export function downloadIcs(event: EventRow, pageUrl: string): void {
  const blob = new Blob([renderIcs(event, pageUrl)], { type: 'text/calendar;charset=utf-8' })
  const href = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = href
  a.download = `${event.title.replace(/[^\w-]+/g, '-').slice(0, 60) || 'event'}.ics`
  document.body.append(a)
  a.click()
  a.remove()
  URL.revokeObjectURL(href)
}
