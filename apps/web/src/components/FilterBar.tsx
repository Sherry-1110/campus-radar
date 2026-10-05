import { LayoutGrid, Map } from 'lucide-react'
import { chicagoDateString } from '@/lib/dates'
import {
  ALL_CATEGORIES,
  ALL_SCOPES,
  CATEGORY_OPTIONS,
  DEFAULT_FILTERS,
  TIME_OPTIONS,
  type CategoryValue,
  type EventFilters,
  type TimeValue,
} from '@/lib/filters'
import { useLang } from '@/lib/i18n'
import { FilterDropdown } from './FilterDropdown'
import { SearchToggle } from './SearchToggle'

interface FilterBarProps {
  filters: EventFilters
  onChange: (patch: Partial<EventFilters>) => void
  onSearch: (q: string) => void
  mapOn: boolean
  onToggleMap: () => void
}

const QUICK_DATES: { value: TimeValue; label: string }[] = [
  { value: 'today', label: 'Today' },
  { value: 'weekend', label: 'This weekend' },
]

const toggleBox = 'flex min-h-11 cursor-pointer items-center max-sm:grow max-sm:justify-center gap-1.5 max-sm:gap-1 whitespace-nowrap rounded-xl border px-2 max-sm:px-1.5 text-[13px] max-sm:text-[12.5px] font-bold shadow-card motion-safe:transition sm:gap-2 sm:px-3 sm:text-sm'
const toggleState = (on: boolean) =>
  on ? 'border-brand-700 bg-brand-50 text-brand-800' : 'border-line bg-surface text-ink hover:border-brand-300'

export function FilterBar({ filters, onChange, onSearch, mapOn, onToggleMap }: FilterBarProps) {
  const { lang, t } = useLang()
  const customDateLabel = (date: string) => {
    const [y, m, d] = date.split('-').map(Number)
    return new Date(Date.UTC(y, m - 1, d)).toLocaleDateString(lang === 'zh' ? 'zh-CN' : 'en-US', {
      timeZone: 'UTC', month: 'short', day: 'numeric', year: 'numeric',
    })
  }
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
    <div className="flex flex-wrap items-center gap-1.5 sm:gap-3">
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
            {t(label)}
          </button>
        )
      })}
      <label className={`${toggleBox} ${toggleState(onCampusOnly)}`}>
        <input
          type="checkbox"
          checked={onCampusOnly}
          onChange={(e) => onChange({ scopes: e.target.checked ? ['campus'] : ALL_SCOPES })}
          className="size-5 max-sm:size-4 accent-brand-700"
        />
        <span className="sm:hidden">{t('On campus')}</span>
        <span className="max-sm:hidden">{t('On campus only')}</span>
      </label>
      <label className={`${toggleBox} ${toggleState(filters.freeOnly)}`}>
        <input
          type="checkbox"
          checked={filters.freeOnly}
          onChange={(e) => onChange({ freeOnly: e.target.checked })}
          className="size-5 max-sm:size-4 accent-brand-700"
        />
        {t('Free only')}
      </label>

      {/* On phones this row comes first: Time, Category, search and map. */}
      <div className="flex w-full items-center gap-1.5 max-sm:order-first sm:ml-auto sm:w-auto sm:gap-3">
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
                    {t('Custom date')}
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
        <SearchToggle value={filters.q} onChange={onSearch} />
        <span className="hidden h-6 w-px bg-line sm:block" aria-hidden="true" />
        <button
          type="button"
          aria-pressed={mapOn}
          aria-label={mapOn ? t('Show cards') : t('Show map')}
          onClick={onToggleMap}
          className="inline-flex size-11 shrink-0 items-center justify-center gap-2 rounded-xl border border-line bg-surface text-sm font-semibold text-ink shadow-card motion-safe:transition hover:border-brand-300 hover:bg-brand-50 sm:w-auto sm:px-4"
        >
          {mapOn ? <LayoutGrid className="size-5 sm:size-4" aria-hidden="true" /> : <Map className="size-5 sm:size-4" aria-hidden="true" />}
          <span className="max-sm:hidden">{mapOn ? t('Cards') : t('Map')}</span>
        </button>
      </div>
    </div>
  )
}

// The categories people reach for most, as a phone-only row of tabs.
const TAB_CATEGORIES: CategoryValue[] = ['performance', 'market', 'exhibition', 'play']

/** Phone-only row of category tabs: one tap shows a single category, "All" shows everything. */
export function CategoryTabs({ filters, onChange }: Pick<FilterBarProps, 'filters' | 'onChange'>) {
  const { t } = useLang()
  const picked = filters.categories
  const isAll = picked.length === ALL_CATEGORIES.length
  const tabs = [
    { value: null, label: 'All' },
    ...TAB_CATEGORIES.map((value) => ({ value, label: CATEGORY_OPTIONS.find((o) => o.value === value)!.label })),
  ]
  return (
    <div role="group" aria-label={t('Category')} className="mt-3 flex justify-around gap-2 px-1.5 sm:hidden">
      {tabs.map(({ value, label }) => {
        const on = value === null ? isAll : picked.length === 1 && picked[0] === value
        return (
          <button
            key={label}
            type="button"
            aria-pressed={on}
            onClick={() => onChange({ categories: value === null ? ALL_CATEGORIES : [value] })}
            className={`shrink-0 border-b-[3px] py-1.5 text-[15px] ${on ? 'border-brand-700 font-extrabold text-ink' : 'border-transparent font-medium text-ink-muted'}`}
          >
            {t(label)}
          </button>
        )
      })}
    </div>
  )
}
