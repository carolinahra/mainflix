import { AppException } from './app.exception.js'
export class ForbiddenException extends AppException {
  readonly code = 'FORBIDDEN'
  readonly statusCode = 403
  constructor(message: string = 'Permission denied') {
    super(message)
  }
}
