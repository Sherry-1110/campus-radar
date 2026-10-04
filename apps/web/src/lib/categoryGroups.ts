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
  | 'other'

export type CategoryGroup = 'arts' | 'sports' | 'academic' | 'social' | 'food' | 'market' | 'exhibition' | 'performance' | 'other'

export const CATEGORY_GROUPS: { value: CategoryGroup; label: string; members: DbCategory[] }[] = [
  { value: 'arts', label: 'Arts', members: ['arts', 'music'] },
  { value: 'sports', label: 'Sports', members: ['sports', 'wellness'] },
  { value: 'academic', label: 'Academic', members: ['academic', 'career'] },
  { value: 'social', label: 'Social', members: ['social'] },
  { value: 'food', label: 'Food', members: ['food'] },
  { value: 'market', label: 'Market', members: ['market'] },
  { value: 'exhibition', label: 'Exhibition', members: ['exhibition'] },
  { value: 'performance', label: 'Shows & Games', members: ['performance'] },
  { value: 'other', label: 'Other', members: ['other'] },
]

export function groupOf(category: DbCategory): CategoryGroup {
  return CATEGORY_GROUPS.find((g) => g.members.includes(category))?.value ?? 'other'
}
