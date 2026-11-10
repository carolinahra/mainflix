import { AppException } from './app.exception.js'
export class NoNominationsException extends AppException {
  readonly code = 'NO_NOMINATIONS'
  readonly statusCode = 409
  constructor(message: string = 'There are no nominations to draw') {
    super(message)
  }
}
