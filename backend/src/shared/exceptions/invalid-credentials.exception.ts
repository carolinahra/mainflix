import { AppException } from './app.exception.js'
export class InvalidCredentialsException extends AppException {
  readonly code = 'INVALID_CREDENTIALS'
  readonly statusCode = 401
  constructor(message: string = 'Invalid username, email or password') {
    super(message)
  }
}
