import { AppException } from './app.exception.js'
export class InvalidReviewException extends AppException {
  readonly code = 'INVALID_REVIEW'
  readonly statusCode = 400
  constructor(
    message: string = 'Rating must be from 0.5 to 5 in half-point steps and text at most 10000 characters',
  ) {
    super(message)
  }
}
