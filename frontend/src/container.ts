import { Api } from './api.js'
import { I18n } from './i18n.js'
interface ContainerProps {
  api?: Api
  i18n?: I18n
}
export class Container {
  private readonly props: ContainerProps = {}
  get api(): Api {
    return (this.props.api ??= new Api())
  }
  get i18n(): I18n {
    if (!this.props.i18n) {
      const saved: string | null = localStorage.getItem('mainflix-language')
      this.props.i18n = new I18n(
        saved === 'en' || saved === 'es'
          ? saved
          : navigator.language.startsWith('es')
            ? 'es'
            : 'en',
      )
      document.documentElement.lang = this.props.i18n.current
    }
    return this.props.i18n
  }
}
