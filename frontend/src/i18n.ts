import en from './locales/en.json'
import es from './locales/es.json'
export type Language = 'en' | 'es'
export type TranslationKey = keyof typeof en
export class I18n {
  private language: Language
  constructor(language: Language) {
    this.language = language
  }
  get current(): Language {
    return this.language
  }
  set current(value: Language) {
    this.language = value
    document.documentElement.lang = value
    localStorage.setItem('mainflix-language', value)
  }
  t(key: TranslationKey): string {
    return (this.language === 'es' ? es : en)[key]
  }
  error(code: string): string {
    return Object.hasOwn(en, code) ? this.t(code as TranslationKey) : this.t('genericError')
  }
}
