export const TZ = 'America/Chicago'

let locale = 'en-US'
/** Day, month and time text follow the site language; the time zone is always Chicago. */
export function setDateLocale(lang: 'en' | 'zh') { locale = lang === 'zh' ? 'zh-CN' : 'en-US' }
const formatters = new Map<string, Intl.DateTimeFormat>()
const localized = (options: Intl.DateTimeFormatOptions) => ({
  format(date: Date) {
    const key = locale + JSON.stringify(options)
    let formatter = formatters.get(key)
    if (!formatter) formatters.set(key, formatter = new Intl.DateTimeFormat(locale, { timeZone: TZ, ...options }))
    return formatter.format(date)
  },
})
const withYear = (text: string, year: number) => locale === 'zh-CN' ? `${year}年${text}` : `${text}, ${year}`

interface ZonedParts {
  year: number
  month: number
  day: number
  hour: number
  minute: number
  second: number
}

const partsFormat = new Intl.DateTimeFormat('en-US', {
  timeZone: TZ,
  year: 'numeric',
  month: 'numeric',
  day: 'numeric',
  hour: 'numeric',
  minute: 'numeric',
  second: 'numeric',
  hourCycle: 'h23',
})

export function zonedParts(date: Date): ZonedParts {
  const out: Record<string, number> = {}
  for (const p of partsFormat.formatToParts(date)) {
    if (p.type !== 'literal') out[p.type] = Number(p.value)
  }
  return out as unknown as ZonedParts
}

function tzOffsetMs(date: Date): number {
  const p = zonedParts(date)
  const asUtc = Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second)
  return asUtc - Math.floor(date.getTime() / 1000) * 1000
}

// Instant of 00:00 Chicago time on the given calendar day (day may overflow).
export function chicagoMidnight(year: number, month: number, day: number): Date {
  const guess = Date.UTC(year, month - 1, day)
  const first = guess - tzOffsetMs(new Date(guess))
  return new Date(guess - tzOffsetMs(new Date(first)))
}

/** Today's date in Chicago as YYYY-MM-DD (the value format of <input type="date">). */
export function chicagoDateString(now: Date): string {
  const p = zonedParts(now)
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${p.year}-${pad(p.month)}-${pad(p.day)}`
}

export function startOfChicagoDay(now: Date): Date {
  const p = zonedParts(now)
  return chicagoMidnight(p.year, p.month, p.day)
}

const dayFormat = localized({ weekday: 'short', month: 'short', day: 'numeric' })
const longDayFormat = localized({ weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' })
const timeFormat = localized({ hour: 'numeric', minute: '2-digit' })
const monthFormat = localized({ month: 'short' })
const dayNumFormat = localized({ day: 'numeric' })

function sameChicagoDay(a: Date, b: Date): boolean {
  const pa = zonedParts(a)
  const pb = zonedParts(b)
  return pa.year === pb.year && pa.month === pb.month && pa.day === pb.day
}

const weekdayFormat = localized({ weekday: 'short' })

export function badgeParts(iso: string) {
  const d = new Date(iso)
  return {
    month: monthFormat.format(d).toUpperCase(),
    day: dayNumFormat.format(d),
    weekday: weekdayFormat.format(d),
  }
}

export function formatWhenShort(startIso: string, endIso: string | null, allDay = false): string {
  const start = new Date(startIso)
  // "All day" often just means the source gave no time, so show the date alone.
  if (allDay) return dayFormat.format(start)
  const time = timeFormat.format(start)
  return `${dayFormat.format(start)} · ${time}${endIso ? ` – ${endTime(start, new Date(endIso))}` : ''}`
}

function endTime(start: Date, end: Date): string {
  return sameChicagoDay(start, end)
    ? timeFormat.format(end)
    : `${dayFormat.format(end)}, ${timeFormat.format(end)}`
}

const monthDayFormat = { long: localized({ month: 'long', day: 'numeric' }), short: localized({ month: 'short', day: 'numeric' }) }

/** "October 9 – October 16, 2026" (or "Oct 9 – Oct 16" when short); null when both fall on the same Chicago day. */
export function formatDateRange(firstIso: string, lastIso: string, style: 'long' | 'short' = 'long'): string | null {
  const a = new Date(firstIso)
  const b = new Date(lastIso)
  if (sameChicagoDay(a, b)) return null
  const ya = zonedParts(a).year
  const yb = zonedParts(b).year
  const f = monthDayFormat[style]
  if (ya !== yb) return `${withYear(f.format(a), ya)} – ${withYear(f.format(b), yb)}`
  return style === 'long' ? withYear(`${f.format(a)} – ${f.format(b)}`, ya) : `${f.format(a)} – ${f.format(b)}`
}

export function formatWhenLong(startIso: string, endIso: string | null, allDay = false) {
  const start = new Date(startIso)
  const end = endIso ? new Date(endIso) : null
  return {
    date: longDayFormat.format(start),
    time: allDay ? '' : end ? `${timeFormat.format(start)} – ${endTime(start, end)}` : timeFormat.format(start),
  }
}
