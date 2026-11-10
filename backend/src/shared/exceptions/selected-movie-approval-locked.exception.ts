import { AppException } from './app.exception.js'
export class SelectedMovieApprovalLockedException extends AppException {
  readonly code = 'SELECTED_MOVIE_APPROVAL_LOCKED'
  readonly statusCode = 409
  constructor(message: string = 'A selected movie must remain approved') {
    super(message)
  }
}
