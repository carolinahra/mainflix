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
    this.router.get('/to-review', this.toReview.bind(this))
    this.router.get('/favorites', this.favorites.bind(this))
    this.router.post('/favorites', this.favoriteTmdb.bind(this))
    this.router.get('/:id', this.detail.bind(this))
    this.router.get('/:id/providers', this.watchProviders.bind(this))
    this.router.put('/:id/watched', this.watched.bind(this))
    this.router.put('/:id/review', this.review.bind(this))
    this.router.put('/:id/favorite', this.favorite.bind(this))
    this.router.delete('/:id/favorite', this.favorite.bind(this))
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
    res.json({
      movie: await this.movies.find(id, Http.language(req)),
      ...(await this.reviews.list(id, Http.user(res).id)),
      favorite: await this.movies.isFavorite(Http.user(res).id, id),
    })
  }
  private async watchProviders(req: HttpRequest, res: HttpResponse): Promise<void> {
    res.json(await this.movies.watchProviders(Http.id.parse(req.params.id)))
  }
  private async reviewed(req: HttpRequest, res: HttpResponse): Promise<void> {
    const { limit, offset } = Http.pagination.parse(req.query)
    const mine = z.enum(['true', 'false']).optional().parse(req.query.mine) === 'true'
    res.json(await this.reviews.all(limit, offset, Http.user(res).id, mine))
  }
  private async toReview(_req: HttpRequest, res: HttpResponse): Promise<void> {
    res.json(await this.reviews.toReview())
  }
  private async favorites(req: HttpRequest, res: HttpResponse): Promise<void> {
    const { limit, offset } = Http.pagination.parse(req.query)
    res.json(await this.movies.favorites(Http.user(res).id, limit, offset))
  }
  private async favorite(req: HttpRequest, res: HttpResponse): Promise<void> {
    z.object({})
      .strict()
      .parse(req.body ?? {})
    await this.movies.favorite(
      Http.user(res).id,
      Http.id.parse(req.params.id),
      req.method === 'PUT',
    )
    res.sendStatus(204)
  }
  private async favoriteTmdb(req: HttpRequest, res: HttpResponse): Promise<void> {
    const { tmdbId } = z
      .object({ tmdbId: z.number().int().positive().max(2147483647) })
      .strict()
      .parse(req.body)
    res.json(await this.movies.favoriteTmdb(Http.user(res).id, tmdbId, Http.language(req)))
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
