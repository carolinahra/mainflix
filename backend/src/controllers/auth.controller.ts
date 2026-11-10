import { Router, type Router as ExpressRouter } from 'express'
import { z } from 'zod'
import type { UserService } from '../services/user.service.js'
import type { AuthMiddleware } from '../shared/auth.middleware.js'
import type { ContainerConfig } from '../container.js'
import { Http, type HttpRequest, type HttpResponse } from '../shared/http.js'
export class AuthController {
  readonly router: ExpressRouter = Router()
  constructor(
    private readonly users: UserService,
    private readonly auth: AuthMiddleware,
    private readonly config: ContainerConfig,
  ) {
    this.router.post('/login', this.login.bind(this))
    this.router.post('/reset', this.reset.bind(this))
    this.router.get('/me', auth.authenticate.bind(auth), this.me.bind(this))
    this.router.post('/logout', this.logout.bind(this))
    this.router.put('/password', auth.authenticate.bind(auth), this.password.bind(this))
  }
  private async login(req: HttpRequest, res: HttpResponse): Promise<void> {
    const body = z
      .object({
        identifier: z.string().trim().min(1).max(254),
        password: z.string().min(1).max(128),
      })
      .strict()
      .or(
        z
          .object({
            email: z.string().trim().email().max(254),
            password: z.string().min(1).max(128),
          })
          .strict(),
      )
      .parse(req.body)
    await this.users.attempt(`login:ip:${req.ip ?? 'unknown'}`, 50)
    const session = await this.users.login(
      'identifier' in body ? body.identifier : body.email,
      body.password,
      this.auth.token(req),
    )
    res.cookie(this.auth.cookieName, session.token, {
      ...this.auth.cookieOptions,
      expires: session.expiresAt,
    })
    res.json(session.user)
  }
  private me(_req: HttpRequest, res: HttpResponse): void {
    res.json(Http.user(res))
  }
  private async logout(req: HttpRequest, res: HttpResponse): Promise<void> {
    await this.users.logout(this.auth.token(req))
    res.clearCookie(this.auth.cookieName, this.auth.cookieOptions)
    res.sendStatus(204)
  }
  private async password(req: HttpRequest, res: HttpResponse): Promise<void> {
    const body = z
      .object({
        currentPassword: z.string().min(1).max(128),
        password: z.string().min(12).max(128),
      })
      .strict()
      .parse(req.body)
    await this.users.attempt(`password:user:${Http.user(res).id}`, 10)
    await this.users.changePassword(Http.user(res).id, body.currentPassword, body.password)
    res.clearCookie(this.auth.cookieName, this.auth.cookieOptions)
    res.sendStatus(204)
  }
  private async reset(req: HttpRequest, res: HttpResponse): Promise<void> {
    const body = z
      .object({
        token: z.string().regex(/^[A-Za-z0-9_-]{43}$/),
        password: z.string().min(12).max(128),
      })
      .strict()
      .parse(req.body)
    await this.users.attempt(`reset:ip:${req.ip ?? 'unknown'}`, 10)
    await this.users.reset(body.token, body.password)
    res.clearCookie(this.auth.cookieName, this.auth.cookieOptions)
    res.sendStatus(204)
  }
}
