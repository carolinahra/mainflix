import { AppException } from './app.exception.js'
export class NotFoundException extends AppException {
  readonly code = 'NOT_FOUND'
  readonly statusCode = 404
  constructor(message: string = 'Endpoint not found') {
    super(message)
  }
}
