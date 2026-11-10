import type { Express } from 'express'
import { Container } from './container.js'
import { Configuration } from './configuration.js'
export class Backend {
  private static readonly container: Container = new Container(Configuration.fromEnvironment())
  static get app(): Express {
    return this.container.application.app
  }
  static start(): void {
    const port: number = Number(process.env.PORT ?? 3000)
    this.app.listen(port, '127.0.0.1', (): void => {
      console.log(`Mainflix backend: http://localhost:${port}`)
    })
  }
}
if (!process.env.VERCEL) Backend.start()
export default Backend.app
