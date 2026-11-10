import { AppException } from './app.exception.js'
export class InvalidMergeException extends AppException {
  readonly code = 'INVALID_MERGE'
  readonly statusCode = 409
  constructor(message: string = 'Only a pending movie can be merged into another movie') {
    super(message)
  }
}
