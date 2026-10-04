import { chicagoDateString } from '@/lib/dates'
import {
  ALL_SCOPES,
  CATEGORY_OPTIONS,
  DEFAULT_FILTERS,
  TIME_OPTIONS,
  type EventFilters,
  type TimeValue,
} from '@/lib/filters'
import { FilterDropdown } from './FilterDropdown'
import { SearchToggle } from './SearchToggle'

interface FilterBarProps {
  filters: EventFilters
  onChange: (patch: Partial<EventFilters>) => void
  onSearch: (q: string) => void
}

const QUICK_DATES: { value: TimeValue; label: string }[] = [
  { value: 'today', label: 'Today' },
  { value: 'weekend', label: 'This weekend' },
]

const toggleBox = 'flex min-h-11 cursor-pointer items-center max-sm:grow max-sm:justify-center gap-1.5 whitespace-nowrap rounded-xl border px-2 text-[13px] font-bold shadow-card motion-safe:transition sm:gap-2 sm:px-3 sm:text-sm'
const toggleState = (on: boolean) =>
  on ? 'border-brand-700 bg-brand-50 text-brand-800' : 'border-line bg-surface text-ink hover:border-brand-300'

function customDateLabel(date: string): string {
  const [y, m, d] = date.split('-').map(Number)
  return new Date(Date.UTC(y, m - 1, d)).toLocaleDateString('en-US', {
    timeZone: 'UTC',
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  })
}

export function FilterBar({ filters, onChange, onSearch }: FilterBarProps) {
  // Show the picked date on the button when it is the only time filter chosen.
  const timeSummary =
    filters.time.length === 1 && filters.time[0] === 'custom' && filters.date
      ? customDateLabel(filters.date)
      : undefined
  const sameSet = (a: readonly string[], b: readonly string[]) => a.length === b.length && a.every(v => b.includes(v))
  const timeChanged = !sameSet(filters.time, DEFAULT_FILTERS.time)
  const categoryChanged = !sameSet(filters.categories, DEFAULT_FILTERS.categories)
  const onCampusOnly = filters.scopes.length === 1 && filters.scopes[0] === 'campus'

  return (
    <div className="flex flex-wrap items-center gap-3">
      <div className="flex w-full flex-wrap items-center gap-1.5 sm:w-auto sm:flex-1 sm:gap-3">
        {QUICK_DATES.map(({ value, label }) => {
          const on = filters.time.length === 1 && filters.time[0] === value
          return (
            <button
              key={value}
              type="button"
              aria-pressed={on}
              // Pressing again returns to the default range.
              onClick={() => onChange({ time: on ? DEFAULT_FILTERS.time : [value], date: null })}
              className={`${toggleBox} ${toggleState(on)}`}
            >
              {label}
            </button>
          )
        })}
        <div className="max-sm:grow sm:w-44">
          <FilterDropdown
            label="Time"
            options={TIME_OPTIONS}
            selected={filters.time}
            onChange={(time) => onChange({ time })}
            summary={timeSummary}
            labelOnlyOnMobile
            changed={timeChanged}
            renderExtra={(value) =>
              value === 'custom' ? (
                <div className="px-3 pb-2 pl-11">
                  <label className="sr-only" htmlFor="custom-date">
                    Custom date
                  </label>
                  <input
                    id="custom-date"
                    type="date"
                    min={chicagoDateString(new Date())}
                    value={filters.date ?? ''}
                    onChange={(e) => onChange({ date: e.target.value || null })}
                    className="min-h-11 w-full rounded-lg border border-line bg-surface px-3 text-sm text-ink"
                  />
                </div>
              ) : null
            }
          />
        </div>
        <div className="max-sm:grow sm:w-44">
          <FilterDropdown
            label="Category"
            options={CATEGORY_OPTIONS}
            selected={filters.categories}
            onChange={(categories) => onChange({ categories })}
            labelOnlyOnMobile
            changed={categoryChanged}
          />
        </div>
      </div>

      <div className="flex w-full flex-wrap items-center gap-1.5 sm:w-auto sm:gap-3">
        <label className={`${toggleBox} ${toggleState(onCampusOnly)}`}>
          <input
            type="checkbox"
            checked={onCampusOnly}
            onChange={(e) => onChange({ scopes: e.target.checked ? ['campus'] : ALL_SCOPES })}
            className="size-5 accent-brand-700"
          />
          On campus only
        </label>
        <label className={`${toggleBox} ${toggleState(filters.freeOnly)}`}>
          <input
            type="checkbox"
            checked={filters.freeOnly}
            onChange={(e) => onChange({ freeOnly: e.target.checked })}
            className="size-5 accent-brand-700"
          />
          Free only
        </label>
        <SearchToggle value={filters.q} onChange={onSearch} />
      </div>
    </div>
  )
}
