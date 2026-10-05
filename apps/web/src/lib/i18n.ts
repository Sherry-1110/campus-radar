import { createContext, useContext } from 'react'

export type Lang = 'en' | 'zh'

export interface I18n {
  lang: Lang
  setLang: (lang: Lang) => void
  /** The English text is the key; `{0}`, `{1}` are filled from the extra arguments. Unknown text stays English. */
  t: (text: string, ...args: (string | number)[]) => string
}

export const LangContext = createContext<I18n | null>(null)

export function useLang(): I18n {
  const value = useContext(LangContext)
  if (!value) throw new Error('useLang needs a LangProvider')
  return value
}
