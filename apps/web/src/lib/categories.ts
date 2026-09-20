import {
  Dumbbell,
  GraduationCap,
  Palette,
  PartyPopper,
  Sparkles,
  Utensils,
  type LucideIcon,
} from 'lucide-react'
import { CATEGORY_GROUPS, groupOf, type CategoryGroup, type DbCategory } from './categoryGroups'

export type EventCategory = DbCategory

interface CategoryMeta {
  value: CategoryGroup
  label: string
  icon: LucideIcon
  gradient: string
}

const LOOK: Record<CategoryGroup, { icon: LucideIcon; gradient: string }> = {
  arts: { icon: Palette, gradient: 'from-fuchsia-500 to-purple-700' },
  sports: { icon: Dumbbell, gradient: 'from-emerald-500 to-teal-700' },
  academic: { icon: GraduationCap, gradient: 'from-sky-500 to-blue-800' },
  social: { icon: PartyPopper, gradient: 'from-pink-500 to-rose-700' },
  food: { icon: Utensils, gradient: 'from-orange-500 to-red-700' },
  other: { icon: Sparkles, gradient: 'from-violet-400 to-purple-700' },
}

const BY_GROUP = Object.fromEntries(
  CATEGORY_GROUPS.map((g) => [g.value, { ...g, ...LOOK[g.value] }]),
) as unknown as Record<CategoryGroup, CategoryMeta>

/** Look and label for an event's category (music shows as Arts, etc.). */
export function categoryMeta(category: EventCategory): CategoryMeta {
  return BY_GROUP[groupOf(category)]
}
