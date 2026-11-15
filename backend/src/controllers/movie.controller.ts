import { Router, type Router as ExpressRouter } from 'express'
import { z } from 'zod'
import type { MovieService } from '../services/movie.service.js'
import type { ReviewService } from '../services/review.service.js'
import { Http, type HttpRequest, type HttpResponse } from '../shared/http.js'
import { movieCategories } from '../models/entities.js'
export class MovieController {
  readonly router: ExpressRouter = Router()
  constructor(
    private readonly movies: MovieService,
    private readonly reviews: ReviewService,
  ) {
    this.router.get('/', this.search.bind(this))
    this.router.post('/', this.submit.bind(this))
    this.router.get('/browse', this.browse.bind(this))
    this.router.get('/reviews', this.reviewed.bind(this))
    this.router.get('/:id', this.detail.bind(this))
    this.router.put('/:id/watched', this.watched.bind(this))
    this.router.put('/:id/review', this.review.bind(this))
  }
  private async browse(req: HttpRequest, res: HttpResponse): Promise<void> {
    const category = z.enum(movieCategories).parse(req.query.category)
    const page = z.coerce.number().int().min(1).max(500).default(1).parse(req.query.page)
    const years = z
      .object({
        yearFrom: z.coerce.number().int().min(1870).max(2200).optional(),
        yearTo: z.coerce.number().int().min(1870).max(2200).optional(),
      })
      .refine(
        ({ yearFrom, yearTo }) =>
          yearFrom === undefined || yearTo === undefined || yearFrom <= yearTo,
      )
      .parse(req.query)
    res.json(
      await this.movies.browse(category, Http.language(req), page, years.yearFrom, years.yearTo),
    )
  }
  private async search(req: HttpRequest, res: HttpResponse): Promise<void> {
    const q: string = z.string().trim().max(200).default('').parse(req.query.q)
    const { limit, offset } = Http.pagination.parse(req.query)
    res.json(await this.movies.search(q, Http.language(req), limit, offset))
  }
  private async submit(req: HttpRequest, res: HttpResponse): Promise<void> {
    const body = z
      .union([
        z.object({ tmdbId: z.number().int().positive().max(2147483647) }).strict(),
        z
          .object({
            title: z.string().trim().min(1).max(300),
            releaseYear: z.number().int().min(1870).max(2200).nullable().optional(),
          })
          .strict(),
      ])
      .parse(req.body)
    res.status(201).json(await this.movies.submit(Http.user(res).id, body, Http.language(req)))
  }
  private async detail(req: HttpRequest, res: HttpResponse): Promise<void> {
    const id: number = Http.id.parse(req.params.id)
    res.json({ movie: await this.movies.find(id), ...(await this.reviews.list(id)) })
  }
  private async reviewed(req: HttpRequest, res: HttpResponse): Promise<void> {
    const { limit, offset } = Http.pagination.parse(req.query)
    res.json(await this.reviews.all(limit, offset))
  }
  private async watched(req: HttpRequest, res: HttpResponse): Promise<void> {
    z.object({})
      .strict()
      .parse(req.body ?? {})
    await this.reviews.markWatched(Http.user(res).id, Http.id.parse(req.params.id))
    res.sendStatus(204)
  }
  private async review(req: HttpRequest, res: HttpResponse): Promise<void> {
    const body = z
      .object({
        rating: z.number().min(0.5).max(5).multipleOf(0.5),
        text: z.string().max(10000).default(''),
      })
      .strict()
      .parse(req.body)
    await this.reviews.save(Http.user(res).id, Http.id.parse(req.params.id), body.rating, body.text)
    res.sendStatus(204)
  }
}
