import { beforeEach, after, test } from 'node:test'
import assert from 'node:assert/strict'
import request from 'supertest'
import { readFile } from 'node:fs/promises'
import { Container } from '../src/container.js'
import { Clock } from '../src/services/clock.js'
import { Tmdb } from '../src/services/tmdb.js'
import { TestDatabase } from './helpers.js'

beforeEach(() => TestDatabase.reset())
after(() => TestDatabase.pool.end())
class HttpFixture {
  readonly container: Container = new Container({
    databaseUrl: 'unused',
    origin: 'http://localhost:5173',
    secureCookies: false,
    tmdbToken: '',
  })
  constructor() {
    this.container.database = TestDatabase.database
    this.container.clock = new Clock(() => new Date('2026-11-09T12:00Z'))
    this.container.tmdb = new Tmdb('')
  }
  async login(identifier: string, password: string = 'A long test password!'): Promise<string> {
    const response = await request(this.container.application.app)
      .post('/api/auth/login')
      .set('Origin', 'http://localhost:5173')
      .send({ identifier, password })
    assert.equal(response.status, 200)
    const cookies: unknown = response.headers['set-cookie']
    assert.ok(Array.isArray(cookies))
    const first: unknown = cookies[0]
    assert.ok(typeof first === 'string')
    assert.ok(first.includes('HttpOnly'))
    return first.split(';')[0]!
  }
}

test('movie descriptions follow the requested language without overwriting the catalogue synopsis', async () => {
  const f = new HttpFixture()
  await f.container.userService.create(null, 'synopsis', 'Viewer', 'abcdef', true)
  const movie = await TestDatabase.movie('Interstellar')
  await TestDatabase.pool.query('UPDATE movies SET tmdb_id=157336,overview=$2 WHERE id=$1', [
    movie.id,
    'Stored synopsis',
  ])
  f.container.tmdb = new Tmdb('test', async (input) => {
    const url = new URL(String(input))
    assert.equal(url.pathname, '/3/movie/157336')
    return Response.json({
      id: 157336,
      title: 'Interstellar',
      overview:
        url.searchParams.get('language') === 'es-ES'
          ? 'Un equipo de exploradores viaja más allá de nuestra galaxia.'
          : 'A team of explorers travels beyond our galaxy.',
    })
  })
  const cookie = await f.login('synopsis', 'abcdef')
  const detail = (language: string) =>
    request(f.container.application.app)
      .get(`/api/movies/${movie.id}?language=${language}`)
      .set('Cookie', cookie)
  assert.equal(
    (await detail('es').expect(200)).body.movie.overview,
    'Un equipo de exploradores viaja más allá de nuestra galaxia.',
  )
  assert.equal(
    (await detail('en').expect(200)).body.movie.overview,
    'A team of explorers travels beyond our galaxy.',
  )
  await detail('fr').expect(400)
  f.container.tmdb = new Tmdb('')
  assert.equal((await detail('es').expect(200)).body.movie.overview, 'Stored synopsis')
  assert.equal((await f.container.movieService.find(movie.id)).overview, 'Stored synopsis')
})

test('movie availability keeps authentication and group scope and tolerates missing TMDB data', async () => {
  const f = new HttpFixture()
  const owner = await f.container.userService.create(null, 'platforms', 'Owner', 'abcdef', true)
  const movie = await TestDatabase.movie('Spanish streaming movie')
  const manual = await TestDatabase.movie('Manual movie')
  await TestDatabase.pool.query('UPDATE movies SET tmdb_id=1 WHERE id=$1', [movie.id])
  const providers = {
    link: 'https://www.themoviedb.org/movie/1/watch?locale=ES',
    flatrate: [{ provider_id: 8, provider_name: 'Netflix', logo_path: '/netflix.jpg' }],
    rent: [],
  }
  let unavailable = false
  f.container.tmdb = new Tmdb('test', async () => {
    if (unavailable) return new Response('', { status: 503 })
    return Response.json({ id: 1, results: { ES: providers } })
  })
  const app = f.container.application.app
  await request(app).get(`/api/movies/${movie.id}/providers`).expect(401)
  const cookie = await f.login('platforms', 'abcdef')
  const get = (id: number) => request(app).get(`/api/movies/${id}/providers`).set('Cookie', cookie)
  assert.deepEqual((await get(movie.id).expect(200)).body, providers)
  await request(app).get('/api/movies/providers/42').expect(401)
  assert.deepEqual(
    (await request(app).get('/api/movies/providers/42').set('Cookie', cookie).expect(200)).body,
    providers,
  )
  assert.equal(
    (await TestDatabase.pool.query('SELECT count(*) FROM movies WHERE tmdb_id=42')).rows[0].count,
    '0',
  )
  await request(app).get('/api/movies/providers/nope').set('Cookie', cookie).expect(400)
  assert.equal((await get(manual.id).expect(200)).body, null)
  await get(99999).expect(404)
  const group = await f.container.groupService.create(owner.id, 'Other group')
  await request(app)
    .get(`/api/movies/${movie.id}/providers`)
    .set('Cookie', cookie)
    .set('X-Mainflix-Group', String(group.id))
    .expect(404)
  unavailable = true
  assert.equal((await get(movie.id).expect(200)).body, null)
  await request(app).get(`/api/movies/${movie.id}`).set('Cookie', cookie).expect(200)
})

