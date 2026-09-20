import {
  Briefcase,
  Dumbbell,
  GraduationCap,
  HeartPulse,
  Music,
  Palette,
  PartyPopper,
  Sparkles,
  Utensils,
  type LucideIcon,
} from 'lucide-react'
import type { Database } from './database.types'

export type EventCategory = Database['public']['Enums']['event_category']

interface CategoryMeta {
  value: EventCategory
  label: string
  icon: LucideIcon
  gradient: string
}

export const CATEGORIES: CategoryMeta[] = [
  { value: 'arts', label: 'Arts', icon: Palette, gradient: 'from-fuchsia-500 to-purple-700' },
  { value: 'music', label: 'Music', icon: Music, gradient: 'from-indigo-500 to-violet-800' },
  { value: 'sports', label: 'Sports', icon: Dumbbell, gradient: 'from-emerald-500 to-teal-700' },
  { value: 'academic', label: 'Academic', icon: GraduationCap, gradient: 'from-sky-500 to-blue-800' },
  { value: 'career', label: 'Career', icon: Briefcase, gradient: 'from-slate-500 to-slate-800' },
  { value: 'social', label: 'Social', icon: PartyPopper, gradient: 'from-pink-500 to-rose-700' },
  { value: 'wellness', label: 'Wellness', icon: HeartPulse, gradient: 'from-lime-600 to-green-800' },
  { value: 'food', label: 'Food', icon: Utensils, gradient: 'from-orange-500 to-red-700' },
  { value: 'other', label: 'Other', icon: Sparkles, gradient: 'from-violet-400 to-purple-700' },
]

const BY_VALUE = Object.fromEntries(CATEGORIES.map((c) => [c.value, c])) as Record<
  EventCategory,
  CategoryMeta
>

export function categoryMeta(value: EventCategory): CategoryMeta {
  return BY_VALUE[value]
}

export function isCategory(value: string | null): value is EventCategory {
  return value !== null && value in BY_VALUE
}
