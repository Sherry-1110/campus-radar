import { categoryMeta, eventGroups, type EventCategory } from '@/lib/categories'
import { useLang } from '@/lib/i18n'

/** Up to three site categories, with a neutral tag for events outside those groups. */
export function CategoryChips({ event }: { event: { category: EventCategory; categories?: EventCategory[] } }) {
  const { t } = useLang()
  const metas = eventGroups(event)
  if (!metas.length) metas.push(categoryMeta('other'))
  return (
    <div className="flex flex-wrap items-center gap-1.5">
      {metas.map(meta => {
        const Icon = meta.icon
        return (
          <span key={meta.value} className="inline-flex items-center gap-1 rounded-full bg-brand-50 px-2.5 py-1 text-xs font-semibold text-brand-700">
            <Icon className="size-3.5" aria-hidden="true" />
            {t(meta.label)}
          </span>
        )
      })}
    </div>
  )
}
