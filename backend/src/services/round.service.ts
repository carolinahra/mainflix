import type { Database } from '../repositories/database.js'
import type { Connection } from '../repositories/schema.js'
import type { RoundRepository } from '../repositories/round.repository.js'
import type { MovieRepository } from '../repositories/movie.repository.js'
import type { Clock } from './clock.js'
import type { Tmdb } from './tmdb.js'
import type { Lottery } from './lottery.js'
import type {
  Language,
  RoundState,
  RoundRow,
  RoundResponse,
  Movie,
  RoundStatus,
  HistoryEntry,
  RoundView,
  SurveyAction,
  SurveyAnswer,
} from '../models/entities.js'
import {
  AppException,
  RoundExpiredException,
  RoundNotFoundException,
  RoundLockedException,
  MovieNotEligibleException,
  RoundNotReadyException,
  NoNominationsException,
  ForbiddenException,
  ValidationException,
} from '../shared/exceptions/index.js'

export class RoundService {
  constructor(
    private readonly database: Database,
    private readonly repository: RoundRepository,
    private readonly movies: MovieRepository,
    private readonly clock: Clock,
    private readonly lottery: Lottery,
    private readonly tmdb: Tmdb,
  ) {}
  private async prepare(db: Connection, expected?: string): Promise<string> {
    await this.database.lockGroup(db, this.repository.groupId)
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
    const members = await this.repository.members(db, week)
    const status: RoundStatus = winner
      ? 'selected'
      : members.length === 0 || responses.length < members.length
        ? 'collecting'
        : responses.some((r) => r.movie_id !== null)
          ? 'ready'
          : 'skipped'
    return { ...row, winner, status, responses, members }
  }
  async current(): Promise<RoundState> {
    return this.database.transaction(async (db) => this.snapshot(await this.prepare(db), db))
  }
  private async present(state: RoundState, userId: number, db: Connection): Promise<RoundView> {
    if (!(await this.repository.isMember(userId, db))) throw new ForbiddenException()
    const participants = await this.repository.survey(state.week, db)
    const own = participants.find((participant) => participant.user_id === userId)
    const revealed =
      state.status === 'skipped' ||
      Boolean(
        state.winner &&
        (!state.survey_enabled ||
          (participants.length > 0 &&
            participants.every((participant) => participant.completed_at))),
      )
    const nominations: RoundView['nominations'] = []
    if (state.status !== 'collecting') {
      for (const response of state.responses) {
        if (response.movie_id === null) continue
        const nomination = nominations.find((entry) => entry.movieId === response.movie_id)
        if (nomination) nomination.count++
        else nominations.push({ movieId: response.movie_id, title: response.title!, count: 1 })
      }
      nominations.sort((a, b) => a.movieId - b.movieId)
    }
    const survey =
      state.winner && state.survey_enabled
        ? {
            eligible: Boolean(own),
            completed: Boolean(own?.completed_at),
            participants: participants.map((participant) => ({
              id: participant.user_id,
              name: participant.name,
              username: participant.username,
              avatar: participant.avatar,
              completed: Boolean(participant.completed_at),
            })),
            questions: nominations.map((nomination) => {
              const answer = own?.answers.find((answer) => answer.movieId === nomination.movieId)
              const answers = participants.flatMap((participant) =>
                participant.answers.filter(
                  (answer) => answer.movieId === nomination.movieId && answer.userIds !== null,
                ),
              )
              const showResults = Boolean(answer || own?.completed_at || !own || revealed)
              return {
                movieId: nomination.movieId,
                title: nomination.title,
                answered: Boolean(answer),
                userIds: answer?.userIds ?? null,
                answerCount: showResults ? answers.length : null,
                options: showResults
                  ? participants.map((participant) => {
                      const votes = answers.filter((answer) =>
                        answer.userIds?.includes(participant.user_id),
                      ).length
                      return {
                        userId: participant.user_id,
                        votes,
                        percentage: answers.length ? Math.round((votes / answers.length) * 100) : 0,
                      }
                    })
                  : null,
              }
            }),
          }
        : null
    return {
      ...state,
      revealed,
      nominations,
      survey,
      responses: state.responses.map((response) =>
        revealed || response.user_id === userId
          ? response
          : { ...response, movie_id: null, title: null },
      ),
    }
  }
  async view(userId: number, week?: string): Promise<RoundView> {
    return this.database.transaction(async (db) => {
      const selectedWeek = week ?? (await this.prepare(db))
      if (week) await this.database.lockGroup(db, this.repository.groupId)
      return this.present(await this.snapshot(selectedWeek, db), userId, db)
    })
  }
  async answerSurvey(userId: number, week: string, action: SurveyAction): Promise<RoundView> {
    return this.database.transaction(async (db) => {
      await this.database.lockGroup(db, this.repository.groupId)
      const state = await this.snapshot(week, db)
      if (!state.winner || !state.survey_enabled) throw new RoundNotReadyException()
      const view = await this.present(state, userId, db)
      const participants = await this.repository.survey(week, db)
      const own = participants.find((participant) => participant.user_id === userId)
      if (!own) throw new ForbiddenException()
      if (own.completed_at) throw new RoundLockedException()
      const answers: SurveyAnswer[] = [...own.answers]
      let completedAt: Date | null = null
      if ('movieId' in action) {
        if (
          !view.nominations.some((nomination) => nomination.movieId === action.movieId) ||
          (action.userIds !== null &&
            (!action.userIds.length ||
              new Set(action.userIds).size !== action.userIds.length ||
              action.userIds.some(
                (id) => !participants.some((participant) => participant.user_id === id),
              )))
        )
          throw new ValidationException()
        if (answers.some((answer) => answer.movieId === action.movieId))
          throw new RoundLockedException()
        answers.push(action)
      } else {
        if (
          'finish' in action &&
          view.nominations.some(
            (nomination) => !answers.some((answer) => answer.movieId === nomination.movieId),
          )
        )
          throw new ValidationException()
        completedAt = this.clock.now()
      }
      await this.repository.saveSurvey(week, userId, answers, completedAt, db)
      return this.present(state, userId, db)
    })
  }
  async respond(
    userId: number,
    week: string,
    movieId: number | null,
    tmdbId?: number,
    language: Language = 'en',
  ): Promise<RoundState> {
    const metadata = tmdbId === undefined ? undefined : await this.tmdb.details(tmdbId, language)
    return this.database.transaction(async (db) => {
      await this.prepare(db, week)
      const state: RoundState = await this.snapshot(week, db)
      if (!state.members.some((member) => member.id === userId)) throw new ForbiddenException()
      if (state.status !== 'collecting') throw new RoundLockedException()
      if (metadata) {
        let movie = await this.movies.findTmdb(metadata.tmdb_id, db)
        if (movie && (!movie.eligible || movie.approval_status === 'rejected'))
          throw new MovieNotEligibleException()
        if (!movie)
          movie = await this.movies.create(
            {
              ...metadata,
              submitted_by: userId,
              approval_status: 'approved',
            },
            db,
          )
        else if (movie.approval_status === 'pending')
          movie = await this.movies.update(movie.id, { approval_status: 'approved' }, db)
        movieId = movie.id
      }
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
      if (!(await this.repository.isMember(userId, db))) throw new ForbiddenException()
      if (state.winner) return state
      // Commit invalidation before reporting that replacement nominations are needed.
      if (state.status !== 'ready')
        return state.status === 'skipped'
          ? new NoNominationsException()
          : new RoundNotReadyException()
      const entries: RoundResponse[] = state.responses.filter((r) => r.movie_id !== null)
      const winner: number = entries[this.lottery.index(entries.length)]!.movie_id!
      await this.repository.setWinner(week, winner, userId, this.clock.now(), db)
      if (state.survey_enabled)
        await this.repository.startSurvey(
          week,
          state.members.map((member) => member.id),
          db,
        )
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
