import { AppException } from './app.exception.js'
export class MovieNotFoundException extends AppException {
  readonly code = 'MOVIE_NOT_FOUND'
  readonly statusCode = 404
  constructor(message: string = 'Movie not found') {
    super(message)
  }
}
