import { AppException } from './app.exception.js'
export class DuplicateMovieException extends AppException {
  readonly code = 'DUPLICATE_MOVIE'
  readonly statusCode = 409
  constructor(message: string = 'This TMDB movie is already in the catalogue') {
    super(message)
  }
}
