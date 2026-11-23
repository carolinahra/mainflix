import { after, beforeEach, test } from 'node:test'
import assert from 'node:assert/strict'
import request from 'supertest'
import { Container } from '../src/container.js'
import { Clock } from '../src/services/clock.js'
import { TestDatabase } from './helpers.js'

beforeEach(() => TestDatabase.reset())
after(() => TestDatabase.pool.end())

class SurveyFixture {
  readonly container = new Container({
    databaseUrl: 'unused',
    origin: 'http://localhost:5173',
    secureCookies: false,
    tmdbToken: '',
  })
  now = new Date('2026-11-09T12:00Z')
  constructor() {
    this.container.database = TestDatabase.database
    this.container.clock = new Clock(() => this.now)
  }
  call(method: 'get' | 'post' | 'put', path: string, cookie: string, body?: object) {
    const req = request(this.container.application.app)
      [method](`/api${path}`)
      .set('Cookie', cookie)
      .set('Origin', this.container.config.origin)
    return body === undefined ? req : req.send(body)
  }
  async prepare(draw = true) {
    const users = []
    const cookies: string[] = []
    for (const username of ['anna', 'bob', 'chris', 'observer']) {
      const user = await this.container.userService.create(
        null,
        username,
        username,
        'abcdef',
        username === 'observer',
      )
      users.push(user)
      const login = await this.call('post', '/auth/login', '', {
        identifier: username,
        password: 'abcdef',
      }).expect(200)
      cookies.push(login.headers['set-cookie']![0]!.split(';')[0]!)
    }
    const a = await TestDatabase.movie('A')
    const b = await TestDatabase.movie('B')
    await TestDatabase.pool.query('UPDATE movies SET submitted_by=$1 WHERE id=$2', [
      users[0]!.id,
      a.id,
    ])
    const { week } = await this.container.roundService.current()
    const path = `/rounds/${week}/survey`
    await this.container.roundService.respond(users[0]!.id, week, a.id)
    await this.container.roundService.respond(users[1]!.id, week, a.id)
    if (draw) {
      await this.container.roundService.respond(users[2]!.id, week, b.id)
      await this.call('post', `/rounds/${week}/draw`, cookies[0]!).expect(200)
    }
    return { users, cookies, a, b, week, path }
  }
}

test('round endpoints hide other nominations and movie submitters until the survey reveals them', async () => {
  const f = new SurveyFixture()
  const { users, cookies, a, b, week } = await f.prepare(false)
  let result = (await f.call('get', '/rounds/current', cookies[0]!).expect(200)).body
  assert.equal(result.revealed, false)
  assert.deepEqual(result.nominations, [])
  assert.equal(
    result.responses.find((r: { user_id: number }) => r.user_id === users[0]!.id).movie_id,
    a.id,
  )
  assert.equal(
    result.responses.find((r: { user_id: number }) => r.user_id === users[1]!.id).movie_id,
    null,
  )
  await f.container.movieService.favorite(users[2]!.id, b.id, true)
  result = (
    await f.call('put', `/rounds/${week}/response`, cookies[2]!, { movieId: b.id }).expect(200)
  ).body
  assert.equal(
    result.responses.find((r: { user_id: number }) => r.user_id === users[0]!.id).movie_id,
    null,
  )
  assert.deepEqual(
    result.nominations.map((n: { movieId: number; count: number }) => [n.movieId, n.count]),
    [
      [a.id, 2],
      [b.id, 1],
    ],
  )
  result = (await f.call('post', `/rounds/${week}/draw`, cookies[2]!).expect(200)).body
  assert.equal(result.revealed, false)
  assert.equal(result.survey.questions.length, 2)
  assert.equal(result.survey.participants.length, 3)
  assert.equal(result.survey.eligible, true)
  assert.equal(result.survey.questions[0].options, null)
  const detail = (await f.call('get', `/movies/${a.id}`, cookies[1]!).expect(200)).body
  assert.equal(detail.movie.submitted_by, null)
  assert.deepEqual((await f.call('get', '/movies?q=A', cookies[1]!).expect(200)).body.local, [])
  const observer = (await f.call('get', '/rounds/current', cookies[3]!).expect(200)).body
  assert.equal(observer.survey.eligible, false)
  assert.ok(observer.responses.every((r: { movie_id: number | null }) => r.movie_id === null))
  const late = await f.container.userService.create(null, 'late', 'Late joiner', 'abcdef')
  await TestDatabase.pool.query(
    "UPDATE group_members SET voting_from='2026-11-16' WHERE user_id=$1",
    [late.id],
  )
  const lateView = await f.container.roundService.view(late.id, week)
  assert.equal(lateView.survey!.eligible, false)
  assert.equal(lateView.survey!.participants.length, 3)
  await assert.rejects(f.container.roundService.answerSurvey(late.id, week, { skip: true }), {
    code: 'FORBIDDEN',
  })
})

