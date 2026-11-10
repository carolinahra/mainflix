import { AppException } from './app.exception.js'
export class MovieNotEligibleException extends AppException {
  readonly code = 'MOVIE_NOT_ELIGIBLE'
  readonly statusCode = 409
  constructor(message: string = 'Movie must be approved and eligible') {
    super(message)
  }
}
