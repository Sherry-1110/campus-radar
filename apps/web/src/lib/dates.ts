export const TZ = 'America/Chicago'

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

const dayFormat = new Intl.DateTimeFormat('en-US', {
  timeZone: TZ,
  weekday: 'short',
  month: 'short',
  day: 'numeric',
})
const longDayFormat = new Intl.DateTimeFormat('en-US', {
  timeZone: TZ,
  weekday: 'long',
  month: 'long',
  day: 'numeric',
  year: 'numeric',
})
const timeFormat = new Intl.DateTimeFormat('en-US', {
  timeZone: TZ,
  hour: 'numeric',
  minute: '2-digit',
})
const monthFormat = new Intl.DateTimeFormat('en-US', { timeZone: TZ, month: 'short' })
const dayNumFormat = new Intl.DateTimeFormat('en-US', { timeZone: TZ, day: 'numeric' })

function sameChicagoDay(a: Date, b: Date): boolean {
  const pa = zonedParts(a)
  const pb = zonedParts(b)
  return pa.year === pb.year && pa.month === pb.month && pa.day === pb.day
}

const weekdayFormat = new Intl.DateTimeFormat('en-US', { timeZone: TZ, weekday: 'short' })

export function badgeParts(iso: string) {
  const d = new Date(iso)
  return {
    month: monthFormat.format(d).toUpperCase(),
    day: dayNumFormat.format(d),
    weekday: weekdayFormat.format(d),
  }
}

/** Clock time only (no date or weekday), for compact event cards. */
export function formatTimeOnly(startIso: string, endIso: string | null, allDay = false): string {
  if (allDay) return 'All day'
  const start = timeFormat.format(new Date(startIso))
  if (!endIso) return start
  const end = timeFormat.format(new Date(endIso))
  return end === start ? start : `${start} – ${end}`
}

export function formatWhenShort(startIso: string, endIso: string | null, allDay = false): string {
  const start = new Date(startIso)
  if (allDay) return `${dayFormat.format(start)} · All day`
  const time = timeFormat.format(start)
  return `${dayFormat.format(start)} · ${time}${endIso ? ` – ${endTime(start, new Date(endIso))}` : ''}`
}

function endTime(start: Date, end: Date): string {
  return sameChicagoDay(start, end)
    ? timeFormat.format(end)
    : `${dayFormat.format(end)}, ${timeFormat.format(end)}`
}

export function formatWhenLong(startIso: string, endIso: string | null, allDay = false) {
  const start = new Date(startIso)
  const end = endIso ? new Date(endIso) : null
  return {
    date: longDayFormat.format(start),
    time: allDay ? 'All day' : end ? `${timeFormat.format(start)} – ${endTime(start, end)}` : timeFormat.format(start),
  }
}
