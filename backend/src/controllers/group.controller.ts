import { Router, type Router as ExpressRouter } from 'express'
import { z } from 'zod'
import type { GroupService } from '../services/group.service.js'
import type { UserService } from '../services/user.service.js'
import type { AuthMiddleware } from '../shared/auth.middleware.js'
import type { ContainerConfig } from '../container.js'
import { Http, type HttpRequest, type HttpResponse } from '../shared/http.js'
export class GroupController {
  readonly router: ExpressRouter = Router()
  private readonly token = z.string().regex(/^[A-Za-z0-9_-]{43}$/)
  constructor(
    private readonly groups: GroupService,
    private readonly users: UserService,
    private readonly auth: AuthMiddleware,
    private readonly config: ContainerConfig,
  ) {
    this.router.get('/invitations/:token', this.preview.bind(this))
    this.router.post('/auth/register', this.register.bind(this))
    this.router.get('/groups', auth.authenticate.bind(auth), this.list.bind(this))
    this.router.post('/groups', auth.authenticate.bind(auth), this.create.bind(this))
    this.router.get('/groups/:id/members', auth.authenticate.bind(auth), this.members.bind(this))
    this.router.patch('/groups/:id', auth.authenticate.bind(auth), this.rename.bind(this))
    this.router.delete('/groups/:id', auth.authenticate.bind(auth), this.delete.bind(this))
    this.router.delete(
      '/groups/:id/members/:userId',
      auth.authenticate.bind(auth),
      this.removeMember.bind(this),
    )
    this.router.post('/invitations', auth.authenticate.bind(auth), this.invite.bind(this))
    this.router.post(
      '/invitations/:token/accept',
      auth.authenticate.bind(auth),
      this.accept.bind(this),
    )
  }
  private async preview(req: HttpRequest, res: HttpResponse): Promise<void> {
    await this.users.attempt(`invitation:ip:${req.ip ?? 'unknown'}`, 100)
    const invite = await this.groups.invitation(this.token.parse(req.params.token))
    res.json({ groupName: invite.groupName, expiresAt: invite.expiresAt })
  }
  private async list(_req: HttpRequest, res: HttpResponse): Promise<void> {
    res.json(await this.groups.list(Http.user(res).id))
  }
  private async create(req: HttpRequest, res: HttpResponse): Promise<void> {
    const { name } = z
      .object({ name: z.string().trim().min(1).max(80) })
      .strict()
      .parse(req.body)
    await this.users.attempt(`group:create:${Http.user(res).id}`, 20)
    res.status(201).json(await this.groups.create(Http.user(res).id, name))
  }
  private async members(req: HttpRequest, res: HttpResponse): Promise<void> {
    res.json(await this.groups.members(Http.user(res).id, Http.id.parse(req.params.id)))
  }
  private async rename(req: HttpRequest, res: HttpResponse): Promise<void> {
    const { name } = z
      .object({ name: z.string().trim().min(1).max(80) })
      .strict()
      .parse(req.body)
    res.json(await this.groups.rename(Http.user(res).id, Http.id.parse(req.params.id), name))
  }
  private async removeMember(req: HttpRequest, res: HttpResponse): Promise<void> {
    z.object({})
      .strict()
      .parse(req.body ?? {})
    await this.groups.removeMember(
      Http.user(res).id,
      Http.id.parse(req.params.id),
      Http.id.parse(req.params.userId),
    )
    res.sendStatus(204)
  }
  private async delete(req: HttpRequest, res: HttpResponse): Promise<void> {
    z.object({})
      .strict()
      .parse(req.body ?? {})
    await this.groups.delete(Http.user(res).id, Http.id.parse(req.params.id))
    res.sendStatus(204)
  }
  private async invite(req: HttpRequest, res: HttpResponse): Promise<void> {
    const { groupId } = z.object({ groupId: Http.id.optional() }).strict().parse(req.body)
    await this.users.attempt(`invite:create:${Http.user(res).id}`, 30)
    const invitation = await this.groups.invite(Http.user(res).id, groupId ?? null)
    res.status(201).json({
      url: `${this.config.origin}/#invite=${invitation.token}`,
      expiresAt: invitation.expiresAt,
    })
  }
  private async accept(req: HttpRequest, res: HttpResponse): Promise<void> {
    z.object({})
      .strict()
      .parse(req.body ?? {})
    await this.groups.accept(this.token.parse(req.params.token), Http.user(res).id)
    res.json(await this.groups.list(Http.user(res).id))
  }
  private async register(req: HttpRequest, res: HttpResponse): Promise<void> {
    const body = z
      .object({
        token: this.token,
        username: z.string().min(3).max(32),
        password: z.string().min(6).max(128),
        name: z.string().trim().min(1).max(80).optional(),
      })
      .strict()
      .parse(req.body)
    await this.users.attempt(`register:ip:${req.ip ?? 'unknown'}`, 20)
    await this.groups.register(body.token, body.username, body.password, body.name)
    const session = await this.users.login(body.username, body.password, this.auth.token(req))
    res.cookie(this.auth.cookieName, session.token, {
      ...this.auth.cookieOptions,
      expires: session.expiresAt,
    })
    res.status(201).json(session.user)
  }
}
