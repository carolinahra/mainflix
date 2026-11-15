import type { Database } from './database.js'
import type { MovieReviews, ReviewedMovie } from '../models/entities.js'
export class ReviewRepository {
  constructor(private readonly database: Database) {}
  async markWatched(userId: number, movieId: number): Promise<void> {
    await this.database.client
      .insertInto('user_watched_movies')
      .values({ user_id: userId, movie_id: movieId })
      .onConflict((oc) => oc.columns(['user_id', 'movie_id']).doNothing())
      .execute()
  }
  async isWatched(userId: number, movieId: number): Promise<boolean> {
    return !!(await this.database.client
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
    await this.database.client
      .insertInto('reviews')
      .values({ user_id: userId, movie_id: movieId, rating, text, updated_at: now })
      .onConflict((oc) =>
        oc.columns(['user_id', 'movie_id']).doUpdateSet({ rating, text, updated_at: now }),
      )
      .execute()
  }
  async list(movieId: number): Promise<MovieReviews> {
    const reviews = await this.database.client
      .selectFrom('reviews as r')
      .innerJoin('users as u', 'u.id', 'r.user_id')
      .select([
        'r.user_id',
        'r.movie_id',
        'u.name',
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
      .select(['w.user_id', 'u.name', 'w.watched_at'])
      .where('w.movie_id', '=', movieId)
      .orderBy('w.user_id')
      .execute()
    return { reviews, watched }
  }
  async all(limit: number, offset: number): Promise<ReviewedMovie[]> {
    const movies = await this.database.client
      .selectFrom('movies as m')
      .innerJoin('reviews as r', 'r.movie_id', 'm.id')
      .selectAll('m')
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
      .orderBy('r.user_id')
      .execute()
    return movies.map((movie) => ({
      movie,
      reviews: reviews.filter((review) => review.movie_id === movie.id),
    }))
  }
}
