import { categoryMeta, type EventCategory } from '@/lib/categories'
import { groupOf } from '@/lib/categoryGroups'

/** One chip per site-level category, at most 3. Falls back to the primary category. */
export function CategoryChips({ event }: { event: { category: EventCategory; categories?: EventCategory[] } }) {
  const all = event.categories?.length ? event.categories : [event.category]
  const metas = [...new Map(all.map(c => [groupOf(c), categoryMeta(c)])).values()].slice(0, 3)
  return (
    <div className="flex flex-wrap items-center gap-1.5">
      {metas.map(meta => {
        const Icon = meta.icon
        return (
          <span key={meta.value} className="inline-flex items-center gap-1 rounded-full bg-brand-50 px-2.5 py-1 text-xs font-semibold text-brand-700">
            <Icon className="size-3.5" aria-hidden="true" />
            {meta.label}
          </span>
        )
      })}
    </div>
  )
}
