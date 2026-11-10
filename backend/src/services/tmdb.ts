import { z } from 'zod'
import type { Language, MovieMetadata } from '../models/entities.js'
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
}
