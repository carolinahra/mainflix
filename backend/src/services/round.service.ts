import type { Database } from '../repositories/database.js'
import type { Connection } from '../repositories/schema.js'
import type { RoundRepository } from '../repositories/round.repository.js'
import type { MovieRepository } from '../repositories/movie.repository.js'
import type { Clock } from './clock.js'
import type { Lottery } from './lottery.js'
import type {
  RoundState,
  RoundRow,
  RoundResponse,
  Movie,
  RoundStatus,
  HistoryEntry,
} from '../models/entities.js'
import {
  AppException,
  RoundExpiredException,
  RoundNotFoundException,
  RoundLockedException,
  MovieNotEligibleException,
  RoundNotReadyException,
  NoNominationsException,
} from '../shared/exceptions/index.js'

export class RoundService {
  constructor(
    private readonly database: Database,
    private readonly repository: RoundRepository,
    private readonly movies: MovieRepository,
    private readonly clock: Clock,
    private readonly lottery: Lottery,
  ) {}
  private async prepare(db: Connection, expected?: string): Promise<string> {
    await this.database.lockGroup(db)
    const week: string = this.clock.weekKey()
    if (expected && expected !== week) throw new RoundExpiredException()
    await this.repository.ensure(week, db)
    await this.repository.prune(week, db)
    return week
  }
  private async snapshot(week: string, db: Connection): Promise<RoundState> {
    const row: RoundRow | undefined = await this.repository.row(week, db)
    if (!row) throw new RoundNotFoundException()
    const responses: RoundResponse[] = await this.repository.responses(week, db)
    const winner: Movie | null = row.winner_id
      ? ((await this.movies.find(row.winner_id, db)) ?? null)
      : null
    const status: RoundStatus = winner
      ? 'selected'
      : responses.length < 4
        ? 'collecting'
        : responses.some((r) => r.movie_id !== null)
          ? 'ready'
          : 'skipped'
    return { ...row, winner, status, responses, members: await this.repository.members(db) }
  }
  async current(): Promise<RoundState> {
    return this.database.transaction(async (db) => this.snapshot(await this.prepare(db), db))
  }
  async respond(userId: number, week: string, movieId: number | null): Promise<RoundState> {
    return this.database.transaction(async (db) => {
      await this.prepare(db, week)
      if ((await this.snapshot(week, db)).status !== 'collecting') throw new RoundLockedException()
      if (movieId !== null) {
        const movie: Movie | undefined = await this.movies.find(movieId, db)
        if (!movie?.eligible || movie.approval_status !== 'approved')
          throw new MovieNotEligibleException()
      }
      await this.repository.respond(userId, week, movieId, db)
      return this.snapshot(week, db)
    })
  }
  async draw(userId: number, week: string): Promise<RoundState> {
    const result: RoundState | AppException = await this.database.transaction(async (db) => {
      await this.prepare(db, week)
      const state: RoundState = await this.snapshot(week, db)
      if (state.winner) return state
      // Commit invalidation before reporting that replacement nominations are needed.
      if (state.status !== 'ready')
        return state.status === 'skipped'
          ? new NoNominationsException()
          : new RoundNotReadyException()
      const entries: RoundResponse[] = state.responses.filter((r) => r.movie_id !== null)
      const winner: number = entries[this.lottery.index(entries.length)]!.movie_id!
      await this.repository.setWinner(week, winner, userId, this.clock.now(), db)
      await this.movies.update(
        winner,
        {
          eligible: false,
          eligibility_changed_by: userId,
          eligibility_changed_at: this.clock.now(),
        },
        db,
      )
      return this.snapshot(week, db)
    })
    if (result instanceof AppException) throw result
    return result
  }
  async history(limit: number, offset: number): Promise<HistoryEntry[]> {
    return this.repository.history(limit, offset)
  }
}
