import { categoryMeta, type EventCategory } from '@/lib/categories'

export function CategoryChip({ category }: { category: EventCategory }) {
  const meta = categoryMeta(category)
  const Icon = meta.icon
  return (
    <span className="inline-flex items-center gap-1 rounded-full bg-brand-50 px-2.5 py-1 text-xs font-semibold text-brand-700">
      <Icon className="size-3.5" aria-hidden="true" />
      {meta.label}
    </span>
  )
}
