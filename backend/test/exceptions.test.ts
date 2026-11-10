import { test } from 'node:test'
import assert from 'node:assert/strict'
import { ExceptionService } from '../src/shared/exception.service.js'
import {
  MovieNotFoundException,
  InvalidCredentialsException,
} from '../src/shared/exceptions/index.js'

test('exception service preserves typed domain failures without exposing unexpected internals', () => {
  const service = new ExceptionService()
  assert.deepEqual(service.handle(new MovieNotFoundException()), {
    code: 'MOVIE_NOT_FOUND',
    message: 'Movie not found',
    statusCode: 404,
  })
  assert.equal(service.handle(new InvalidCredentialsException()).statusCode, 401)
  assert.deepEqual(service.handle({ type: 'entity.parse.failed' }), {
    code: 'VALIDATION_ERROR',
    message: 'Invalid JSON',
    statusCode: 400,
  })
})
