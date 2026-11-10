import { AppException } from './app.exception.js'
export class RoundNotReadyException extends AppException {
  readonly code = 'ROUND_NOT_READY'
  readonly statusCode = 409
  constructor(message: string = 'Everyone must nominate or skip first') {
    super(message)
  }
}
