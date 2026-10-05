import { load } from 'cheerio'
import type { FetchText, SourceResult } from '../types.ts'
import { endOfLocalDay, record, url } from './shared.ts'

// Choose Chicago's monthly editorial pick list. Big festivals (the marathon, house tours, museum shows)
// appear here but never in its event-calendar API, which the 'choose-chicago' source already reads.
const ORIGIN = 'https://www.choosechicago.com'
export const ARTICLE = `${ORIGIN}/blog/special-events/things-to-do-in-chicago-this-month/`
const MONTHS = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec']
const MONTH = String.raw`(jan|feb|mar|apr|may|jun|jul|aug|sept?|oct|nov|dec)[a-z]*\.?`
const DATES = new RegExp(String.raw`^(through|until|starting|beginning)?\s*${MONTH}(?:\s+(\d{1,2}))?(?:\s*-\s*(?:${MONTH}\s+)?(\d{1,2}))?$`)
const DAY = 86_400_000

export interface Pick { name: string; link: string; dates: string; free: boolean }

/** Each pick is a paragraph: a bold name linking to the organizer, then "(dates): why to go". */
export function parseArticle(html: string): Pick[] {
  const $ = load(html)
  const picks: Pick[] = []
  $('h2').filter((_, h) => /events in Chicago/i.test($(h).text())).each((_, h) => {
    $(h).nextUntil('h2,h3').find('p').addBack('p').each((_, p) => {
      const lead = $(p).children().first()
      if (!lead.is('b,strong') && !lead.children('b,strong').length) return
      const name = lead.text().replace(/\s+/g, ' ').trim()
      const href = lead.is('a') ? lead.attr('href') : lead.find('a').first().attr('href')
      const rest = /^\s*\(([^)]+)\)\s*:?\s*([\s\S]*)$/.exec($(p).text().slice(lead.text().length).replace(/ /g, ' '))
      if (!name || !href || !rest) return
      picks.push({ name, link: url(href)!, dates: rest[1]!.trim(), free: /\b(?:this|a|is|are)\s+free\b/i.test(rest[2]!) })
    })
  })
  return picks
}

const ymd = (y: number, m: number, d: number) => new Date(Date.UTC(y, m, d)).toISOString().slice(0, 10)

/** "Oct. 4", "Oct. 9– 11", "Oct. 30 – Nov. 2", "through Oct. 11", "starting Oct. 3", "through October" → first and last day. */
export function parseDates(text: string, today: string): [string, string] | null {
  const m = DATES.exec(text.toLowerCase().replace(/[–—]/g, '-').replace(/\s+/g, ' ').trim())
  if (!m) return null
  const [, prefix, month1, day1, month2, day2] = m
  const mo1 = MONTHS.indexOf(month1!.slice(0, 3))
  const mo2 = month2 ? MONTHS.indexOf(month2.slice(0, 3)) : mo1
  // A month earlier than half a year ago belongs to next year (a December article listing January).
  const thisYear = Number(today.slice(0, 4)), nowMonth = Number(today.slice(5, 7)) - 1
  const y1 = thisYear + (mo1 < nowMonth - 6 ? 1 : 0), y2 = y1 + (mo2 < mo1 ? 1 : 0)
  const monthEnd = ymd(y1, mo1 + 1, 0)
  const first = day1 ? ymd(y1, mo1, Number(day1)) : ymd(y1, mo1, 1)
  const last = day2 ? ymd(y2, mo2, Number(day2)) : day1 ? first : monthEnd
  if (prefix === 'through' || prefix === 'until') return [today, day1 ? first : monthEnd]
  // ponytail: "starting Oct. 3" has no stated end; assume the article's month.
  if (prefix === 'starting' || prefix === 'beginning') return [first, monthEnd]
  return [first, last]
}

/** Chicago midnight at the start of a YYYY-MM-DD day. */
const startOfDay = (date: string) => new Date(Date.parse(endOfLocalDay(Date.parse(`${date}T12:00:00Z`) - DAY, 'CT')) + 1).toISOString()
const normal = (s: string) => s.normalize('NFKD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/&#\d+;|&\w+;/g, ' ').replace(/[^a-z0-9]+/g, ' ').replace(/^the /, '').trim()
const host = (href: string) => new URL(href).hostname.replace(/^www\./, '')

/** True when the event calendar already lists this pick: a title containing its name, or the same organizer homepage. */
export function listed(pick: Pick, calendar: { title?: unknown; website?: unknown }[]): boolean {
  const name = normal(pick.name)
  const homepage = new URL(pick.link).pathname.replace(/\/+$/, '') === ''
  return calendar.some(e => {
    const title = normal(String(e.title ?? ''))
    const short = title.length < name.length ? title : name
    if (short.length >= 10 && (title.includes(name) || name.includes(title))) return true
    try { return homepage && host(String(e.website)) === host(pick.link) } catch { return false }
  })
}

export async function fetchChicagoRoundups(fetchText: FetchText, now = new Date()): Promise<SourceResult> {
  const result: SourceResult = { items: [], warnings: [] }
  const today = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Chicago' }).format(now)
  const picks = parseArticle(await fetchText(ARTICLE))
  if (picks.length < 5) throw new Error(`Chicago roundups: only ${picks.length} picks found; the article layout may have changed`)
  for (const pick of picks) {
    const range = parseDates(pick.dates, today)
    if (!range) { result.warnings.push(`Chicago roundups: unreadable dates "${pick.dates}" for ${pick.name}`); continue }
    // ponytail: an event already under way is shown as starting today, so date filters keep finding it.
    const [first, last] = [range[0] < today ? today : range[0], range[1]]
    if (last < today) continue
    const search = new URL(`${ORIGIN}/wp-json/tribe/events/v1/events`)
    search.search = new URLSearchParams({ search: pick.name, start_date: `${first} 00:00:00`, end_date: `${last} 23:59:59`, per_page: '50', status: 'publish' }).toString()
    const calendar = record(JSON.parse(await fetchText(search.href))).events
    if (Array.isArray(calendar) && listed(pick, calendar.map(record))) continue
    result.items.push({
      external_id: `${range[0].slice(0, 4)}:${normal(pick.name).replace(/ /g, '-')}`,
      // The organizer page supplies the description and poster through enrichment.
      related_url: pick.link,
      data: {
        title: pick.name, description: null, cover_image_url: null,
        start_time: startOfDay(first), end_time: endOfLocalDay(Date.parse(`${last}T12:00:00Z`), 'CT'), is_all_day: true,
        location: null, location_url: null, is_free: pick.free, fee_text: null, category: 'other', is_cancelled: false,
        source_url: ARTICLE,
      },
    })
  }
  return result
}