test('weekly reviews stay hidden in details and shared lists until the viewer submits their own', async () => {
  const f = new HttpFixture()
  const app = f.container.application.app
  const author = await f.container.userService.create(null, 'author', 'Author', 'abcdef')
  const viewer = await f.container.userService.create(null, 'viewer', 'Viewer', 'abcdef', true)
  const cookie = await f.login('viewer', 'abcdef')
  const weekly = await TestDatabase.movie('Weekly selection')
  const past = await TestDatabase.movie('Past weekly selection')
  const ordinary = await TestDatabase.movie('Never selected')
  for (const [week, movie] of [
    ['2026-11-09', weekly],
    ['2026-11-02', past],
  ] as const)
    await TestDatabase.pool.query(
      'INSERT INTO rounds (week_start,winner_id,drawn_by,drawn_at) VALUES ($1,$2,$3,now())',
      [week, movie.id, author.id],
    )
  for (const movie of [weekly, past, ordinary]) {
    await f.container.reviewService.markWatched(author.id, movie.id)
    await f.container.reviewService.save(author.id, movie.id, 4.5, 'A friend’s private opinion')
  }
  await TestDatabase.pool.query("UPDATE reviews SET updated_at = '2026-11-08T12:00Z'")
  const get = (path: string) => request(app).get(`/api${path}`).set('Cookie', cookie).expect(200)
  const detail = () => get(`/movies/${weekly.id}`)
  for (const movie of [weekly, past]) {
    const result = (await get(`/movies/${movie.id}`)).body
    assert.deepEqual(result.reviews, [])
    assert.equal(result.reviewsLocked, true)
  }
  assert.equal((await get(`/movies/${ordinary.id}`)).body.reviews[0].rating, 4.5)
  let shared = (await get('/movies/reviews?limit=1')).body[0]
  assert.equal(shared.movie.id, ordinary.id)
  assert.equal(shared.reviews[0].rating, 4.5)
  shared = (await get('/movies/reviews?limit=1&offset=1')).body[0]
  assert.equal(shared.movie.id, past.id)
  assert.deepEqual(shared.reviews, [])
  assert.equal(shared.reviewsLocked, true)
  assert.deepEqual((await get('/movies/reviews?mine=true')).body, [])
  assert.deepEqual((await get('/auth/reviews')).body, [])
  await request(app)
    .put(`/api/movies/${weekly.id}/watched`)
    .set('Cookie', cookie)
    .set('Origin', f.container.config.origin)
    .send({})
    .expect(204)
  assert.deepEqual((await detail()).body.reviews, [])
  await request(app)
    .put(`/api/movies/${weekly.id}/review`)
    .set('Cookie', cookie)
    .set('Origin', f.container.config.origin)
    .send({ rating: 0.5, text: '' })
    .expect(204)
  const unlocked = (await detail()).body
  assert.equal(unlocked.reviewsLocked, false)
  assert.deepEqual(
    unlocked.reviews.map((review: { user_id: number }) => review.user_id),
    [author.id, viewer.id],
  )
  shared = (await get('/movies/reviews?limit=1')).body[0]
  assert.equal(shared.movie.id, weekly.id)
  assert.equal(shared.reviewsLocked, false)
  assert.equal(shared.reviews.length, 2)
  assert.equal((await get(`/movies/${past.id}`)).body.reviewsLocked, true)
  for (const path of ['/movies/reviews?mine=true', '/auth/reviews'])
    assert.deepEqual(
      (await get(path)).body[0].reviews.map((review: { user_id: number }) => review.user_id),
      [viewer.id],
    )
})

