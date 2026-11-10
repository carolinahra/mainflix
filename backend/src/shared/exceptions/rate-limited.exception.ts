import { AppException } from './app.exception.js'
export class RateLimitedException extends AppException {
  readonly code = 'RATE_LIMITED'
  readonly statusCode = 429
  constructor(message: string = 'Too many attempts; try again later') {
    super(message)
  }
}
