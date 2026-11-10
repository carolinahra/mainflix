import { ZodError } from 'zod'
import { AppException } from './exceptions/index.js'
export interface ErrorResponse {
  code: string
  message: string
  statusCode: number
}
export class ExceptionService {
  handle(error: unknown): ErrorResponse {
    if (error instanceof AppException)
      return { code: error.code, message: error.message, statusCode: error.statusCode }
    if (error instanceof ZodError)
      return { code: 'VALIDATION_ERROR', message: 'Request data is invalid', statusCode: 400 }
    if (typeof error === 'object' && error !== null && 'type' in error) {
      if (error.type === 'entity.parse.failed')
        return { code: 'VALIDATION_ERROR', message: 'Invalid JSON', statusCode: 400 }
      if (error.type === 'entity.too.large')
        return { code: 'PAYLOAD_TOO_LARGE', message: 'Request body is too large', statusCode: 413 }
    }
    // Avoid logging request data or database error details containing secrets.
    console.error('INTERNAL_ERROR', error instanceof Error ? error.name : 'UnknownError')
    return { code: 'INTERNAL_ERROR', message: 'An unexpected error occurred', statusCode: 500 }
  }
}