test('previous weekly selections stay to be reviewed until every voter rates them', async () => {
  const f = new HttpFixture()
  const app = f.container.application.app
  const admin = await f.container.userService.create(null, 'reviewqueue', 'Admin', 'abcdef', true)
  const voters = await TestDatabase.users()
  const pending = await TestDatabase.movie('Previous weekly movie')
  const completed = await TestDatabase.movie('Fully reviewed weekly movie')
  await TestDatabase.movie('Never selected')
  for (const [week, movie] of [
    ['2026-10-26', pending],
    ['2026-11-02', pending],
    ['2026-10-19', completed],
  ] as const) {
    await TestDatabase.pool.query(
      'INSERT INTO rounds (week_start,winner_id,drawn_by,drawn_at) VALUES ($1,$2,$3,now())',
      [week, movie.id, admin.id],
    )
  }
  for (const user of [admin, ...voters.slice(0, 3)]) {
    await f.container.reviewService.markWatched(user.id, pending.id)
    await f.container.reviewService.save(user.id, pending.id, 4, '')
  }
  for (const user of voters) {
    await f.container.reviewService.markWatched(user.id, completed.id)
    await f.container.reviewService.save(user.id, completed.id, 4, '')
  }
  await request(app).get('/api/movies/to-review').expect(401)
  const cookie = await f.login('reviewqueue', 'abcdef')
  const list = () => request(app).get('/api/movies/to-review').set('Cookie', cookie).expect(200)
  assert.deepEqual(
    (await list()).body.map((movie: { id: number }) => movie.id),
    [pending.id],
  )
  await f.container.roundService.current()
  assert.deepEqual(
    (await list()).body.map((movie: { id: number }) => movie.id),
    [pending.id],
  )
  await f.container.reviewService.markWatched(voters[3]!.id, pending.id)
  await f.container.reviewService.save(voters[3]!.id, pending.id, 0.5, '')
  assert.deepEqual((await list()).body, [])
})

test('unmarking a watched movie removes only the callers review and watching record', async () => {
  const f = new HttpFixture()
  const first = await f.container.userService.create(null, 'unwatch', 'Unwatch', 'abcdef')
  const second = await f.container.userService.create(null, 'otherwatch', 'Other', 'abcdef')
  const movie = await TestDatabase.movie('Unwatch me')
  for (const user of [first, second]) {
    await f.container.reviewService.markWatched(user.id, movie.id)
    await f.container.reviewService.save(user.id, movie.id, 4, 'A review')
  }
  await f.container.movieService.favorite(first.id, movie.id, true)
  const cookie = await f.login('unwatch', 'abcdef')
  const remove = (id: number) =>
    request(f.container.application.app)
      .delete(`/api/movies/${id}/watched`)
      .set('Origin', f.container.config.origin)
      .set('Cookie', cookie)
      .send({})
  await request(f.container.application.app)
    .delete(`/api/movies/${movie.id}/watched`)
    .set('Origin', f.container.config.origin)
    .send({})
    .expect(401)
  await remove(99999).expect(404)
  await remove(movie.id).expect(204)
  await remove(movie.id).expect(204)
  assert.deepEqual(
    (await f.container.reviewService.list(movie.id, second.id)).reviews.map((r) => r.user_id),
    [second.id],
  )
  assert.equal(await f.container.reviewRepository.isWatched(first.id, movie.id), false)
  assert.equal(await f.container.reviewRepository.isWatched(second.id, movie.id), true)
  assert.equal(await f.container.movieService.isFavorite(first.id, movie.id), true)
  await assert.rejects(f.container.reviewService.save(first.id, movie.id, 3, ''), {
    code: 'MOVIE_NOT_WATCHED',
  })
  await f.container.reviewService.markWatched(first.id, movie.id)
  assert.equal(await f.container.reviewRepository.isWatched(first.id, movie.id), true)
})

