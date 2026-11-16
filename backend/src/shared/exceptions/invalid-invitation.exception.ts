import { AppException } from './app.exception.js'
export class InvalidInvitationException extends AppException {
  readonly code = 'INVALID_INVITATION'
  readonly statusCode = 400
  constructor() {
    super('This invitation is invalid, expired or already used')
  }
}
