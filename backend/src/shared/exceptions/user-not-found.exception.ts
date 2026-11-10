import { AppException } from './app.exception.js'
export class UserNotFoundException extends AppException {
  readonly code = 'USER_NOT_FOUND'
  readonly statusCode = 404
  constructor(message: string = 'User not found') {
    super(message)
  }
}
