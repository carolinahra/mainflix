import type { Updateable } from 'kysely'
import type { Database } from '../repositories/database.js'
import type { Schema } from '../repositories/schema.js'
import type { MovieRepository } from '../repositories/movie.repository.js'
import type { RoundRepository } from '../repositories/round.repository.js'
import type { Clock } from './clock.js'
import type { Tmdb } from './tmdb.js'
import type {
  Movie,
  MovieInput,
  MoviePatch,
  MovieMetadata,
  MovieSearch,
  Language,
  MovieCategory,
  MovieBrowse,
  MovieWatchProviders,
} from '../models/entities.js'
import {
  AppException,
  DuplicateMovieException,
  MovieNotFoundException,
  InvalidMergeException,
  SelectedMovieApprovalLockedException,
} from '../shared/exceptions/index.js'

export class MovieService {
  constructor(
    private readonly database: Database,
    private readonly repository: MovieRepository,
    private readonly rounds: RoundRepository,
    private readonly tmdb: Tmdb,
    private readonly clock: Clock,
  ) {}
  async browse(
    category: MovieCategory,
    language: Language,
    page: number,
    yearFrom?: number,
    yearTo?: number,
  ): Promise<MovieBrowse> {
    if (category === 'recentlyAdded') {
      const local = await this.repository.recentlyAdded(21, (page - 1) * 20)
      return {
        local: local.slice(0, 20),
        remote: [],
        remoteError: null,
        page,
        totalPages: local.length > 20 ? page + 1 : page,
      }
    }
    try {
      const result = await this.tmdb.browse(
        category,
        language,
        page,
        this.clock.now(),
        yearFrom,
        yearTo,
      )
      const local = await this.repository.findTmdbIds(result.movies.map((movie) => movie.tmdb_id))
      return {
        local,
        remote: result.movies,
        remoteError: null,
        page,
        totalPages: result.totalPages,
      }
    } catch (error: unknown) {
      if (!(error instanceof AppException)) throw error
      return { local: [], remote: [], remoteError: error.code, page, totalPages: page }
    }
  }
  async search(
    query: string,
    language: Language,
    limit: number,
    offset: number,
  ): Promise<MovieSearch> {
    const local: Movie[] = await this.repository.search(query, limit, offset)
    if (!query) return { local, remote: [], remoteError: null }
    try {
      const remote: MovieMetadata[] = await this.tmdb.search(query, language)
      return { local, remote, remoteError: null }
    } catch (error: unknown) {
      if (!(error instanceof AppException)) throw error
      return { local, remote: [], remoteError: error.code }
    }
  }
  async find(id: number, language?: Language): Promise<Movie> {
    const movie: Movie | undefined = await this.repository.find(id)
    if (!movie) throw new MovieNotFoundException()
    if (language && movie.tmdb_id) {
      try {
        const metadata = await this.tmdb.details(movie.tmdb_id, language)
        return { ...movie, overview: metadata.overview || movie.overview }
      } catch (error: unknown) {
        if (!(error instanceof AppException)) throw error
      }
    }
    return movie
  }
  async watchProviders(id: number): Promise<MovieWatchProviders | null> {
    const movie = await this.find(id)
    if (!movie.tmdb_id) return null
    try {
      return await this.tmdb.watchProviders(movie.tmdb_id)
    } catch (error: unknown) {
      if (!(error instanceof AppException)) throw error
      return null
    }
  }
  async pending(limit: number, offset: number): Promise<Movie[]> {
    return this.repository.pending(limit, offset)
  }
  async favorites(userId: number, limit: number, offset: number): Promise<Movie[]> {
    return this.repository.favorites(userId, limit, offset)
  }
  async isFavorite(userId: number, movieId: number): Promise<boolean> {
    return this.repository.isFavorite(userId, movieId)
  }
  async favorite(userId: number, movieId: number, favorite: boolean): Promise<void> {
    await this.database.transaction(async (db) => {
      await this.database.lockGroup(db, this.repository.groupId)
      if (!(await this.repository.find(movieId, db))) throw new MovieNotFoundException()
      await this.repository.favorite(userId, movieId, favorite, db)
    })
  }
  async favoriteTmdb(userId: number, tmdbId: number, language: Language): Promise<Movie> {
    const metadata = await this.tmdb.details(tmdbId, language)
    return this.database.transaction(async (db) => {
      await this.database.lockGroup(db, this.repository.groupId)
      let movie = await this.repository.findTmdb(tmdbId, db)
      if (!movie)
        movie = await this.repository.create(
          { ...metadata, submitted_by: userId, approval_status: 'approved' },
          db,
        )
      await this.repository.favorite(userId, movie.id, true, db)
      return movie
    })
  }
  async submit(userId: number, input: MovieInput, language: Language = 'en'): Promise<Movie> {
    if (input.tmdbId) {
      const existing: Movie | undefined = await this.repository.findTmdb(input.tmdbId)
      if (existing) return existing
    }
    const metadata: MovieMetadata | undefined = input.tmdbId
      ? await this.tmdb.details(input.tmdbId, language)
      : undefined
    return this.database.transaction(async (db) => {
      await this.database.lockGroup(db, this.repository.groupId)
      // Recheck under the lock after the external request to handle simultaneous imports.
      if (metadata) {
        const existing = await this.repository.findTmdb(metadata.tmdb_id, db)
        if (existing) return existing
      }
      return this.repository.create(
        {
          ...metadata,
          title: metadata?.title ?? input.title!,
          release_year: metadata?.release_year ?? input.releaseYear ?? null,
          submitted_by: userId,
          approval_status: 'approved',
        },
        db,
      )
    })
  }
  async update(adminId: number, id: number, patch: MoviePatch): Promise<Movie> {
    const metadata: MovieMetadata | undefined = patch.tmdbId
      ? await this.tmdb.details(patch.tmdbId)
      : undefined
    return this.database.transaction(async (db) => {
      await this.database.lockGroup(db, this.repository.groupId)
      const movie: Movie | undefined = await this.repository.find(id, db)
      if (!movie) throw new MovieNotFoundException()
      if (metadata) {
        const existing: Movie | undefined = await this.repository.findTmdb(metadata.tmdb_id, db)
        if (existing && existing.id !== id) throw new DuplicateMovieException()
      }
      if (
        patch.approvalStatus &&
        patch.approvalStatus !== 'approved' &&
        (await this.rounds.hasSelected(id, db))
      )
        throw new SelectedMovieApprovalLockedException()
      const values: Updateable<Schema['movies']> = { ...metadata }
      if (patch.title !== undefined) values.title = patch.title
      if (patch.releaseYear !== undefined) values.release_year = patch.releaseYear
      if (patch.overview !== undefined) values.overview = patch.overview
      if (patch.approvalStatus !== undefined) values.approval_status = patch.approvalStatus
      if (patch.eligible !== undefined)
        Object.assign(values, {
          eligible: patch.eligible,
          eligibility_changed_by: adminId,
          eligibility_changed_at: this.clock.now(),
        })
      const updated: Movie = await this.repository.update(id, values, db)
      await this.rounds.prune(this.clock.weekKey(), db)
      return updated
    })
  }
  async merge(source: number, target: number): Promise<Movie> {
    return this.database.transaction(async (db) => {
      await this.database.lockGroup(db, this.repository.groupId)
      const from: Movie | undefined = await this.repository.find(source, db)
      const to: Movie | undefined = await this.repository.find(target, db)
      if (source === target || from?.approval_status !== 'pending' || !to)
        throw new InvalidMergeException()
      await this.repository.mergeFavorites(source, target, db)
      await this.repository.removePending(source, db)
      return to
    })
  }
}
