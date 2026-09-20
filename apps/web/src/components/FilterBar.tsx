import { chicagoDateString } from '@/lib/dates'
import {
  CATEGORY_OPTIONS,
  REGION_OPTIONS,
  SCOPE_OPTIONS,
  TIME_OPTIONS,
  type EventFilters,
} from '@/lib/filters'
import { FilterDropdown } from './FilterDropdown'
import { SearchToggle } from './SearchToggle'

interface FilterBarProps {
  filters: EventFilters
  onChange: (patch: Partial<EventFilters>) => void
  onSearch: (q: string) => void
}

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

  return (
    <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
      <div className="grid flex-1 grid-cols-2 gap-3 sm:grid-cols-4">
        <FilterDropdown
          label="From"
          options={SCOPE_OPTIONS}
          selected={filters.scopes}
          onChange={(scopes) => onChange({ scopes })}
          panelClass="left-0"
        />
        <FilterDropdown
          label="Time"
          options={TIME_OPTIONS}
          selected={filters.time}
          onChange={(time) => onChange({ time })}
          summary={timeSummary}
          panelClass="right-0 sm:left-0 sm:right-auto"
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
        <FilterDropdown
          label="Category"
          options={CATEGORY_OPTIONS}
          selected={filters.categories}
          onChange={(categories) => onChange({ categories })}
          panelClass="left-0"
        />
        <FilterDropdown
          label="Location"
          options={REGION_OPTIONS}
          selected={filters.regions}
          onChange={(regions) => onChange({ regions })}
          panelClass="right-0"
        />
      </div>

      <div className="flex items-center justify-between gap-3">
        <label
          className={`flex min-h-11 cursor-pointer items-center gap-2 rounded-xl border px-3 text-sm font-bold shadow-card motion-safe:transition ${
            filters.freeOnly
              ? 'border-brand-700 bg-brand-50 text-brand-800'
              : 'border-line bg-surface text-ink hover:border-brand-300'
          }`}
        >
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
