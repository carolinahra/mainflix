import { AppException } from './app.exception.js'
export class RoundExpiredException extends AppException {
  readonly code = 'ROUND_EXPIRED'
  readonly statusCode = 409
  constructor(message: string = 'This weekly round has expired') {
    super(message)
  }
}
