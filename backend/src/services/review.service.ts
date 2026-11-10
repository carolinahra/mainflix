import type { ReviewRepository } from '../repositories/review.repository.js'
import type { MovieRepository } from '../repositories/movie.repository.js'
import type { Movie, MovieReviews } from '../models/entities.js'
import type { Clock } from './clock.js'
import {
  MovieNotFoundException,
  MovieNotWatchedException,
  InvalidReviewException,
} from '../shared/exceptions/index.js'
export class ReviewService {
  constructor(
    private readonly repository: ReviewRepository,
    private readonly movies: MovieRepository,
    private readonly clock: Clock,
  ) {}
  async markWatched(userId: number, movieId: number): Promise<void> {
    const movie: Movie | undefined = await this.movies.find(movieId)
    if (!movie || movie.approval_status !== 'approved') throw new MovieNotFoundException()
    await this.repository.markWatched(userId, movieId)
  }
  async save(userId: number, movieId: number, rating: number, text: string): Promise<void> {
    if (!Number.isInteger(rating) || rating < 1 || rating > 5 || text.length > 10000)
      throw new InvalidReviewException()
    if (!(await this.repository.isWatched(userId, movieId))) throw new MovieNotWatchedException()
    await this.repository.save(userId, movieId, rating, text, this.clock.now())
  }
  async list(movieId: number): Promise<MovieReviews> {
    if (!(await this.movies.find(movieId))) throw new MovieNotFoundException()
    return this.repository.list(movieId)
  }
}
