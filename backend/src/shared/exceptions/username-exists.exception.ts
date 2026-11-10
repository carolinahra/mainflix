import { AppException } from './app.exception.js'
export class UsernameExistsException extends AppException {
  readonly code = 'USERNAME_EXISTS'
  readonly statusCode = 409
  constructor(message: string = 'An account with this username already exists') {
    super(message)
  }
}
