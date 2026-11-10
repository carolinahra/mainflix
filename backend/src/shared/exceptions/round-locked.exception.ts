import { AppException } from './app.exception.js'
export class RoundLockedException extends AppException {
  readonly code = 'ROUND_LOCKED'
  readonly statusCode = 409
  constructor(message: string = 'Nominations are locked') {
    super(message)
  }
}
