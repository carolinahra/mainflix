import { AppException } from './app.exception.js'
export class AuthenticationRequiredException extends AppException {
  readonly code = 'AUTHENTICATION_REQUIRED'
  readonly statusCode = 401
  constructor(message: string = 'Please sign in') {
    super(message)
  }
}
