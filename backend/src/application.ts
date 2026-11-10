import express, { type Express, type NextFunction } from 'express'
import helmet from 'helmet'
import type { Container } from './container.js'
import type { HttpRequest, HttpResponse } from './shared/http.js'
import { NotFoundException } from './shared/exceptions/index.js'
import type { ErrorResponse } from './shared/exception.service.js'
export class Application {
  readonly app: Express = express()
  constructor(private readonly container: Container) {
    this.app.disable('x-powered-by')
    this.app.use(helmet())
    this.app.use(this.cache.bind(this))
    this.app.use(this.origin.bind(this))
    this.app.use(express.json({ limit: '32kb' }))
    this.app.get('/api/health', this.health.bind(this))
    // Resolve controllers on first request, rather than eagerly constructing the entire graph.
    this.app.use('/api/auth', this.auth.bind(this))
    this.app.use('/api', this.authenticate.bind(this))
    this.app.use('/api/rounds', this.rounds.bind(this))
    this.app.use('/api/movies', this.movies.bind(this))
    this.app.use('/api/admin', this.admin.bind(this))
    this.app.use(this.notFound.bind(this))
    this.app.use(this.error.bind(this))
  }
  private cache(_req: HttpRequest, res: HttpResponse, next: NextFunction): void {
    res.set('Cache-Control', 'no-store')
    next()
  }
  private origin(req: HttpRequest, res: HttpResponse, next: NextFunction): void {
    // Origin checking needs no database connection, including health requests.
    if (
      !['GET', 'HEAD', 'OPTIONS'].includes(req.method) &&
      req.get('origin') !== this.container.config.origin
    ) {
      this.container.authMiddleware.origin(req, res, next)
      return
    }
    next()
  }
  private health(_req: HttpRequest, res: HttpResponse): void {
    res.json({ status: 'ok' })
  }
  private auth(req: HttpRequest, res: HttpResponse, next: NextFunction): void {
    this.container.authController.router(req, res, next)
  }
  private async authenticate(
    req: HttpRequest,
    res: HttpResponse,
    next: NextFunction,
  ): Promise<void> {
    await this.container.authMiddleware.authenticate(req, res, next)
  }
  private rounds(req: HttpRequest, res: HttpResponse, next: NextFunction): void {
    this.container.roundController.router(req, res, next)
  }
  private movies(req: HttpRequest, res: HttpResponse, next: NextFunction): void {
    this.container.movieController.router(req, res, next)
  }
  private admin(req: HttpRequest, res: HttpResponse, next: NextFunction): void {
    this.container.authMiddleware.admin(req, res, (): void => {
      this.container.adminController.router(req, res, next)
    })
  }
  private notFound(): never {
    throw new NotFoundException()
  }
  private error(error: unknown, _req: HttpRequest, res: HttpResponse, _next: NextFunction): void {
    const response: ErrorResponse = this.container.exceptionService.handle(error)
    if (response.statusCode === 429) res.set('Retry-After', '900')
    res.status(response.statusCode).json(response)
  }
}
