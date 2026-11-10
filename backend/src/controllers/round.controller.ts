import { Router, type Router as ExpressRouter } from 'express'
import { z } from 'zod'
import type { RoundService } from '../services/round.service.js'
import { Http, type HttpRequest, type HttpResponse } from '../shared/http.js'
export class RoundController {
  readonly router: ExpressRouter = Router()
  constructor(private readonly rounds: RoundService) {
    this.router.get('/current', this.current.bind(this))
    this.router.get('/', this.history.bind(this))
    this.router.put('/:week/response', this.respond.bind(this))
    this.router.post('/:week/draw', this.draw.bind(this))
  }
  private async current(_req: HttpRequest, res: HttpResponse): Promise<void> {
    res.json(await this.rounds.current())
  }
  private async history(req: HttpRequest, res: HttpResponse): Promise<void> {
    const { limit, offset } = Http.pagination.parse(req.query)
    res.json(await this.rounds.history(limit, offset))
  }
  private async respond(req: HttpRequest, res: HttpResponse): Promise<void> {
    const week: string = Http.week.parse(req.params.week)
    const body = z
      .object({ movieId: z.number().int().positive().max(2147483647).nullable() })
      .strict()
      .parse(req.body)
    res.json(await this.rounds.respond(Http.user(res).id, week, body.movieId))
  }
  private async draw(req: HttpRequest, res: HttpResponse): Promise<void> {
    res.json(await this.rounds.draw(Http.user(res).id, Http.week.parse(req.params.week)))
  }
}
