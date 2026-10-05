/** Categories shown in the UI. Each groups one or more database categories. */
export type DbCategory =
  | 'arts'
  | 'music'
  | 'sports'
  | 'wellness'
  | 'academic'
  | 'career'
  | 'social'
  | 'food'
  | 'market'
  | 'exhibition'
  | 'performance'
  | 'play'
  | 'other'

export type CategoryGroup = 'music' | 'arts' | 'sports' | 'activities' | 'fests' | 'parties'

/** The six categories on the site. Talks, careers, food on its own and anything unmatched appear only under "All". */
export const CATEGORY_GROUPS: { value: CategoryGroup; label: string; members: DbCategory[] }[] = [
  { value: 'music', label: 'Music', members: ['music'] },
  { value: 'arts', label: 'Arts', members: ['arts', 'exhibition'] },
  { value: 'sports', label: 'Sports', members: ['sports', 'wellness'] },
  { value: 'activities', label: 'Activities', members: ['play'] },
  { value: 'fests', label: 'Fests', members: ['market'] },
  { value: 'parties', label: 'Parties', members: ['social'] },
]

export function groupOf(category: DbCategory): CategoryGroup | null {
  return CATEGORY_GROUPS.find((g) => g.members.includes(category))?.value ?? null
}
