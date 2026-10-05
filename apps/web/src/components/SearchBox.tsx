import { Search, X } from 'lucide-react'
import { useEffect, useState } from 'react'
import { useLang } from '@/lib/i18n'

interface SearchBoxProps {
  value: string
  onChange: (value: string) => void
}

/** Inline search field in the filter row. Results update shortly after typing stops, or on Enter. */
export function SearchBox({ value, onChange }: SearchBoxProps) {
  const { t } = useLang()
  const [draft, setDraft] = useState(value)
  const [prevValue, setPrevValue] = useState(value)

  // Adopt external changes (e.g. "Reset filters") without an effect.
  if (value !== prevValue) {
    setPrevValue(value)
    setDraft(value)
  }

  useEffect(() => {
    if (draft === value) return
    const timer = setTimeout(() => onChange(draft), 350)
    return () => clearTimeout(timer)
  }, [draft, value, onChange])

  return (
    <form
      role="search"
      onSubmit={(e) => {
        e.preventDefault()
        onChange(draft)
      }}
      className={`flex h-11 min-w-0 items-center rounded-xl border bg-surface shadow-card motion-safe:transition focus-within:border-brand-700 ${
        value.trim() ? 'border-brand-700' : 'border-line hover:border-brand-300'
      }`}
    >
      <label htmlFor="event-search" className="sr-only">
        {t('Search events')}
      </label>
      <Search className="ml-3 size-4 shrink-0 text-ink-muted" aria-hidden="true" />
      <input
        id="event-search"
        type="search"
        inputMode="search"
        enterKeyHint="search"
        autoComplete="off"
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        placeholder={t('Search')}
        className="h-full min-w-0 flex-1 bg-transparent px-2 text-base text-ink placeholder:text-ink-muted focus-visible:outline-none sm:text-sm [&::-webkit-search-cancel-button]:hidden"
      />
      {draft && (
        <button
          type="button"
          onClick={() => {
            setDraft('')
            onChange('')
          }}
          className="mr-1 grid size-9 shrink-0 place-items-center rounded-lg text-ink-muted hover:bg-brand-50"
          aria-label={t('Clear search')}
        >
          <X className="size-4" aria-hidden="true" />
        </button>
      )}
    </form>
  )
}
