import { z } from 'zod'
import type {
  Language,
  MovieMetadata,
  MovieCategory,
  MovieWatchProviders,
} from '../models/entities.js'
import { TmdbNotConfiguredException, TmdbUnavailableException } from '../shared/exceptions/index.js'
export class Tmdb {
  private readonly metadataSchema = z.object({
    id: z.number().int().positive(),
    title: z.string().min(1).max(300),
    release_date: z.string().optional(),
    overview: z.string().max(20000).optional(),
    poster_path: z
      .string()
      .regex(/^\/[A-Za-z0-9._-]+$/)
      .nullable()
      .optional(),
    backdrop_path: z
      .string()
      .regex(/^\/[A-Za-z0-9._-]+$/)
      .nullable()
      .optional(),
  })
  constructor(
    private readonly token: string,
    private readonly request: typeof fetch = fetch,
  ) {}
  private async get(path: string, language: Language): Promise<unknown> {
    if (!this.token) throw new TmdbNotConfiguredException()
    try {
      const response: Response = await this.request(
        `https://api.themoviedb.org/3/${path}${path.includes('?') ? '&' : '?'}language=${language === 'es' ? 'es-ES' : 'en-US'}`,
        {
          headers: { Authorization: `Bearer ${this.token}`, Accept: 'application/json' },
          signal: AbortSignal.timeout(5000),
        },
      )
      if (!response.ok) throw new TmdbUnavailableException()
      return (await response.json()) as unknown
    } catch (error: unknown) {
      if (error instanceof TmdbNotConfiguredException) throw error
      throw new TmdbUnavailableException()
    }
  }
  private metadata(value: unknown): MovieMetadata {
    const row = this.metadataSchema.parse(value)
    const year: number = Number(row.release_date?.slice(0, 4))
    return {
      tmdb_id: row.id,
      title: row.title,
      release_year: Number.isInteger(year) && year >= 1870 && year <= 2200 ? year : null,
      overview: row.overview ?? '',
      poster_path: row.poster_path ?? null,
      ...(row.backdrop_path === undefined ? {} : { backdrop_path: row.backdrop_path }),
    }
  }
  async search(query: string, language: Language): Promise<MovieMetadata[]> {
    const payload: unknown = await this.get(
      `search/movie?include_adult=false&query=${encodeURIComponent(query)}`,
      language,
    )
    try {
      return z
        .object({ results: z.array(z.unknown()) })
        .parse(payload)
        .results.map((value) => this.metadata(value))
    } catch {
      throw new TmdbUnavailableException()
    }
  }
  async details(id: number, language: Language = 'en'): Promise<MovieMetadata> {
    const payload: unknown = await this.get(`movie/${id}`, language)
    try {
      const movie: MovieMetadata = this.metadata(payload)
      if (movie.tmdb_id !== id) throw new TmdbUnavailableException()
      return movie
    } catch {
      throw new TmdbUnavailableException()
    }
  }
  async watchProviders(id: number): Promise<MovieWatchProviders | null> {
    const payload = await this.get(`movie/${id}/watch/providers`, 'es')
    try {
      const provider = z.object({
        provider_id: z.number().int().positive(),
        provider_name: z.string().min(1).max(300),
        logo_path: z.string().regex(/^\/[A-Za-z0-9._-]+$/),
      })
      const { results } = z
        .object({
          results: z.object({
            ES: z
              .object({
                link: z
                  .string()
                  .url()
                  .regex(/^https:\/\/www\.themoviedb\.org\/movie\//),
                flatrate: z.array(provider).default([]),
                rent: z.array(provider).default([]),
              })
              .optional(),
          }),
        })
        .parse(payload)
      return results.ES ?? null
    } catch {
      throw new TmdbUnavailableException()
    }
  }
  async browse(
    category: Exclude<MovieCategory, 'recentlyAdded'>,
    language: Language,
    page: number,
    now: Date,
    yearFrom?: number,
    yearTo?: number,
  ): Promise<{ movies: MovieMetadata[]; totalPages: number }> {
    if (category === 'featured')
      return {
        movies: await Promise.all([1422041, 1522071].map((id) => this.details(id, language))),
        totalPages: 1,
      }
    const genres: Partial<Record<MovieCategory, string>> = {
      romanticComedy: '35,10749',
      horror: '27',
      comedy: '35',
      action: '28',
      scienceFiction: '878',
      drama: '18',
      thriller: '53',
      animation: '16',
      adventure: '12',
      fantasy: '14',
      romance: '10749',
    }
    const params = new URLSearchParams({
      include_adult: 'false',
      include_video: 'false',
      region: 'ES',
      sort_by: 'popularity.desc',
      page: String(page),
    })
    if (genres[category]) params.set('with_genres', genres[category])
    if (category === 'christmas') params.set('with_keywords', '207317')
    if (yearFrom !== undefined) params.set('primary_release_date.gte', `${yearFrom}-01-01`)
    if (yearTo !== undefined) params.set('primary_release_date.lte', `${yearTo}-12-31`)
    if (category === 'newReleases') {
      params.set(
        'release_date.gte',
        new Date(now.getTime() - 90 * 86400000).toISOString().slice(0, 10),
      )
      params.set('release_date.lte', now.toISOString().slice(0, 10))
      params.set('with_release_type', '3|2|4')
    }
    const path =
      category === 'barbie'
        ? `search/movie?include_adult=false&query=Barbie&page=${page}`
        : `discover/movie?${params}`
    const payload = await this.get(path, language)
    try {
      const result = z
        .object({ results: z.array(z.unknown()), total_pages: z.number().int().nonnegative() })
        .parse(payload)
      return {
        movies: result.results.map((value) => this.metadata(value)),
        totalPages: Math.min(result.total_pages, 500),
      }
    } catch {
      throw new TmdbUnavailableException()
    }
  }
}
