import { AppException } from './app.exception.js'
export class InvalidOriginException extends AppException {
  readonly code = 'INVALID_ORIGIN'
  readonly statusCode = 403
  constructor(message: string = 'Request origin is not allowed') {
    super(message)
  }
}
