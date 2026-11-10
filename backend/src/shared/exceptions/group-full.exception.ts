import { AppException } from './app.exception.js'
export class GroupFullException extends AppException {
  readonly code = 'GROUP_FULL'
  readonly statusCode = 409
  constructor(message: string = 'The group already has four accounts') {
    super(message)
  }
}
