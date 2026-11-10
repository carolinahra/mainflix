import { AppException } from './app.exception.js'
export class ValidationException extends AppException {
  readonly code = 'VALIDATION_ERROR'
  readonly statusCode = 400
  constructor(message: string = 'Request data is invalid') {
    super(message)
  }
}
