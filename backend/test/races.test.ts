import { test, beforeEach, after } from 'node:test'
import assert from 'node:assert/strict'
import type { PoolClient } from 'pg'
import { TestDatabase } from './helpers.js'
import { Container } from '../src/container.js'
import { Clock } from '../src/services/clock.js'

beforeEach(() => TestDatabase.reset())
after(() => TestDatabase.pool.end())
class LockBarrier {
  private constructor(private readonly client: PoolClient) {}
  static async open(userId?: number): Promise<LockBarrier> {
    const client: PoolClient = await TestDatabase.pool.connect()
    await client.query('BEGIN')
    if (userId) await client.query('SELECT id FROM users WHERE id=$1 FOR UPDATE', [userId])
    else await client.query('SELECT pg_advisory_xact_lock(48151001)')
    return new LockBarrier(client)
  }
  async waiting(count: number): Promise<void> {
    const until: number = Date.now() + 5000
    while (Date.now() < until) {
      const result = await TestDatabase.pool.query<{ count: string }>(
        "SELECT count(*) FROM pg_stat_activity WHERE datname=current_database() AND pid<>pg_backend_pid() AND wait_event_type='Lock'",
      )
      if (Number(result.rows[0]!.count) >= count) return
      await new Promise((resolve) => setTimeout(resolve, 10))
    }
    throw new Error(`Expected ${count} blocked PostgreSQL operations`)
  }
  async release(): Promise<void> {
    await this.client.query('COMMIT')
    this.client.release()
  }
}
class RaceFixture {
  readonly container: Container = new Container({
    databaseUrl: 'unused',
    origin: 'http://localhost:5173',
    secureCookies: false,
    tmdbToken: '',
  })
  constructor() {
    this.container.database = TestDatabase.database
    this.container.clock = new Clock(() => new Date('2026-11-09T12:00Z'))
  }
  async round(): Promise<{ week: string; movieId: number; userId: number }> {
    const users = await TestDatabase.users()
    const movie = await TestDatabase.movie()
    const { week } = await this.container.roundService.current()
    for (const user of users) await this.container.roundService.respond(user.id, week, movie.id)
    return { week, movieId: movie.id, userId: users[0]!.id }
  }
}

test('queued admin exclusion before draw invalidates nominations and prevents selection', async () => {
  const f = new RaceFixture()
  const { week, movieId, userId } = await f.round()
  const barrier = await LockBarrier.open()
  let update: Promise<unknown> | undefined
  let draw: Promise<unknown> | undefined
  try {
    update = f.container.movieService.update(userId, movieId, { eligible: false })
    await barrier.waiting(1)
    draw = f.container.roundService.draw(userId, week).catch((error: unknown) => error)
    await barrier.waiting(2)
  } finally {
    await barrier.release()
  }
  await update
  const result: unknown = await draw
  assert.ok(result instanceof Error && 'code' in result && result.code === 'ROUND_NOT_READY')
  assert.equal((await f.container.roundService.current()).winner, null)
})

test('queued draw before admin restoration preserves the winner and allows explicit future eligibility', async () => {
  const f = new RaceFixture()
  const { week, movieId, userId } = await f.round()
  const barrier = await LockBarrier.open()
  let draw: Promise<unknown> | undefined
  let update: Promise<unknown> | undefined
  try {
    draw = f.container.roundService.draw(userId, week)
    await barrier.waiting(1)
    update = f.container.movieService.update(userId, movieId, { eligible: true })
    await barrier.waiting(2)
  } finally {
    await barrier.release()
  }
  await Promise.all([draw, update])
  assert.equal((await f.container.roundService.current()).winner!.id, movieId)
  assert.equal((await f.container.movieService.find(movieId)).eligible, true)
})

test('queued login before reset cannot leave an old-password session alive', async () => {
  const { auth, user } = await TestDatabase.auth()
  const reset = await auth.issueReset(user.id)
  const barrier = await LockBarrier.open(user.id)
  let login: ReturnType<typeof auth.login> | undefined
  let redeem: Promise<void> | undefined
  try {
    login = auth.login(user.email, 'A long test password!')
    await barrier.waiting(1)
    redeem = auth.reset(reset.token, 'Replacement password!')
    await barrier.waiting(2)
  } finally {
    await barrier.release()
  }
  const session = await login
  await redeem
  assert.equal(await auth.user(session!.token), null)
})

test('queued reset before login makes the old password fail under concurrent requests', async () => {
  const { auth, user } = await TestDatabase.auth()
  const reset = await auth.issueReset(user.id)
  const barrier = await LockBarrier.open(user.id)
  let redeem: Promise<void> | undefined
  let login: Promise<unknown> | undefined
  try {
    redeem = auth.reset(reset.token, 'Replacement password!')
    await barrier.waiting(1)
    login = auth.login(user.email, 'A long test password!').catch((error: unknown) => error)
    await barrier.waiting(2)
  } finally {
    await barrier.release()
  }
  await redeem
  const result: unknown = await login
  assert.ok(result instanceof Error && 'code' in result && result.code === 'INVALID_CREDENTIALS')
})
