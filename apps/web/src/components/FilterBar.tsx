import { CATEGORIES, type EventCategory } from '@/lib/categories'
import { WHEN_OPTIONS, type WhenFilter } from '@/lib/dates'
import type { EventFilters } from '@/lib/events'

interface FilterBarProps {
  filters: EventFilters
  onChange: (patch: Partial<EventFilters>) => void
}

const chipBase =
  'inline-flex min-h-11 shrink-0 items-center gap-1.5 rounded-full border px-4 text-sm font-semibold motion-safe:transition'
const chipOff = 'border-line bg-surface text-ink hover:border-brand-300 hover:bg-brand-50'
const chipOn = 'border-brand-700 bg-brand-700 text-white'

export function FilterBar({ filters, onChange }: FilterBarProps) {
  return (
    <div className="flex flex-col gap-3">
      <div
        role="group"
        aria-label="When"
        className="-mx-4 flex gap-2 overflow-x-auto px-4 pb-1 [scrollbar-width:none] sm:mx-0 sm:flex-wrap sm:overflow-visible sm:px-0 [&::-webkit-scrollbar]:hidden"
      >
        {WHEN_OPTIONS.map((o) => (
          <button
            key={o.value}
            type="button"
            aria-pressed={filters.when === o.value}
            onClick={() => onChange({ when: o.value as WhenFilter })}
            className={`${chipBase} ${filters.when === o.value ? chipOn : chipOff}`}
          >
            {o.label}
          </button>
        ))}
        <button
          type="button"
          aria-pressed={filters.freeOnly}
          onClick={() => onChange({ freeOnly: !filters.freeOnly })}
          className={`${chipBase} ${
            filters.freeOnly ? 'border-free bg-free text-white' : chipOff
          }`}
        >
          Free only
        </button>
      </div>

      <div
        role="group"
        aria-label="Category"
        className="-mx-4 flex gap-2 overflow-x-auto px-4 pb-1 [scrollbar-width:none] sm:mx-0 sm:flex-wrap sm:overflow-visible sm:px-0 [&::-webkit-scrollbar]:hidden"
      >
        <button
          type="button"
          aria-pressed={filters.category === null}
          onClick={() => onChange({ category: null })}
          className={`${chipBase} ${filters.category === null ? chipOn : chipOff}`}
        >
          All categories
        </button>
        {CATEGORIES.map((c) => {
          const active = filters.category === c.value
          const Icon = c.icon
          return (
            <button
              key={c.value}
              type="button"
              aria-pressed={active}
              onClick={() => onChange({ category: active ? null : (c.value as EventCategory) })}
              className={`${chipBase} ${active ? chipOn : chipOff}`}
            >
              <Icon className="size-4" aria-hidden="true" />
              {c.label}
            </button>
          )
        })}
      </div>
    </div>
  )
}
