import { AppException } from './app.exception.js'
export class RoundNotFoundException extends AppException {
  readonly code = 'ROUND_NOT_FOUND'
  readonly statusCode = 404
  constructor(message: string = 'Round not found') {
    super(message)
  }
}