test('profiles edit only the signed-in user and preserve sessions and username uniqueness', async () => {
  const f = new HttpFixture()
  const app = f.container.application.app
  const user = await f.container.userService.create(null, 'profile', 'Profile', 'abcdef')
  await f.container.userService.create(null, 'taken', 'Taken', 'abcdef')
  const cookie = await f.login('profile', 'abcdef')
  const update = (body: object) =>
    request(app)
      .patch('/api/auth/me')
      .set('Cookie', cookie)
      .set('Origin', 'http://localhost:5173')
      .send(body)
  await request(app)
    .patch('/api/auth/me')
    .set('Origin', 'http://localhost:5173')
    .send({ name: 'No' })
    .expect(401)
  await update({ name: 'New name', username: ' NEW_USER ' }).expect(200)
  const me = await request(app).get('/api/auth/me').set('Cookie', cookie).expect(200)
  assert.equal(me.body.id, user.id)
  assert.equal(me.body.username, 'new_user')
  assert.equal(me.body.name, 'New name')
  await f.login('new_user', 'abcdef')
  await request(app)
    .post('/api/auth/login')
    .set('Origin', 'http://localhost:5173')
    .send({ identifier: 'profile', password: 'abcdef' })
    .expect(401)
  await update({ username: 'taken' }).expect(409)
  const avatar = 'data:image/webp;base64,UklGRiIAAABXRUJQVlA4IBYAAAAwAQCdASoBAAEADsD+JaQAA3AAAAAA'
  await update({ avatar }).expect(200)
  assert.equal((await request(app).get('/api/auth/me').set('Cookie', cookie)).body.avatar, avatar)
  const jpeg = await readFile(new URL('./fixtures/avatar.jpg', import.meta.url))
  const jpegAvatar = `data:image/jpeg;base64,${jpeg.toString('base64')}`
  await update({ avatar: jpegAvatar }).expect(200)
  assert.equal(
    (await request(app).get('/api/auth/me').set('Cookie', cookie)).body.avatar,
    jpegAvatar,
  )
  const oversizedJpeg = Buffer.from(jpeg)
  const frame = oversizedJpeg.indexOf(Buffer.from([0xff, 0xc0]))
  assert.ok(frame > 0)
  oversizedJpeg.writeUInt16BE(256, frame + 7)
  const invalidSegment = Buffer.from(jpeg)
  invalidSegment.writeUInt16BE(0, 4)
  for (const invalid of [oversizedJpeg, invalidSegment, jpeg.subarray(0, jpeg.length - 2)])
    await update({ avatar: `data:image/jpeg;base64,${invalid.toString('base64')}` }).expect(400)
  const oversized = Buffer.from(avatar.split(',')[1]!, 'base64')
  oversized.writeUInt16LE(256, 26)
  await update({ avatar: `data:image/webp;base64,${oversized.toString('base64')}` }).expect(400)
  await update({ avatar: null }).expect(200)
  assert.equal((await request(app).get('/api/auth/me').set('Cookie', cookie)).body.avatar, null)
  for (const body of [
    { name: '' },
    { username: 'x' },
    { is_admin: true },
    { userId: user.id, name: 'Spoof' },
    { avatar: 'https://example.com/avatar.svg' },
    { avatar: 'data:image/webp;base64,AAAA' },
    {},
  ])
    await update(body).expect(400)
  await update({ name: 'Blocked' }).set('Origin', 'https://evil.test').expect(403)
  const other = await f.login('taken', 'abcdef')
  const claims = await Promise.all([
    update({ username: 'contested' }),
    request(app)
      .patch('/api/auth/me')
      .set('Cookie', other)
      .set('Origin', 'http://localhost:5173')
      .send({ username: 'contested' }),
  ])
  assert.deepEqual(claims.map((response) => response.status).sort(), [200, 409])
})

