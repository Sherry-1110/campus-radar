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

export type CategoryGroup = 'arts' | 'sports' | 'academic' | 'social' | 'food' | 'market' | 'exhibition' | 'performance' | 'play' | 'other'

export const CATEGORY_GROUPS: { value: CategoryGroup; label: string; members: DbCategory[] }[] = [
  { value: 'performance', label: 'Shows & Games', members: ['performance'] },
  { value: 'market', label: 'Market', members: ['market'] },
  { value: 'exhibition', label: 'Exhibition', members: ['exhibition'] },
  { value: 'play', label: 'Play', members: ['play'] },
  { value: 'social', label: 'Social', members: ['social'] },
  { value: 'arts', label: 'Arts', members: ['arts', 'music'] },
  { value: 'sports', label: 'Sports', members: ['sports', 'wellness'] },
  { value: 'academic', label: 'Academic', members: ['academic', 'career'] },
  { value: 'food', label: 'Food', members: ['food'] },
  { value: 'other', label: 'Other', members: ['other'] },
]

export function groupOf(category: DbCategory): CategoryGroup {
  return CATEGORY_GROUPS.find((g) => g.members.includes(category))?.value ?? 'other'
}
