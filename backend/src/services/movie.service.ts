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
  async find(id: number): Promise<Movie> {
    const movie: Movie | undefined = await this.repository.find(id)
    if (!movie) throw new MovieNotFoundException()
    return movie
  }
  async pending(limit: number, offset: number): Promise<Movie[]> {
    return this.repository.pending(limit, offset)
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
      await this.database.lockGroup(db)
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
          approval_status: 'pending',
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
      await this.database.lockGroup(db)
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
      await this.database.lockGroup(db)
      const from: Movie | undefined = await this.repository.find(source, db)
      const to: Movie | undefined = await this.repository.find(target, db)
      if (source === target || from?.approval_status !== 'pending' || !to)
        throw new InvalidMergeException()
      await this.repository.removePending(source, db)
      return to
    })
  }
}
