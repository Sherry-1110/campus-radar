import type { Candidate, FetchText, SourceResult } from '../types.ts'
import { endOfLocalDay } from './shared.ts'

// Northwestern Athletics (Sidearm) schedule API, the data behind nusports.com/all-sports-schedule.
const API = 'https://nusports.com/website-api/schedule-events?filter%5Bupcoming%5D=1&sort=datetime&per_page=100&include=opponentLogo,opponent.officialLogo,opponent.customLogo,schedule.sport'
// Tournament-style "opponents" read better as an event name than as "vs. …".
const MEET = /\b(invitational|classic|championships?|tournament|open|meet|regatta|nac|regional|intercollegiate|relays?|cup)\b/i

interface SidearmEvent {
  id: number
  datetime: string
  datetime_end: string | null
  is_all_day: boolean
  tba: string | null
  venue_type: 'home' | 'away' | 'neutral'
  venue: string | null
  location: string | null
  status: string | null
  opponent_name: string | null
  /** The logo nusports.com shows for this game (also set for tournaments). */
  opponent_logo?: { url: string } | null
  opponent: { official_logo: { url: string } | null; custom_logo: { url: string } | null } | null
  schedule: { sport: { name: string; slug: string } | null } | null
}

interface Page { data: SidearmEvent[]; meta: { current_page: number; last_page: number } }

/** Only games a student can go to: home games, and neutral-site games in Evanston or Chicago. */
export function attendable(event: SidearmEvent): boolean {
  return event.venue_type === 'home' || (event.venue_type === 'neutral' && /\b(Evanston|Chicago), Ill/i.test(event.location ?? ''))
}

export function toCandidate(event: SidearmEvent): Candidate {
  const sport = event.schedule?.sport
  const opponent = event.opponent_name?.trim()
  if (!sport?.name || !sport.slug || !opponent || !event.datetime) throw new Error(`NU Athletics ${event.id}: missing sport, opponent or date`)
  const start = Date.parse(event.datetime)
  if (!Number.isFinite(start)) throw new Error(`NU Athletics ${event.id}: invalid date ${event.datetime}`)
  const allDay = event.is_all_day || Boolean(event.tba)
  const end = event.datetime_end ? Date.parse(event.datetime_end) : null
  const title = MEET.test(opponent) ? `Northwestern ${sport.name}: ${opponent}` : `Northwestern ${sport.name} vs. ${opponent}`
  const place = [event.venue, event.location].filter(Boolean).join(', ') || null
  // The opponent's logo; the site shows it beside Northwestern's as a matchup instead of a poster.
  const logo = event.opponent_logo?.url || event.opponent?.custom_logo?.url || event.opponent?.official_logo?.url || null
  return {
    external_id: String(event.id),
    related_url: null,
    data: {
      title,
      description: `${sport.name} — Northwestern Wildcats ${event.venue_type === 'home' ? 'home ' : ''}game against ${opponent}${place ? ` at ${place}` : ''}.`,
      cover_image_url: logo && /^https:\/\/(storage\.googleapis\.com\/nusports-com-prod|nusports\.com\/imgproxy)\//.test(logo) ? logo : null,
      start_time: new Date(start).toISOString(),
      end_time: allDay ? endOfLocalDay(end ?? start, 'CT') : end && end >= start ? new Date(end).toISOString() : null,
      location: place,
      location_url: null,
      is_free: false,
      fee_text: null,
      category: 'sports',
      is_cancelled: /cancel/i.test(event.status ?? ''),
      is_all_day: allDay,
      source_url: `https://nusports.com/sports/${sport.slug}/schedule`,
    },
  }
}

export async function fetchNuSports(fetchText: FetchText): Promise<SourceResult> {
  const result: SourceResult = { items: [], warnings: [] }
  for (let page = 1, last = 1; page <= last; page++) {
    const body = JSON.parse(await fetchText(`${API}&page=${page}`)) as Page
    if (!Array.isArray(body.data) || !body.meta?.last_page) throw new Error('NU Athletics: unexpected schedule response')
    last = Math.min(body.meta.last_page, 20)
    for (const event of body.data) if (attendable(event)) result.items.push(toCandidate(event))
  }
  return result
}
