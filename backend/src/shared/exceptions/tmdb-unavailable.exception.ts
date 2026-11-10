import { AppException } from './app.exception.js'
export class TmdbUnavailableException extends AppException {
  readonly code = 'TMDB_UNAVAILABLE'
  readonly statusCode = 503
  constructor(message: string = 'Movie search is temporarily unavailable') {
    super(message)
  }
}
