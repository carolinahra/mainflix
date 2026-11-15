import { after, beforeEach, test } from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
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

test('recently added orders by creation date with stable pagination even without TMDB', async () => {
  const first = await TestDatabase.movie('Z first')
  const latest = await TestDatabase.movie('A latest')
  const movies = new MovieService(
    TestDatabase.database,
    new MovieRepository(TestDatabase.database),
    new RoundRepository(TestDatabase.database),
    new Tmdb(''),
    new Clock(),
  )
  const result = await movies.browse('recentlyAdded', 'es', 1)
  assert.deepEqual(
    result.local.map((movie) => movie.id),
    [latest.id, first.id],
  )
  assert.equal(result.remoteError, null)
  assert.deepEqual(result.remote, [])
  for (let n = 0; n < 19; n++) await TestDatabase.movie(`More film ${n}`)
  const page1 = await movies.browse('recentlyAdded', 'es', 1)
  const page2 = await movies.browse('recentlyAdded', 'es', 2)
  assert.equal(page1.local.length, 20)
  assert.equal(page1.totalPages, 2)
  assert.deepEqual(
    page2.local.map((movie) => movie.id),
    [first.id],
  )
  assert.equal(page2.totalPages, 2)
})

test('discovery includes local matches so existing movies keep approval and nomination behavior', async () => {
  const existing = await TestDatabase.movie('Interstellar')
  await pool.query('UPDATE movies SET tmdb_id=157336 WHERE id=$1', [existing.id])
  const movies = new MovieService(
    TestDatabase.database,
    new MovieRepository(TestDatabase.database),
    new RoundRepository(TestDatabase.database),
    new Tmdb('test', async () =>
      Response.json({ results: [{ id: 157336, title: 'Interstellar' }], total_pages: 2 }),
    ),
    new Clock(),
  )
  const result = await movies.browse('scienceFiction', 'es', 1)
  assert.equal(result.local[0]?.id, existing.id)
  assert.equal(result.remote[0]?.tmdb_id, 157336)
  assert.equal(result.totalPages, 2)
  const unavailable = new MovieService(
    TestDatabase.database,
    new MovieRepository(TestDatabase.database),
    new RoundRepository(TestDatabase.database),
    new Tmdb(''),
    new Clock(),
  )
  assert.equal((await unavailable.browse('popular', 'es', 1)).remoteError, 'TMDB_NOT_CONFIGURED')
})

test('TMDB imports are immediately nominatable and concurrent duplicates share one catalogue record', async () => {
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
  assert.equal(results[0]!.approval_status, 'approved')
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
  await rounds.respond(friends[0]!.id, week, a.id)
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
  const pending = await TestDatabase.movie('Alternate title', 'pending')
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

test('half-point migration preserves existing reviews and runs repeatedly', async () => {
  const [user] = await TestDatabase.users()
  const movie = await TestDatabase.movie()
  await pool.query(`ALTER TABLE reviews DROP CONSTRAINT reviews_rating_check,
    ALTER COLUMN rating TYPE integer,
    ADD CONSTRAINT reviews_rating_check CHECK (rating BETWEEN 1 AND 5)`)
  await pool.query('DELETE FROM schema_migrations WHERE version=4')
  await pool.query('INSERT INTO user_watched_movies (user_id,movie_id) VALUES ($1,$2)', [
    user!.id,
    movie.id,
  ])
  await pool.query('INSERT INTO reviews (user_id,movie_id,rating,text) VALUES ($1,$2,3,$3)', [
    user!.id,
    movie.id,
    'Keep this review',
  ])
  const sources = await Promise.all(
    [
      '001_initial.sql',
      '002_usernames.sql',
      '003_optional_email.sql',
      '004_half_point_reviews.sql',
    ].map((file) => readFile(new URL(`../../db/${file}`, import.meta.url), 'utf8')),
  )
  await TestDatabase.database.migrate(sources)
  await TestDatabase.database.migrate(sources)
  const { rows } = await pool.query('SELECT rating,text FROM reviews WHERE movie_id=$1', [movie.id])
  assert.deepEqual(rows, [{ rating: 3, text: 'Keep this review' }])
  await pool.query('UPDATE reviews SET rating=3.5 WHERE movie_id=$1', [movie.id])
})

test('reviews persist half-point ratings and reject values outside the half-point scale', async () => {
  const [user] = await TestDatabase.users()
  const movie = await TestDatabase.movie()
  const reviews = new ReviewService(
    new ReviewRepository(TestDatabase.database),
    new MovieRepository(TestDatabase.database),
    new Clock(),
  )
  await reviews.markWatched(user!.id, movie.id)
  for (const rating of [0.5, 3.5, 5]) {
    await reviews.save(user!.id, movie.id, rating, 'Diamond review')
    assert.equal((await reviews.list(movie.id)).reviews[0]!.rating, rating)
  }
  for (const rating of [0, 0.25, 3.7, 5.5, NaN, Infinity])
    await assert.rejects(reviews.save(user!.id, movie.id, rating, ''), { code: 'INVALID_REVIEW' })
  for (const rating of [0, 0.25, 5.5])
    await assert.rejects(
      pool.query('UPDATE reviews SET rating=$1 WHERE user_id=$2 AND movie_id=$3', [
        rating,
        user!.id,
        movie.id,
      ]),
      { code: '23514' },
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
