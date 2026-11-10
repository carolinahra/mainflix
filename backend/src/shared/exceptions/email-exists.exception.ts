import { AppException } from './app.exception.js'
export class EmailExistsException extends AppException {
  readonly code = 'EMAIL_EXISTS'
  readonly statusCode = 409
  constructor(message: string = 'An account with this email already exists') {
    super(message)
  }
}
