import { Router, type Router as ExpressRouter } from 'express'
import { z } from 'zod'
import type { MovieService } from '../services/movie.service.js'
import type { UserService } from '../services/user.service.js'
import type { ContainerConfig } from '../container.js'
import { Http, type HttpRequest, type HttpResponse } from '../shared/http.js'
export class AdminController {
  readonly router: ExpressRouter = Router()
  constructor(
    private readonly movies: MovieService,
    private readonly users: UserService,
    private readonly config: ContainerConfig,
  ) {
    this.router.get('/movies/pending', this.pending.bind(this))
    this.router.patch('/movies/:id', this.update.bind(this))
    this.router.post('/movies/:id/merge', this.merge.bind(this))
    this.router.get('/users', this.members.bind(this))
    this.router.post('/users/:id/reset', this.reset.bind(this))
  }
  private async pending(req: HttpRequest, res: HttpResponse): Promise<void> {
    const { limit, offset } = Http.pagination.parse(req.query)
    res.json(await this.movies.pending(limit, offset))
  }
  private async update(req: HttpRequest, res: HttpResponse): Promise<void> {
    const body = z
      .object({
        title: z.string().trim().min(1).max(300).optional(),
        tmdbId: z.number().int().positive().max(2147483647).optional(),
        releaseYear: z.number().int().min(1870).max(2200).nullable().optional(),
        overview: z.string().max(20000).optional(),
        approvalStatus: z.enum(['pending', 'approved', 'rejected']).optional(),
        eligible: z.boolean().optional(),
      })
      .strict()
      .refine((value) => Object.keys(value).length > 0)
      .parse(req.body)
    res.json(await this.movies.update(Http.user(res).id, Http.id.parse(req.params.id), body))
  }
  private async merge(req: HttpRequest, res: HttpResponse): Promise<void> {
    const body = z
      .object({ targetId: z.number().int().positive().max(2147483647) })
      .strict()
      .parse(req.body)
    res.json(await this.movies.merge(Http.id.parse(req.params.id), body.targetId))
  }
  private async members(_req: HttpRequest, res: HttpResponse): Promise<void> {
    res.json(await this.users.list())
  }
  private async reset(req: HttpRequest, res: HttpResponse): Promise<void> {
    const reset = await this.users.issueReset(Http.id.parse(req.params.id))
    res.json({ url: `${this.config.origin}/#reset=${reset.token}`, expiresAt: reset.expiresAt })
  }
}
