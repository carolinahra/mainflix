import { beforeEach, after, test } from 'node:test'
import assert from 'node:assert/strict'
import request from 'supertest'
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
    .send({ rating: 5, text: 'Nice' })
    .expect(204)
  const detail = await request(app).get(`/api/movies/${a.id}`).set('Cookie', adminCookie)
  assert.equal(detail.body.reviews[0].user_id, friend.id)
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
