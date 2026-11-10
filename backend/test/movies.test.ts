import { after, beforeEach, test } from 'node:test'
import assert from 'node:assert/strict'
import { MovieService } from '../src/services/movie.service.js'
import { MovieRepository } from '../src/repositories/movie.repository.js'
import { RoundRepository } from '../src/repositories/round.repository.js'
import { ReviewRepository } from '../src/repositories/review.repository.js'
import { Clock } from '../src/services/clock.js'
import { ReviewService } from '../src/services/review.service.js'
import { Tmdb } from '../src/services/tmdb.js'
import { pool, TestDatabase } from './helpers.js'

beforeEach(() => TestDatabase.reset())
after(() => pool.end())
class Upstream {
  static async movie(): Promise<Response> {
    return new Response(
      JSON.stringify({
        id: 157336,
        title: 'Interstellar',
        release_date: '2014-11-05',
        overview: 'Space',
        poster_path: '/poster.jpg',
      }),
    )
  }
}

test('TMDB imports remain pending and concurrent duplicates share one catalogue record', async () => {
  const friends = await TestDatabase.users()
  const movies = new MovieService(
    TestDatabase.database,
    new MovieRepository(TestDatabase.database),
    new RoundRepository(TestDatabase.database),
    new Tmdb('test', Upstream.movie),
    new Clock(() => new Date('2026-11-09T12:00Z')),
  )
  const results = await Promise.all(friends.map((u) => movies.submit(u.id, { tmdbId: 157336 })))
  assert.equal(new Set(results.map((m) => m.id)).size, 1)
  assert.equal(results[0]!.approval_status, 'pending')
  assert.equal(results[0]!.release_year, 2014)
  assert.equal((await pool.query('SELECT count(*) FROM movies')).rows[0].count, '1')
})

test('local search survives TMDB failure and treats SQL punctuation as literal text', async () => {
  await TestDatabase.users()
  const a = await TestDatabase.movie("A friend's 100% movie")
  const movies = new MovieService(
    TestDatabase.database,
    new MovieRepository(TestDatabase.database),
    new RoundRepository(TestDatabase.database),
    new Tmdb('test', async () => new Response('', { status: 503 })),
    new Clock(() => new Date('2026-11-09T12:00Z')),
  )
  const result = await movies.search('100%', 'en', 20, 0)
  assert.equal(result.local[0]!.id, a.id)
  assert.equal(result.remoteError, 'TMDB_UNAVAILABLE')
  assert.equal((await movies.search("' OR 1=1 --", 'en', 20, 0)).local.length, 0)
})

test('admin approval and eligibility changes reopen affected nominations, leaving winners immutable', async () => {
  const friends = await TestDatabase.users()
  const movies = new MovieService(
    TestDatabase.database,
    new MovieRepository(TestDatabase.database),
    new RoundRepository(TestDatabase.database),
    new Tmdb(''),
    new Clock(() => new Date('2026-11-09T12:00Z')),
  )
  const a = await movies.submit(friends[0]!.id, { title: 'Manual film', releaseYear: 2025 })
  const rounds = TestDatabase.rounds()
  const { week } = await rounds.current()
  await assert.rejects(rounds.respond(friends[0]!.id, week, a.id), { code: 'MOVIE_NOT_ELIGIBLE' })
  await movies.update(friends[0]!.id, a.id, { approvalStatus: 'approved', overview: 'Completed' })
  for (const u of friends) await rounds.respond(u.id, week, a.id)
  await movies.update(friends[0]!.id, a.id, { eligible: false })
  assert.equal((await rounds.current()).responses.length, 0)
  await movies.update(friends[0]!.id, a.id, { eligible: true })
  for (const u of friends) await rounds.respond(u.id, week, a.id)
  await rounds.draw(friends[1]!.id, week)
  await movies.update(friends[0]!.id, a.id, { eligible: true })
  assert.equal((await rounds.current()).winner!.id, a.id)
  await assert.rejects(movies.update(friends[0]!.id, a.id, { approvalStatus: 'rejected' }), {
    code: 'SELECTED_MOVIE_APPROVAL_LOCKED',
  })
})

test('pending duplicates can merge into an existing movie without duplicating catalogue entries', async () => {
  const friends = await TestDatabase.users()
  const movies = new MovieService(
    TestDatabase.database,
    new MovieRepository(TestDatabase.database),
    new RoundRepository(TestDatabase.database),
    new Tmdb(''),
    new Clock(() => new Date('2026-11-09T12:00Z')),
  )
  const existing = await TestDatabase.movie('Existing')
  const pending = await movies.submit(friends[0]!.id, {
    title: 'Alternate title',
    releaseYear: 2014,
  })
  assert.equal((await movies.merge(pending.id, existing.id)).id, existing.id)
  assert.equal((await pool.query('SELECT id FROM movies WHERE id=$1', [pending.id])).rowCount, 0)
  await assert.rejects(movies.merge(existing.id, existing.id), { code: 'INVALID_MERGE' })
})

test('reviews require personal viewing and are unique/editable per author, with shared progress', async () => {
  const friends = await TestDatabase.users()
  const a = await TestDatabase.movie()
  const reviews = new ReviewService(
    new ReviewRepository(TestDatabase.database),
    new MovieRepository(TestDatabase.database),
    new Clock(),
  )
  await assert.rejects(reviews.save(friends[0]!.id, a.id, 5, 'Great'), {
    code: 'MOVIE_NOT_WATCHED',
  })
  await reviews.markWatched(friends[0]!.id, a.id)
  await reviews.save(friends[0]!.id, a.id, 5, 'Great')
  await reviews.save(friends[0]!.id, a.id, 3, 'Changed my mind')
  await assert.rejects(reviews.save(friends[1]!.id, a.id, 4, ''), { code: 'MOVIE_NOT_WATCHED' })
  await assert.rejects(reviews.save(friends[0]!.id, a.id, 6, ''), { code: 'INVALID_REVIEW' })
  const detail = await reviews.list(a.id)
  assert.equal(detail.reviews.length, 1)
  assert.equal(detail.reviews[0]!.rating, 3)
  assert.equal(detail.watched.length, 1)
  assert.equal(
    (await pool.query('SELECT eligible FROM movies WHERE id=$1', [a.id])).rows[0].eligible,
    true,
  )
})

test('TMDB rejects malformed upstream metadata instead of persisting it', async () => {
  const tmdb = new Tmdb(
    'test',
    async () =>
      new Response(JSON.stringify({ id: 1, title: 'Bad', poster_path: 'https://evil.test/x' })),
  )
  await assert.rejects(tmdb.details(1), { code: 'TMDB_UNAVAILABLE' })
})

test('attaching an existing TMDB ID returns a typed duplicate exception without changing either movie', async () => {
  const friends = await TestDatabase.users()
  const movies = new MovieService(
    TestDatabase.database,
    new MovieRepository(TestDatabase.database),
    new RoundRepository(TestDatabase.database),
    new Tmdb('test', Upstream.movie),
    new Clock(),
  )
  const existing = await movies.submit(friends[0]!.id, { tmdbId: 157336 })
  const pending = await movies.submit(friends[0]!.id, { title: 'Duplicate submission' })
  await assert.rejects(movies.update(friends[0]!.id, pending.id, { tmdbId: 157336 }), {
    code: 'DUPLICATE_MOVIE',
  })
  assert.equal((await movies.find(existing.id)).tmdb_id, 157336)
  assert.equal((await movies.find(pending.id)).tmdb_id, null)
})
