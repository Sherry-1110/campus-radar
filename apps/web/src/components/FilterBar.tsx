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

const toggleBox = 'flex min-h-11 whitespace-nowrap cursor-pointer items-center gap-2 rounded-xl border px-3 text-sm font-bold shadow-card motion-safe:transition'
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
  const onCampusOnly = filters.scopes.length === 1 && filters.scopes[0] === 'campus'

  return (
    <div className="flex flex-wrap items-center gap-3">
      <div className="flex flex-1 flex-wrap items-center gap-3">
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
        <div className="w-[calc(50%-0.375rem)] sm:w-44">
          <FilterDropdown
            label="Time"
            options={TIME_OPTIONS}
            selected={filters.time}
            onChange={(time) => onChange({ time })}
            summary={timeSummary}
            panelClass="left-0"
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
        <div className="w-[calc(50%-0.375rem)] sm:w-44">
          <FilterDropdown
            label="Category"
            options={CATEGORY_OPTIONS}
            selected={filters.categories}
            onChange={(categories) => onChange({ categories })}
            panelClass="left-0"
          />
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-3">
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
