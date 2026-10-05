import { Fragment, useEffect, useState, type ReactNode } from 'react'
import { setDateLocale } from '@/lib/dates'
import { LangContext, type Lang } from '@/lib/i18n'
import { ZH } from '@/lib/zh'

const KEY = 'lang'

function stored(): Lang {
  try { return localStorage.getItem(KEY) === 'zh' ? 'zh' : 'en' } catch { return 'en' }
}

export function LangProvider({ children }: { children: ReactNode }) {
  const [lang, setLangState] = useState<Lang>(stored)
  setDateLocale(lang) // before any child formats a date
  useEffect(() => { document.documentElement.lang = lang === 'zh' ? 'zh-CN' : 'en' }, [lang])
  const setLang = (next: Lang) => {
    try { localStorage.setItem(KEY, next) } catch { /* the choice just will not be remembered */ }
    setLangState(next)
  }
  const t = (text: string, ...args: (string | number)[]) =>
    (lang === 'zh' ? ZH[text] ?? text : text).replace(/\{(\d)\}/g, (_, i) => String(args[Number(i)] ?? ''))
  // Remounting on a language change keeps every module-level label and date in step with it.
  return <LangContext.Provider value={{ lang, setLang, t }}><Fragment key={lang}>{children}</Fragment></LangContext.Provider>
}
