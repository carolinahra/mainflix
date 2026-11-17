import type { ReviewRepository } from '../repositories/review.repository.js'
import type { MovieRepository } from '../repositories/movie.repository.js'
import type { Movie, MovieReviews, ReviewedMovie } from '../models/entities.js'
import type { Clock } from './clock.js'
import { MovieNotFoundException, InvalidReviewException } from '../shared/exceptions/index.js'
export class ReviewService {
  constructor(
    private readonly repository: ReviewRepository,
    private readonly movies: MovieRepository,
    private readonly clock: Clock,
  ) {}
  async markWatched(userId: number, movieId: number, watched = true): Promise<void> {
    const movie: Movie | undefined = await this.movies.find(movieId)
    if (!movie || (watched && movie.approval_status !== 'approved'))
      throw new MovieNotFoundException()
    await this.repository.markWatched(userId, movieId, watched)
  }
  async save(userId: number, movieId: number, rating: number, text: string): Promise<void> {
    if (!Number.isInteger(rating * 2) || rating < 0.5 || rating > 5 || text.length > 10000)
      throw new InvalidReviewException()
    if (!(await this.movies.find(movieId))) throw new MovieNotFoundException()
    await this.repository.save(userId, movieId, rating, text, this.clock.now())
  }
  async list(movieId: number, userId: number): Promise<MovieReviews> {
    if (!(await this.movies.find(movieId))) throw new MovieNotFoundException()
    return this.repository.list(movieId, userId)
  }
  async all(limit: number, offset: number, userId: number, mine = false): Promise<ReviewedMovie[]> {
    return this.repository.all(limit, offset, userId, mine)
  }
  async toReview(): Promise<Movie[]> {
    return this.repository.toReview(this.clock.weekKey())
  }
}
