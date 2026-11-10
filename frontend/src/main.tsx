import { createRoot } from 'react-dom/client'
import { Container } from './container.js'
import { Mainflix } from './app.js'
import './style.css'
class Frontend {
  static start(): void {
    const element: HTMLElement | null = document.getElementById('root')
    if (!element) throw new Error('Missing root element')
    const container: Container = new Container()
    createRoot(element).render(<Mainflix container={container} />)
  }
}
Frontend.start()
