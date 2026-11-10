import { test } from 'node:test'
import assert from 'node:assert/strict'
import { Container } from '../src/container.js'
import { Clock } from '../src/services/clock.js'

test('container is lazy, caches instances, and accepts typed dependency overrides', async () => {
  // An invalid URL must not be touched merely by constructing the container or reading the clock.
  const container = new Container({
    databaseUrl: 'invalid',
    origin: 'http://localhost:5173',
    secureCookies: false,
    tmdbToken: '',
  })
  assert.equal(container.clock, container.clock)
  assert.equal(container.passwords, container.passwords)
  const clock = new Clock(() => new Date('2026-11-09T12:00Z'))
  container.clock = clock
  assert.equal(container.clock.now().toISOString(), '2026-11-09T12:00:00.000Z')
  assert.equal(container.application, container.application)
  await container.close()
})
