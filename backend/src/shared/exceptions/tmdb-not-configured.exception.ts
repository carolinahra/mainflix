import { AppException } from './app.exception.js'
export class TmdbNotConfiguredException extends AppException {
  readonly code = 'TMDB_NOT_CONFIGURED'
  readonly statusCode = 503
  constructor(message: string = 'External movie search is not configured') {
    super(message)
  }
}
