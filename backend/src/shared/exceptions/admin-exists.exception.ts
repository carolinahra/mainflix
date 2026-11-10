import { AppException } from './app.exception.js'
export class AdminExistsException extends AppException {
  readonly code = 'ADMIN_EXISTS'
  readonly statusCode = 409
  constructor(message: string = 'An administrator already exists') {
    super(message)
  }
}