test('favorites and own reviews stay private and favorites never change nominations or eligibility', async () => {
  const f = new HttpFixture()
  const app = f.container.application.app
  const first = await f.container.userService.create(null, 'firstfav', 'First', 'abcdef')
  const second = await f.container.userService.create(null, 'secondfav', 'Second', 'abcdef')
  const cookie = await f.login('firstfav', 'abcdef')
  const other = await f.login('secondfav', 'abcdef')
  const movie = await TestDatabase.movie('Favorite film')
  const favorite = (method: 'put' | 'delete', auth = cookie) =>
    request(app)
      [method](`/api/movies/${movie.id}/favorite`)
      .set('Cookie', auth)
      .set('Origin', 'http://localhost:5173')
      .send({})
  await request(app).get('/api/movies/favorites').expect(401)
  await favorite('put').expect(204)
  await favorite('put').expect(204)
  assert.equal(await f.container.reviewRepository.isWatched(first.id, movie.id), false)
  const mine = await request(app).get('/api/movies/favorites').set('Cookie', cookie).expect(200)
  assert.deepEqual(
    mine.body.map((row: { id: number }) => row.id),
    [movie.id],
  )
  assert.deepEqual(
    (await request(app).get('/api/movies/favorites').set('Cookie', other).expect(200)).body,
    [],
  )
  assert.equal(
    (await request(app).get(`/api/movies/${movie.id}`).set('Cookie', cookie)).body.favorite,
    true,
  )
  for (const user of [first, second]) {
    await f.container.reviewService.markWatched(user.id, movie.id)
    await f.container.reviewService.save(user.id, movie.id, 4.5, user.name)
  }
  const reviews = await request(app)
    .get('/api/movies/reviews?mine=true')
    .set('Cookie', cookie)
    .expect(200)
  assert.deepEqual(
    reviews.body[0].reviews.map((row: { user_id: number }) => row.user_id),
    [first.id],
  )
  assert.equal((await f.container.roundService.current()).responses.length, 0)
  assert.equal((await f.container.movieService.find(movie.id)).eligible, true)
  await favorite('delete').expect(204)
  await favorite('delete').expect(204)
  assert.deepEqual((await request(app).get('/api/movies/favorites').set('Cookie', cookie)).body, [])
})

test('TMDB favorites import once without nominating or restoring rejected movies', async () => {
  const f = new HttpFixture()
  const user = await f.container.userService.create(null, 'tmdbfavorite', 'Favorite', 'abcdef')
  f.container.tmdb = new Tmdb('test', async () => Response.json({ id: 99, title: 'TMDB favorite' }))
  const app = f.container.application.app
  const cookie = await f.login(user.username, 'abcdef')
  const add = () =>
    request(app)
      .post('/api/movies/favorites')
      .set('Cookie', cookie)
      .set('Origin', 'http://localhost:5173')
      .send({ tmdbId: 99 })
  const [a, b] = await Promise.all([add().expect(200), add().expect(200)])
  assert.equal(a.body.id, b.body.id)
  assert.equal((await TestDatabase.pool.query('SELECT count(*) FROM movies')).rows[0].count, '1')
  await TestDatabase.pool.query(
    "UPDATE movies SET eligible=false,approval_status='rejected' WHERE id=$1",
    [a.body.id],
  )
  await add().expect(200)
  assert.equal((await f.container.movieService.find(a.body.id)).eligible, false)
  assert.equal((await f.container.movieService.find(a.body.id)).approval_status, 'rejected')
  assert.equal((await f.container.roundService.current()).responses.length, 0)
})

test('shared reviews require login and paginate movies without splitting their reviews', async () => {
  const f = new HttpFixture()
  const app = f.container.application.app
  await request(app).get('/api/movies/reviews').expect(401)
  const firstUser = await f.container.userService.create(null, 'reviewer', 'Reviewer', 'abcdef')
  const secondUser = await f.container.userService.create(null, 'reader', 'Reader', 'abcdef')
  const cookie = await f.login('reviewer', 'abcdef')
  assert.deepEqual(
    (await request(app).get('/api/movies/reviews').set('Cookie', cookie).expect(200)).body,
    [],
  )
  const first = await TestDatabase.movie('First reviewed')
  const latest = await TestDatabase.movie('Latest reviewed')
  await TestDatabase.movie('No reviews')
  for (const movie of [first, latest]) {
    await f.container.reviewService.markWatched(firstUser.id, movie.id)
    await f.container.reviewService.save(firstUser.id, movie.id, 3.5, '<b>A review</b>')
  }
  await f.container.reviewService.markWatched(secondUser.id, latest.id)
  await f.container.reviewService.save(secondUser.id, latest.id, 5, 'Another review')
  const page1 = await request(app)
    .get('/api/movies/reviews?limit=1')
    .set('Cookie', cookie)
    .expect(200)
  assert.equal(page1.body.length, 1)
  assert.equal(page1.body[0].movie.id, latest.id)
  assert.deepEqual(
    page1.body[0].reviews.map((r: { name: string }) => r.name),
    ['Reviewer', 'Reader'],
  )
  assert.equal(page1.body[0].reviews[0].rating, 3.5)
  assert.equal(page1.body[0].reviews[0].text, '<b>A review</b>')
  const page2 = await request(app)
    .get('/api/movies/reviews?limit=1&offset=1')
    .set('Cookie', cookie)
    .expect(200)
  assert.equal(page2.body[0].movie.id, first.id)
  await request(app).get('/api/movies/reviews?limit=0').set('Cookie', cookie).expect(400)
  await request(app).get('/api/movies/reviews?offset=-1').set('Cookie', cookie).expect(400)
})

