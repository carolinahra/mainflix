import { AppException } from './app.exception.js'
export class MovieNotWatchedException extends AppException {
  readonly code = 'MOVIE_NOT_WATCHED'
  readonly statusCode = 409
  constructor(message: string = 'Mark this movie watched before reviewing') {
    super(message)
  }
}
