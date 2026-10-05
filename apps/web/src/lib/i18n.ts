import { createContext, useContext } from 'react'

export type Lang = 'en' | 'zh'

export interface I18n {
  lang: Lang
  setLang: (lang: Lang) => void
  /** The English text is the key; `{0}`, `{1}` are filled from the extra arguments. Unknown text stays English. */
  t: (text: string, ...args: (string | number)[]) => string
}

/** The Chinese text when the site is in Chinese and one exists; otherwise the original. */
export const localized = (lang: Lang, original: string, zh: string | null | undefined): string => (lang === 'zh' && zh ? zh : original)

export const LangContext = createContext<I18n | null>(null)

export function useLang(): I18n {
  const value = useContext(LangContext)
  if (!value) throw new Error('useLang needs a LangProvider')
  return value
}