test('accepting a TMDB pick nominates atomically and never restores rejected or excluded movies', async () => {
  const f = new HttpFixture()
  const friends = await TestDatabase.users()
  f.container.tmdb = new Tmdb('test', async (input) =>
    Response.json({
      id: Number(new URL(String(input)).pathname.split('/').pop()),
      title: 'Random film',
      release_date: '2014-11-05',
    }),
  )
  const app = f.container.application.app
  const { week } = await f.container.roundService.current()
  // Use a real login so authentication and membership are exercised.
  const user = await f.container.userService.create(null, 'adminrandom', 'Admin', 'abcdef', true)
  const cookie = await f.login(user.username, 'abcdef')
  await TestDatabase.pool.query('UPDATE users SET password_hash=$1 WHERE id=$2', [
    await TestDatabase.passwords.hash('abcdef'),
    friends[0]!.id,
  ])
  const voter = await f.login(friends[0]!.username, 'abcdef')
  const accept = (tmdbId: number, auth = voter, expectedWeek = week) =>
    request(app)
      .put(`/api/rounds/${expectedWeek}/response`)
      .set('Cookie', auth)
      .set('Origin', 'http://localhost:5173')
      .send({ tmdbId })
  await accept(100, cookie).expect(403)
  assert.equal((await TestDatabase.pool.query('SELECT count(*) FROM movies')).rows[0].count, '0')
  const [result] = await Promise.all([accept(100).expect(200), accept(100).expect(200)])
  const movieId = result.body.responses[0].movie_id
  assert.equal((await f.container.movieService.find(movieId)).approval_status, 'approved')
  await accept(100).expect(200)
  assert.equal((await TestDatabase.pool.query('SELECT count(*) FROM movies')).rows[0].count, '1')
  await TestDatabase.pool.query("UPDATE movies SET approval_status='rejected' WHERE id=$1", [
    movieId,
  ])
  await accept(100).expect(409)
  await TestDatabase.pool.query(
    "UPDATE movies SET approval_status='approved',eligible=false WHERE id=$1",
    [movieId],
  )
  await accept(100).expect(409)
  await accept(200, voter, '2026-11-02').expect(409)
  assert.equal((await TestDatabase.pool.query('SELECT count(*) FROM movies')).rows[0].count, '1')
  await TestDatabase.pool.query('UPDATE movies SET eligible=true WHERE id=$1', [movieId])
  for (const friend of friends) await f.container.roundService.respond(friend.id, week, movieId)
  await accept(200).expect(409)
  assert.equal((await TestDatabase.pool.query('SELECT count(*) FROM movies')).rows[0].count, '1')
})

test('browse requires authentication and validates categories and pages before calling TMDB', async () => {
  const f = new HttpFixture()
  const app = f.container.application.app
  await request(app).get('/api/movies/browse?category=popular').expect(401)
  await f.container.userService.create(null, 'browse', 'Browse', 'A long test password!')
  const cookie = await f.login('browse')
  for (const query of [
    'category=unknown',
    'category=popular&page=0',
    'category=popular&page=501',
    'category=popular&page=1.5',
    'category=action&yearFrom=2000&yearTo=1990',
    'category=action&yearFrom=1869',
    'category=action&yearTo=2201',
    'category=action&yearFrom=invalid',
  ])
    await request(app).get(`/api/movies/browse?${query}`).set('Cookie', cookie).expect(400)
  const result = await request(app)
    .get('/api/movies/browse?category=recentlyAdded&language=es')
    .set('Cookie', cookie)
    .expect(200)
  assert.deepEqual(result.body.local, [])
  assert.equal(result.body.page, 1)
  assert.equal(result.body.remoteError, null)
})

