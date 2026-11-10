import type { NextFunction, CookieOptions } from 'express'
import type { UserService } from '../services/user.service.js'
import type { ContainerConfig } from '../container.js'
import type { User } from '../models/entities.js'
import type { HttpRequest, HttpResponse } from './http.js'
import {
  AuthenticationRequiredException,
  ForbiddenException,
  InvalidOriginException,
} from './exceptions/index.js'
export class AuthMiddleware {
  constructor(
    private readonly users: UserService,
    private readonly config: ContainerConfig,
  ) {}
  get cookieName(): string {
    return this.config.secureCookies ? '__Host-mainflix_session' : 'mainflix_session'
  }
  get cookieOptions(): CookieOptions {
    return { httpOnly: true, secure: this.config.secureCookies, sameSite: 'lax', path: '/' }
  }
  token(req: HttpRequest): string | undefined {
    const match: string | undefined = req.headers.cookie
      ?.split(';')
      .map((v) => v.trim())
      .find((v) => v.startsWith(`${this.cookieName}=`))
    const value: string | undefined = match?.slice(this.cookieName.length + 1)
    return value && /^[A-Za-z0-9_-]{43}$/.test(value) ? value : undefined
  }
  origin(req: HttpRequest, _res: HttpResponse, next: NextFunction): void {
    if (
      !['GET', 'HEAD', 'OPTIONS'].includes(req.method) &&
      req.get('origin') !== this.config.origin
    )
      throw new InvalidOriginException()
    next()
  }
  async authenticate(req: HttpRequest, res: HttpResponse, next: NextFunction): Promise<void> {
    const user: User | null = await this.users.user(this.token(req))
    if (!user) throw new AuthenticationRequiredException()
    res.locals.user = user
    next()
  }
  admin(_req: HttpRequest, res: HttpResponse, next: NextFunction): void {
    if (!res.locals.user?.is_admin) throw new ForbiddenException()
    next()
  }
}
