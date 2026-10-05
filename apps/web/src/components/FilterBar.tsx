import { LayoutGrid, Map } from 'lucide-react'
import {
  ALL_CATEGORIES,
  ALL_SCOPES,
  CATEGORY_OPTIONS,
  DEFAULT_FILTERS,
  type EventFilters,
  type TimeValue,
} from '@/lib/filters'
import { useLang } from '@/lib/i18n'
import { DateRangePicker } from './DateRangePicker'
import { SearchBox } from './SearchBox'

interface FilterBarProps {
  filters: EventFilters
  onChange: (patch: Partial<EventFilters>) => void
  onSearch: (q: string) => void
  mapOn: boolean
  onToggleMap: () => void
}

const QUICK_DATES: { value: TimeValue; label: string }[] = [
  { value: 'next7', label: 'Next 7 days' },
  { value: 'today', label: 'Today' },
  { value: 'weekend', label: 'This weekend' },
]

const toggleBox = 'flex min-h-11 cursor-pointer items-center max-sm:grow max-sm:justify-center gap-1.5 max-sm:gap-1 whitespace-nowrap rounded-xl border px-2 max-sm:px-1.5 text-[13px] max-sm:text-[12.5px] font-bold shadow-card motion-safe:transition sm:gap-2 sm:px-3 sm:text-sm'
const toggleState = (on: boolean) =>
  on ? 'border-brand-700 bg-brand-50 text-brand-800' : 'border-line bg-surface text-ink hover:border-brand-300'

/**
 * Desktop: Next 7 days, Today, This weekend and the calendar on the left; On campus, Free, search and Map on the right.
 * Phones: On campus, Free, search and Map first; then the date buttons and the calendar.
 */
export function FilterBar({ filters, onChange, onSearch, mapOn, onToggleMap }: FilterBarProps) {
  const { t } = useLang()
  const custom = filters.time.length === 1 && filters.time[0] === 'custom' && filters.date ? filters.date : null
  const onCampusOnly = filters.scopes.length === 1 && filters.scopes[0] === 'campus'
  const picker = (
    <DateRangePicker
      from={custom}
      to={custom ? filters.dateEnd : null}
      onPick={(date, dateEnd) => onChange({ time: ['custom'], date, dateEnd })}
      onClear={() => onChange({ time: DEFAULT_FILTERS.time, date: null, dateEnd: null })}
    />
  )

  return (
    <div className="flex flex-wrap items-center gap-1.5 sm:gap-3">
      {QUICK_DATES.map(({ value, label }) => {
        const on = filters.time.length === 1 && filters.time[0] === value
        return (
          <button
            key={value}
            type="button"
            aria-pressed={on}
            // Pressing an active one again returns to the default range.
            onClick={() => onChange({ time: on ? DEFAULT_FILTERS.time : [value], date: null, dateEnd: null })}
            className={`${toggleBox} ${toggleState(on)} max-sm:order-3`}
          >
            {t(label)}
          </button>
        )
      })}
      <div className="max-sm:order-3">{picker}</div>
      <label className={`${toggleBox} ${toggleState(onCampusOnly)} max-sm:order-1 max-sm:grow-0 sm:ml-auto`}>
        <input
          type="checkbox"
          checked={onCampusOnly}
          onChange={(e) => onChange({ scopes: e.target.checked ? ['campus'] : ALL_SCOPES })}
          className="size-5 max-sm:size-4 accent-brand-700"
        />
        <span className="sm:hidden">{t('On campus')}</span>
        <span className="max-sm:hidden">{t('On campus only')}</span>
      </label>
      <label className={`${toggleBox} ${toggleState(filters.freeOnly)} max-sm:order-1 max-sm:grow-0`}>
        <input
          type="checkbox"
          checked={filters.freeOnly}
          onChange={(e) => onChange({ freeOnly: e.target.checked })}
          className="size-5 max-sm:size-4 accent-brand-700"
        />
        {t('Free only')}
      </label>
      <div className="max-sm:order-1 max-sm:w-0 max-sm:min-w-0 max-sm:grow sm:w-52"><SearchBox value={filters.q} onChange={onSearch} /></div>
      <span className="hidden h-6 w-px bg-line sm:block" aria-hidden="true" />
      <button
        type="button"
        aria-pressed={mapOn}
        aria-label={mapOn ? t('Show cards') : t('Show map')}
        onClick={onToggleMap}
        className="inline-flex size-11 shrink-0 items-center justify-center gap-2 rounded-xl border border-line bg-surface text-sm font-semibold text-ink shadow-card motion-safe:transition hover:border-brand-300 hover:bg-brand-50 max-sm:order-1 sm:w-auto sm:px-4"
      >
        {mapOn ? <LayoutGrid className="size-5 sm:size-4" aria-hidden="true" /> : <Map className="size-5 sm:size-4" aria-hidden="true" />}
        <span className="max-sm:hidden">{mapOn ? t('Cards') : t('Map')}</span>
      </button>
      {/* Ends the first row on phones. */}
      <span className="basis-full max-sm:order-2 sm:hidden" aria-hidden="true" />
    </div>
  )
}

/** Row of category tabs under the filters: one tap shows a single category, "All" shows everything. */
export function CategoryTabs({ filters, onChange }: Pick<FilterBarProps, 'filters' | 'onChange'>) {
  const { t } = useLang()
  const picked = filters.categories
  const isAll = picked.length === ALL_CATEGORIES.length
  const tabs = [{ value: null, label: 'All' }, ...CATEGORY_OPTIONS]
  return (
    <div role="group" aria-label={t('Category')}
      className="mt-3 flex justify-between gap-2 overflow-x-auto border-b border-line px-1.5 [scrollbar-width:none] sm:mt-4 sm:gap-0 sm:px-0 [&::-webkit-scrollbar]:hidden">
      {tabs.map(({ value, label }) => {
        const on = value === null ? isAll : picked.length === 1 && picked[0] === value
        return (
          <button
            key={label}
            type="button"
            aria-pressed={on}
            onClick={() => onChange({ categories: value === null ? ALL_CATEGORIES : [value] })}
            // Phones: underlined words. Desktop: equal, centred segments split by thin lines.
            className={`-mb-px shrink-0 border-b-[3px] py-1.5 text-[15px] motion-safe:transition sm:relative sm:flex-1 sm:py-2.5 sm:text-center sm:before:absolute sm:before:inset-y-3 sm:before:left-0 sm:before:w-px sm:before:bg-line sm:first:before:hidden ${
              on ? 'border-brand-700 font-extrabold text-ink sm:bg-brand-50 sm:text-brand-800' : 'border-transparent font-medium text-ink-muted hover:text-ink sm:hover:bg-brand-50/50'
            }`}
          >
            {t(label)}
          </button>
        )
      })}
    </div>
  )
}