test('six-character passwords work for provisioning, login, password changes, and resets', async () => {
  const f = new HttpFixture()
  const user = await f.container.userService.create(null, 'shortpass', 'Short password', 'abcdef')
  const cookie = await f.login('shortpass', 'abcdef')
  const app = f.container.application.app
  await request(app)
    .put('/api/auth/password')
    .set('Cookie', cookie)
    .set('Origin', 'http://localhost:5173')
    .send({ currentPassword: 'abcdef', password: 'abcdefghi' })
    .expect(204)
  await f.login('shortpass', 'abcdefghi')
  const reset = await f.container.userService.issueReset(user.id)
  await request(app)
    .post('/api/auth/reset')
    .set('Origin', 'http://localhost:5173')
    .send({ token: reset.token, password: 'abcde' })
    .expect(400)
  await request(app)
    .post('/api/auth/reset')
    .set('Origin', 'http://localhost:5173')
    .send({ token: reset.token, password: 'ghijkl' })
    .expect(204)
  await f.login('shortpass', 'ghijkl')
})

test('login accepts usernames through the identifier field and validates the request', async () => {
  const f = new HttpFixture()
  await f.container.userService.create(
    'admin@example.com',
    'admin',
    'Admin',
    'A long test password!',
    true,
  )
  const app = f.container.application.app
  const response = await request(app)
    .post('/api/auth/login')
    .set('Origin', 'http://localhost:5173')
    .send({ identifier: ' ADMIN ', password: 'A long test password!' })
    .expect(200)
  assert.equal(response.body.username, 'admin')
  assert.equal(response.body.password_hash, undefined)
  for (const body of [
    { identifier: '', password: 'A long test password!' },
    { identifier: 42, password: 'A long test password!' },
    { identifier: 'admin', email: 'admin@example.com', password: 'A long test password!' },
  ])
    await request(app)
      .post('/api/auth/login')
      .set('Origin', 'http://localhost:5173')
      .send(body)
      .expect(400)
  await request(app)
    .post('/api/auth/login')
    .set('Origin', 'http://localhost:5173')
    .send({ identifier: 'admin@example.com', password: 'A long test password!' })
    .expect(200)
})

test('login sets HttpOnly cookies, rejects CSRF, and logout invalidates the session', async () => {
  const f = new HttpFixture()
  await f.container.userService.create(
    'admin@example.com',
    'admin',
    'Admin',
    'A long test password!',
    true,
  )
  const app = f.container.application.app
  const forbidden = await request(app)
    .post('/api/auth/login')
    .set('Origin', 'https://evil.test')
    .send({ email: 'admin@example.com', password: 'A long test password!' })
  assert.equal(forbidden.status, 403)
  assert.equal(forbidden.body.code, 'INVALID_ORIGIN')
  const cookie = await f.login('ADMIN@example.com')
  const me = await request(app).get('/api/auth/me').set('Cookie', cookie)
  assert.equal(me.body.email, 'admin@example.com')
  assert.equal(me.body.password_hash, undefined)
  const logout = await request(app)
    .post('/api/auth/logout')
    .set('Cookie', cookie)
    .set('Origin', 'http://localhost:5173')
  assert.equal(logout.status, 204)
  assert.equal((await request(app).get('/api/auth/me').set('Cookie', cookie)).status, 401)
})

