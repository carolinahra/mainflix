import type { Database } from './database.js'
import type { Connection } from './schema.js'
import { MovieNotWatchedException } from '../shared/exceptions/index.js'
import type { Movie, MovieReviews, ReviewedMovie } from '../models/entities.js'
export class ReviewRepository {
  constructor(
    private readonly database: Database,
    readonly groupId: number = 1,
  ) {}
  async toReview(week: string): Promise<Movie[]> {
    return this.database.client
      .selectFrom('movies as m')
      .where('m.group_id', '=', this.groupId)
      .innerJoin('rounds as round', 'round.winner_id', 'm.id')
      .where('round.group_id', '=', this.groupId)
      .selectAll('m')
      .where((eb) =>
        eb.exists(
          eb
            .selectFrom('group_members as member')
            .select('member.user_id')
            .where('member.group_id', '=', this.groupId)
            .where('member.voting_from', '<=', week)
            .where((member) =>
              member.not(
                member.exists(
                  member
                    .selectFrom('reviews as review')
                    .select('review.user_id')
                    .whereRef('review.user_id', '=', 'member.user_id')
                    .whereRef('review.movie_id', '=', 'm.id'),
                ),
              ),
            ),
        ),
      )
      .groupBy('m.id')
      .orderBy((eb) => eb.fn.max('round.week_start'), 'desc')
      .orderBy('m.id', 'desc')
      .execute()
  }
  async markWatched(userId: number, movieId: number, watched = true): Promise<void> {
    if (!watched) {
      await this.database.transaction(async (db) => {
        await this.database.lockGroup(db, this.groupId)
        await db
          .deleteFrom('reviews')
          .where('user_id', '=', userId)
          .where('movie_id', '=', movieId)
          .execute()
        await db
          .deleteFrom('user_watched_movies')
          .where('user_id', '=', userId)
          .where('movie_id', '=', movieId)
          .execute()
      })
      return
    }
    await this.database.client
      .insertInto('user_watched_movies')
      .values({ user_id: userId, movie_id: movieId })
      .onConflict((oc) => oc.columns(['user_id', 'movie_id']).doNothing())
      .execute()
  }
  async isWatched(
    userId: number,
    movieId: number,
    db: Connection = this.database.client,
  ): Promise<boolean> {
    return !!(await db
      .selectFrom('user_watched_movies')
      .select('user_id')
      .where('user_id', '=', userId)
      .where('movie_id', '=', movieId)
      .executeTakeFirst())
  }
  async save(
    userId: number,
    movieId: number,
    rating: number,
    text: string,
    now: Date,
  ): Promise<void> {
    await this.database.transaction(async (db) => {
      await this.database.lockGroup(db, this.groupId)
      if (!(await this.isWatched(userId, movieId, db))) throw new MovieNotWatchedException()
      await db
        .insertInto('reviews')
        .values({ user_id: userId, movie_id: movieId, rating, text, updated_at: now })
        .onConflict((oc) =>
          oc.columns(['user_id', 'movie_id']).doUpdateSet({ rating, text, updated_at: now }),
        )
        .execute()
    })
  }
  async list(movieId: number, userId: number): Promise<MovieReviews> {
    const reviews = await this.database.client
      .selectFrom('reviews as r')
      .innerJoin('users as u', 'u.id', 'r.user_id')
      .select([
        'r.user_id',
        'r.movie_id',
        'u.name',
        'u.avatar',
        'r.rating',
        'r.text',
        'r.created_at',
        'r.updated_at',
      ])
      .where('r.movie_id', '=', movieId)
      .orderBy('r.user_id')
      .execute()
    const watched = await this.database.client
      .selectFrom('user_watched_movies as w')
      .innerJoin('users as u', 'u.id', 'w.user_id')
      .select(['w.user_id', 'u.name', 'u.avatar', 'w.watched_at'])
      .where('w.movie_id', '=', movieId)
      .orderBy('w.user_id')
      .execute()
    const reviewsLocked =
      !reviews.some((review) => review.user_id === userId) &&
      !!(await this.database.client
        .selectFrom('rounds')
        .select('winner_id')
        .where('winner_id', '=', movieId)
        .where('group_id', '=', this.groupId)
        .executeTakeFirst())
    return { reviews: reviewsLocked ? [] : reviews, watched, reviewsLocked }
  }
  async all(limit: number, offset: number, userId: number, mine = false): Promise<ReviewedMovie[]> {
    const movies = await this.database.client
      .selectFrom('movies as m')
      .$if(!mine, (query) => query.where('m.group_id', '=', this.groupId))
      .innerJoin('reviews as r', 'r.movie_id', 'm.id')
      .selectAll('m')
      .select((eb) =>
        eb
          .exists(eb.selectFrom('rounds').select('winner_id').whereRef('winner_id', '=', 'm.id'))
          .as('weekly_selection'),
      )
      .$if(mine, (query) => query.where('r.user_id', '=', userId))
      .groupBy('m.id')
      .orderBy((eb) => eb.fn.max('r.updated_at'), 'desc')
      .orderBy('m.id', 'desc')
      .limit(limit)
      .offset(offset)
      .execute()
    if (!movies.length) return []
    const reviews = await this.database.client
      .selectFrom('reviews as r')
      .innerJoin('users as u', 'u.id', 'r.user_id')
      .select([
        'r.user_id',
        'r.movie_id',
        'u.name',
        'u.avatar',
        'r.rating',
        'r.text',
        'r.created_at',
        'r.updated_at',
      ])
      .where(
        'r.movie_id',
        'in',
        movies.map((movie) => movie.id),
      )
      .$if(mine, (query) => query.where('r.user_id', '=', userId))
      .orderBy('r.user_id')
      .execute()
    return movies.map(({ weekly_selection, ...movie }) => {
      const movieReviews = reviews.filter((review) => review.movie_id === movie.id)
      const reviewsLocked =
        weekly_selection === true && !movieReviews.some((review) => review.user_id === userId)
      return { movie, reviews: reviewsLocked ? [] : movieReviews, reviewsLocked }
    })
  }
}
