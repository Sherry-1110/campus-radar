import {
  Dumbbell,
  Gamepad2,
  Music,
  Palette,
  PartyPopper,
  Sparkles,
  Store,
  type LucideIcon,
} from 'lucide-react'
import { CATEGORY_GROUPS, groupOf, type CategoryGroup, type DbCategory } from './categoryGroups'

export type EventCategory = DbCategory

export interface CategoryMeta {
  value: CategoryGroup | 'event'
  label: string
  icon: LucideIcon
  gradient: string
}

const LOOK: Record<CategoryGroup, { icon: LucideIcon; gradient: string }> = {
  music: { icon: Music, gradient: 'from-indigo-500 to-violet-800' },
  arts: { icon: Palette, gradient: 'from-fuchsia-500 to-purple-700' },
  sports: { icon: Dumbbell, gradient: 'from-emerald-500 to-teal-700' },
  activities: { icon: Gamepad2, gradient: 'from-lime-400 to-green-700' },
  fests: { icon: Store, gradient: 'from-amber-500 to-orange-700' },
  parties: { icon: PartyPopper, gradient: 'from-pink-500 to-rose-700' },
}

// Talks, careers and anything else outside the six categories.
const EVENT: CategoryMeta = { value: 'event', label: 'Event', icon: Sparkles, gradient: 'from-violet-400 to-purple-700' }

const BY_GROUP = Object.fromEntries(
  CATEGORY_GROUPS.map((g) => [g.value, { value: g.value, label: g.label, ...LOOK[g.value] }]),
) as Record<CategoryGroup, CategoryMeta>

/** Look and label for an event's category (exhibitions show as Arts, etc.). */
export function categoryMeta(category: EventCategory): CategoryMeta {
  const group = groupOf(category)
  return group ? BY_GROUP[group] : EVENT
}

/** The site categories an event belongs to, at most three, in its own order. Empty for talks and the like. */
export function eventGroups(event: { category: EventCategory; categories?: EventCategory[] }): CategoryMeta[] {
  const all = event.categories?.length ? event.categories : [event.category]
  return [...new Map(all.flatMap((c) => { const g = groupOf(c); return g ? [[g, BY_GROUP[g]] as const] : [] })).values()].slice(0, 3)
}

/** The look for a poster placeholder: the event's first site category, or a neutral one. */
export function posterMeta(event: { category: EventCategory; categories?: EventCategory[] }): CategoryMeta {
  return eventGroups(event)[0] ?? EVENT
}