test('only admins approve movies, reset links use configured origin, and review ownership comes from session', async () => {
  const f = new HttpFixture()
  const admin = await f.container.userService.create(
    'admin@example.com',
    'admin',
    'Admin',
    'A long test password!',
    true,
  )
  const friend = await f.container.userService.create(
    'friend@example.com',
    'friend',
    'Friend',
    'A long test password!',
  )
  const adminCookie = await f.login(admin.username)
  const friendCookie = await f.login(friend.username)
  const a = await TestDatabase.movie()
  const app = f.container.application.app
  const blocked = await request(app)
    .patch(`/api/admin/movies/${a.id}`)
    .set('Cookie', friendCookie)
    .set('Origin', 'http://localhost:5173')
    .send({ eligible: false })
  assert.equal(blocked.status, 403)
  const reset = await request(app)
    .post(`/api/admin/users/${friend.id}/reset`)
    .set('Host', 'evil.test')
    .set('Cookie', adminCookie)
    .set('Origin', 'http://localhost:5173')
  assert.equal(reset.status, 200)
  assert.ok(reset.body.url.startsWith('http://localhost:5173/#reset='))
  await request(app)
    .put(`/api/movies/${a.id}/watched`)
    .set('Cookie', friendCookie)
    .set('Origin', 'http://localhost:5173')
    .send({})
    .expect(204)
  const spoof = await request(app)
    .put(`/api/movies/${a.id}/review`)
    .set('Cookie', friendCookie)
    .set('Origin', 'http://localhost:5173')
    .send({ rating: 5, text: 'Nice', userId: admin.id })
  assert.equal(spoof.status, 400)
  await request(app)
    .put(`/api/movies/${a.id}/review`)
    .set('Cookie', friendCookie)
    .set('Origin', 'http://localhost:5173')
    .send({ rating: 4.5, text: 'Nice' })
    .expect(204)
  const detail = await request(app).get(`/api/movies/${a.id}`).set('Cookie', adminCookie)
  assert.equal(detail.body.reviews[0].user_id, friend.id)
  assert.equal(detail.body.reviews[0].rating, 4.5)
  for (const rating of [0, 0.25, 5.5])
    await request(app)
      .put(`/api/movies/${a.id}/review`)
      .set('Cookie', friendCookie)
      .set('Origin', 'http://localhost:5173')
      .send({ rating, text: '' })
      .expect(400)
})

test('four voting profiles and a separate non-voting admin see the same draw and can review', async () => {
  const f = new HttpFixture()
  await f.container.userService.create(null, 'admin', 'Admin', 'A long test password!', true)
  const adminCookie = await f.login('admin')
  const friends = await Promise.all(
    [1, 2, 3, 4].map((n) =>
      f.container.userService.create(
        `friend${n}@example.com`,
        `friend${n}`,
        `Friend ${n}`,
        'A long test password!',
        false,
      ),
    ),
  )
  const cookies = await Promise.all(friends.map((u) => f.login(u.username)))
  const app = f.container.application.app
  const a = await TestDatabase.movie('A')
  const b = await TestDatabase.movie('B')
  const current = await request(app).get('/api/rounds/current').set('Cookie', cookies[0]!)
  assert.equal(current.body.members.length, 4)
  for (const movieId of [a.id, null])
    await request(app)
      .put(`/api/rounds/${current.body.week}/response`)
      .set('Cookie', adminCookie)
      .set('Origin', 'http://localhost:5173')
      .send({ movieId })
      .expect(403)
  for (const [i, cookie] of cookies.entries())
    await request(app)
      .put(`/api/rounds/${current.body.week}/response`)
      .set('Cookie', cookie)
      .set('Origin', 'http://localhost:5173')
      .send({ movieId: i < 2 ? a.id : b.id })
      .expect(200)
  const draws = await Promise.all(
    [...cookies, adminCookie].map((cookie) =>
      request(app)
        .post(`/api/rounds/${current.body.week}/draw`)
        .set('Cookie', cookie)
        .set('Origin', 'http://localhost:5173'),
    ),
  )
  for (const response of draws) assert.equal(response.status, 200)
  assert.equal(new Set(draws.map((d) => d.body.winner.id)).size, 1)
  const winner = draws[0]!.body.winner
  assert.equal(winner.eligible, false)
  for (const cookie of cookies)
    await request(app)
      .put(`/api/movies/${winner.id}/watched`)
      .set('Cookie', cookie)
      .set('Origin', 'http://localhost:5173')
      .send({})
      .expect(204)
})

test('malformed JSON, IDs, pagination, and unknown fields return stable safe errors', async () => {
  const f = new HttpFixture()
  await f.container.userService.create(
    'admin@example.com',
    'admin',
    'Admin',
    'A long test password!',
    true,
  )
  const cookie = await f.login('admin@example.com')
  const app = f.container.application.app
  for (const path of [
    '/api/movies/not-a-number',
    '/api/movies?limit=-1',
    '/api/rounds?offset=-3',
  ]) {
    const res = await request(app).get(path).set('Cookie', cookie)
    assert.equal(res.status, 400)
    assert.equal(res.body.code, 'VALIDATION_ERROR')
  }
  const bad = await request(app)
    .post('/api/auth/login')
    .set('Origin', 'http://localhost:5173')
    .set('Content-Type', 'application/json')
    .send('{')
  assert.equal(bad.status, 400)
  assert.equal(bad.body.code, 'VALIDATION_ERROR')
})