test('skipping a nomination still requires finishing or skipping the guessing survey', async () => {
  const f = new SurveyFixture()
  const { users, cookies, week, path } = await f.prepare(false)
  await f.container.roundService.respond(users[2]!.id, week, null)
  await f.call('post', `/rounds/${week}/draw`, cookies[0]!).expect(200)
  for (const index of [0, 1]) {
    const result = await f.call('post', path, cookies[index]!, { skip: true }).expect(200)
    assert.equal(result.body.revealed, false)
  }
  const result = (await f.call('post', path, cookies[2]!, { skip: true }).expect(200)).body
  assert.equal(result.survey.questions.length, 1)
  assert.equal(result.survey.participants.length, 3)
  assert.equal(result.revealed, true)
  assert.equal(result.responses[2].movie_id, null)
})

test('multiple-name guesses show percentages excluding skips and reveal after everyone finishes or skips', async () => {
  const f = new SurveyFixture()
  const { users, cookies, a, b, path, week } = await f.prepare()
  const send = (index: number, body: object) =>
    f.call('post', path, cookies[index]!, body).expect(200)
  await send(0, { movieId: a.id, userIds: [users[0]!.id, users[1]!.id] })
  await send(0, { movieId: b.id, userIds: null })
  await send(0, { finish: true })
  await send(1, { movieId: a.id, userIds: [users[1]!.id] })
  const result = (await send(1, { movieId: b.id, userIds: [users[2]!.id] })).body
  assert.deepEqual(
    result.survey.questions[0].options.map((o: { percentage: number }) => o.percentage),
    [50, 100, 0],
  )
  assert.deepEqual(
    result.survey.questions[1].options.map((o: { percentage: number }) => o.percentage),
    [0, 0, 100],
  )
  assert.equal(result.revealed, false)
  await send(1, { finish: true })
  const revealed = (await send(2, { skip: true })).body
  assert.equal(revealed.revealed, true)
  assert.deepEqual(
    revealed.responses.map((r: { movie_id: number | null }) => r.movie_id),
    [a.id, a.id, b.id],
  )
  assert.equal(
    (await f.call('get', `/rounds/${week}`, cookies[3]!).expect(200)).body.revealed,
    true,
  )
  await f.call('post', path, cookies[0]!, { movieId: a.id, userIds: [users[2]!.id] }).expect(409)
})

test('survey validates membership, lifecycle and answers and survives a new Madrid week', async () => {
  const f = new SurveyFixture()
  const { users, cookies, a, b, week, path } = await f.prepare(false)
  await f.call('post', path, cookies[0]!, { skip: true }).expect(409)
  await f.container.roundService.respond(users[2]!.id, week, b.id)
  await f.call('post', `/rounds/${week}/draw`, cookies[0]!).expect(200)
  for (const body of [
    { movieId: 9999, userIds: [users[0]!.id] },
    { movieId: a.id, userIds: [] },
    { movieId: a.id, userIds: [users[0]!.id, users[0]!.id] },
    { movieId: a.id, userIds: [users[3]!.id] },
    { movieId: a.id, userIds: [9999] },
    { movieId: a.id, userIds: [users[0]!.id], userId: users[1]!.id },
  ])
    await f.call('post', path, cookies[0]!, body).expect(400)
  await f.call('post', path, cookies[3]!, { skip: true }).expect(403)
  await f.call('post', path, cookies[0]!, { finish: true }).expect(400)
  await f.call('post', path, cookies[0]!, { movieId: a.id, userIds: [users[1]!.id] }).expect(200)
  await f.call('post', path, cookies[0]!, { movieId: a.id, userIds: [users[2]!.id] }).expect(409)
  f.now = new Date('2026-11-16T12:00Z')
  const previous = (await f.call('get', `/rounds/${week}`, cookies[0]!).expect(200)).body
  assert.equal(previous.survey.questions[0].answered, true)
  assert.equal(previous.revealed, false)
  await f.call('post', path, cookies[0]!, { skip: true }).expect(200)
  const completed = await Promise.all(
    [1, 2].map((index) => f.call('post', path, cookies[index]!, { skip: true }).expect(200)),
  )
  assert.equal(completed.filter((result) => result.body.revealed).length, 1)
  assert.equal(
    (await f.call('get', `/rounds/${week}`, cookies[0]!).expect(200)).body.revealed,
    true,
  )
  const group = (await f.call('post', '/groups', cookies[0]!, { name: 'Other' }).expect(201)).body
  await f
    .call('get', `/rounds/${week}`, cookies[1]!)
    .set('X-Mainflix-Group', String(group.id))
    .expect(403)
})
