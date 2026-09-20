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

export type WhenFilter = 'any' | 'today' | 'weekend' | 'week' | 'month'

export const WHEN_OPTIONS: { value: WhenFilter; label: string }[] = [
  { value: 'any', label: 'Any time' },
  { value: 'today', label: 'Today' },
  { value: 'weekend', label: 'This weekend' },
  { value: 'week', label: 'Next 7 days' },
  { value: 'month', label: 'Next 30 days' },
]

export function getRange(when: WhenFilter, now: Date): { from: Date; to: Date | null } {
  const p = zonedParts(now)
  const dow = new Date(Date.UTC(p.year, p.month - 1, p.day)).getUTCDay()
  const midnight = (offsetDays: number) => chicagoMidnight(p.year, p.month, p.day + offsetDays)

  switch (when) {
    case 'today':
      return { from: now, to: midnight(1) }
    case 'week':
      return { from: now, to: midnight(7) }
    case 'month':
      return { from: now, to: midnight(30) }
    case 'weekend': {
      if (dow === 0) return { from: now, to: midnight(1) }
      if (dow === 6) return { from: now, to: midnight(2) }
      const untilSat = 6 - dow
      const from = midnight(untilSat)
      return { from: from > now ? from : now, to: midnight(untilSat + 2) }
    }
    default:
      return { from: now, to: null }
  }
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

export function badgeParts(iso: string) {
  const d = new Date(iso)
  return { month: monthFormat.format(d).toUpperCase(), day: dayNumFormat.format(d) }
}

export type EventTag = 'Happening now' | 'Today' | 'Tomorrow'

const OPEN_ENDED_MS = 2 * 60 * 60 * 1000

export function eventTag(startIso: string, endIso: string | null, now = new Date()): EventTag | null {
  const start = new Date(startIso)
  const end = endIso ? new Date(endIso) : new Date(start.getTime() + OPEN_ENDED_MS)
  if (start <= now && now <= end) return 'Happening now'
  if (start < now) return null
  if (sameChicagoDay(start, now)) return 'Today'
  const p = zonedParts(now)
  const tomorrow = chicagoMidnight(p.year, p.month, p.day + 1)
  return sameChicagoDay(start, tomorrow) ? 'Tomorrow' : null
}

export function formatWhenShort(startIso: string, endIso: string | null): string {
  const start = new Date(startIso)
  const time = timeFormat.format(start)
  return `${dayFormat.format(start)} · ${time}${endIso ? ` – ${endTime(start, new Date(endIso))}` : ''}`
}

function endTime(start: Date, end: Date): string {
  return sameChicagoDay(start, end)
    ? timeFormat.format(end)
    : `${dayFormat.format(end)}, ${timeFormat.format(end)}`
}

export function formatWhenLong(startIso: string, endIso: string | null) {
  const start = new Date(startIso)
  const end = endIso ? new Date(endIso) : null
  return {
    date: longDayFormat.format(start),
    time: end ? `${timeFormat.format(start)} – ${endTime(start, end)}` : timeFormat.format(start),
  }
}
