import { AppException } from './app.exception.js'
export class InvalidResetTokenException extends AppException {
  readonly code = 'INVALID_RESET_TOKEN'
  readonly statusCode = 400
  constructor(message: string = 'Reset link is invalid or expired') {
    super(message)
  }
}
