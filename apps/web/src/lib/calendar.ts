import type { EventRow } from './events'

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

export function googleCalendarUrl(event: EventRow, pageUrl: string): string {
  const params = new URLSearchParams({
    action: 'TEMPLATE',
    text: event.title,
    dates: `${icsDate(new Date(event.start_time))}/${icsDate(endOf(event))}`,
    details: [event.description, pageUrl].filter(Boolean).join('\n\n'),
    location: event.location ?? '',
  })
  return `https://calendar.google.com/calendar/render?${params.toString()}`
}

export function downloadIcs(event: EventRow, pageUrl: string): void {
  const lines = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//Campus Radar//EN',
    'BEGIN:VEVENT',
    `UID:${event.id}@campus-radar`,
    `DTSTAMP:${icsDate(new Date())}`,
    `DTSTART:${icsDate(new Date(event.start_time))}`,
    `DTEND:${icsDate(endOf(event))}`,
    `SUMMARY:${icsEscape(event.title)}`,
    ...(event.location ? [`LOCATION:${icsEscape(event.location)}`] : []),
    `DESCRIPTION:${icsEscape([event.description, pageUrl].filter(Boolean).join('\n\n'))}`,
    `URL:${pageUrl}`,
    'END:VEVENT',
    'END:VCALENDAR',
  ]
  const blob = new Blob([lines.join('\r\n')], { type: 'text/calendar;charset=utf-8' })
  const href = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = href
  a.download = `${event.title.replace(/[^\w-]+/g, '-').slice(0, 60) || 'event'}.ics`
  document.body.append(a)
  a.click()
  a.remove()
  URL.revokeObjectURL(href)
}
