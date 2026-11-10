import { AppException } from './app.exception.js'
export class InvalidPasswordException extends AppException {
  readonly code = 'INVALID_PASSWORD'
  readonly statusCode = 400
  constructor(message: string = 'Password must contain 12 to 128 characters') {
    super(message)
  }
}
