import { Radar } from 'lucide-react'
import { useEffect } from 'react'
import { Link, Outlet, useLocation } from 'react-router'
import { useLang } from '@/lib/i18n'
import { useSavedEvents } from '@/lib/useSavedEvents'

export function Layout() {
  const { pathname } = useLocation()
  const { ids, storageError } = useSavedEvents()
  const { lang, setLang, t } = useLang()

  useEffect(() => {
    window.scrollTo(0, 0)
    document.getElementById('main')?.focus({ preventScroll: true })
  }, [pathname])

  return (
    <div className="flex min-h-dvh flex-col">
      <a
        href="#main"
        className="sr-only focus:not-sr-only focus:fixed focus:left-4 focus:top-4 focus:z-50 focus:rounded-xl focus:bg-white focus:px-4 focus:py-2 focus:font-semibold focus:shadow-card-hover"
      >
        {t('Skip to content')}
      </a>

      <header className="border-b border-line bg-surface">
        <div className="mx-auto flex h-16 max-w-[1600px] items-center justify-between px-4 sm:px-6">
          <Link to="/" className="flex items-center gap-2.5" aria-label={t('Campus Radar home')}>
            <span className="grid size-9 place-items-center rounded-xl bg-brand-700 text-white">
              <Radar className="size-5" aria-hidden="true" />
            </span>
            <span className="flex flex-col text-base font-extrabold leading-[1.05] tracking-tight text-brand-900 sm:flex-row sm:gap-1.5 sm:text-lg"><span>Campus</span><span>Radar</span></span>
          </Link>
          <nav aria-label={t('Main navigation')} className="flex items-center gap-1 sm:gap-5">
            <Link to="/" aria-current={pathname === '/' ? 'page' : undefined} className="min-h-11 content-center rounded-full px-3 text-sm font-bold aria-[current=page]:bg-brand-700 aria-[current=page]:text-white">{t('Explore')}</Link>
            <Link to="/saved" aria-current={pathname === '/saved' ? 'page' : undefined} className="min-h-11 content-center rounded-full px-3 text-sm font-bold aria-[current=page]:bg-brand-700 aria-[current=page]:text-white">{t('Saved')}{ids.length ? ` (${ids.length})` : ''}</Link>
            <button type="button" onClick={() => setLang(lang === 'zh' ? 'en' : 'zh')} aria-label={t('Switch language')}
              className="min-h-9 shrink-0 rounded-full border border-line px-2.5 text-sm font-bold text-ink hover:border-brand-300 hover:bg-brand-50">{lang === 'zh' ? 'EN' : '中文'}</button>
          </nav>
        </div>
      </header>

      <main id="main" tabIndex={-1} className="flex-1 focus:outline-none">
        {storageError && <p role="status" className="bg-amber-50 px-4 py-2 text-center text-sm">{t('Browser storage is unavailable. Saves will last only until this page closes.')}</p>}
        <Outlet />
      </main>

      <footer className="border-t border-line bg-surface">
        <div className="mx-auto flex max-w-6xl flex-col gap-2 px-4 py-8 text-sm text-ink-muted sm:flex-row sm:items-center sm:justify-between">
          <p>{t('Campus Radar · Events for Northwestern students.')} <Link to="/sources" className="underline hover:text-brand-700">{t('Source status')}</Link></p>
          <p>{t('An independent student project, not affiliated with Northwestern University.')}</p>
        </div>
      </footer>
    </div>
  )
}
