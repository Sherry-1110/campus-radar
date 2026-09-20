import { load } from 'cheerio'
import type { Candidate, Category } from '../types.ts'

type Row = Record<string, unknown>
export const record = (value: unknown): Row => value !== null && typeof value === 'object' && !Array.isArray(value) ? value as Row : {}
export const list = (value: unknown): unknown[] => value === undefined ? [] : Array.isArray(value) ? value : [value]
export const field = (value: unknown): unknown => Array.isArray(value) ? record(value[0]).value : value
export const string = (value: unknown): string => typeof value === 'string' || typeof value === 'number' ? String(value) : ''
export const enabled = (value: unknown): boolean => [true, 1, '1'].includes(field(value) as boolean | number | string)
export const disabled = (value: unknown): boolean => [false, 0, '0'].includes(field(value) as boolean | number | string)

export function text(value: unknown): string {
  const $ = load(string(value), null, false)
  $('script,style').remove()
  $('br').replaceWith('\n')
  $('p,div,li,h1,h2,h3,h4').append('\n\n')
  return $.root().text().replace(/\u00a0/g, ' ').replace(/[ \t]+/g, ' ').replace(/ *\n */g, '\n').replace(/\n{3,}/g, '\n\n').trim()
}

export function url(value: unknown, base?: string): string | null {
  const raw = string(value).trim()
  if (!raw) return null
  try {
    const parsed = new URL(raw, base)
    if (!['https:', 'http:'].includes(parsed.protocol)) throw new Error('unsupported protocol')
    return parsed.href
  } catch { throw new Error(`Invalid source URL: ${raw}`) }
}

export function iso(value: unknown): string {
  const raw = string(value)
  if (!raw || !/(?:Z|[+-]\d\d:\d\d)$/.test(raw) || !Number.isFinite(Date.parse(raw))) throw new Error(`Invalid event datetime: ${raw}`)
  return new Date(raw).toISOString()
}

export function epoch(value: unknown): number {
  const raw = string(value)
  if (!/^\d+$/.test(raw) || !Number.isFinite(new Date(Number(raw) * 1000).getTime())) throw new Error(`Invalid event epoch: ${raw}`)
  return Number(raw) * 1000
}

export function endOfLocalDay(start: number, abbreviation: string): string {
  const zone = ({ CT: 'America/Chicago', ET: 'America/New_York', MT: 'America/Denver', PT: 'America/Los_Angeles', AST: 'Asia/Qatar' } as Record<string, string>)[abbreviation || 'CT']
  if (!zone) throw new Error(`Unsupported event timezone: ${abbreviation}`)
  const date = new Intl.DateTimeFormat('en-CA', { timeZone: zone, year: 'numeric', month: '2-digit', day: '2-digit' }).format(start)
  const midnight = Date.parse(`${date}T00:00:00Z`) + 86_400_000
  let next = midnight
  for (let i = 0; i < 3; i++) {
    const offset = new Intl.DateTimeFormat('en', { timeZone: zone, timeZoneName: 'shortOffset' }).formatToParts(next).find(p => p.type === 'timeZoneName')!.value
    const match = /GMT([+-])(\d+)(?::(\d+))?/.exec(offset)
    const minutes = match ? (Number(match[2]) * 60 + Number(match[3] || 0)) * (match[1] === '-' ? -1 : 1) : 0
    next = midnight - minutes * 60_000
  }
  return new Date(next - 1).toISOString()
}

export function cancelled(title: string, body = ''): boolean {
  const marker = /^(?:\[|\()?cancel(?:l)?ed(?:\]|\)|\s|:|$)/i
  if (marker.test(title) || /\(cancel(?:l)?ed\)\s*$/i.test(title)) return true
  const $ = load(body, null, false)
  return $('h1,h2,h3,h4,strong').toArray().some(el => marker.test(text($(el).html())))
}

export function category(value: string): Category {
  if (/music|concert|recital|orchestra/i.test(value)) return 'music'
  if (/arts|theat|film|humanities/i.test(value)) return 'arts'
  if (/fitness|sport/i.test(value)) return 'sports'
  if (/wellness|health/i.test(value)) return 'wellness'
  if (/career|workplace/i.test(value)) return 'career'
  if (/social/i.test(value)) return 'social'
  if (/academic|science|lecture/i.test(value)) return 'academic'
  return 'other'
}

export function description(body: unknown, registration: string | null): string | null {
  return [text(body), registration ? `Registration: ${registration}` : ''].filter(Boolean).join('\n\n') || null
}

export function deduplicate(items: Candidate[]): Candidate[] {
  const seen = new Map<string, Candidate>()
  for (const item of items) {
    const prior = seen.get(item.external_id)
    if (prior && JSON.stringify(prior) !== JSON.stringify(item)) throw new Error(`Conflicting occurrence identity: ${item.external_id}`)
    seen.set(item.external_id, item)
  }
  return [...seen.values()]
}

