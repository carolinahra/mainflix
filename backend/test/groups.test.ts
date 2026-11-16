import { beforeEach, after, test } from 'node:test'
import assert from 'node:assert/strict'
import request from 'supertest'
import { Container } from '../src/container.js'
import { Clock } from '../src/services/clock.js'
import { TestDatabase } from './helpers.js'

beforeEach(() => TestDatabase.reset())
after(() => TestDatabase.pool.end())
class GroupsFixture {
  readonly container = new Container({
    databaseUrl: 'unused',
    origin: 'http://localhost:5173',
    secureCookies: false,
    tmdbToken: '',
  })
  now = new Date('2026-11-16T12:00Z')
  constructor() {
    this.container.database = TestDatabase.database
    this.container.clock = new Clock(() => this.now)
  }
  async login(username: string): Promise<string> {
    const result = await this.call('post', '/auth/login', undefined, undefined, {
      identifier: username,
      password: 'abcdef',
    }).expect(200)
    return result.headers['set-cookie']![0]!.split(';')[0]!
  }
  call(
    method: 'get' | 'post' | 'put' | 'patch',
    path: string,
    cookie?: string,
    groupId?: number,
    body?: object,
  ) {
    const req = request(this.container.application.app)
      [method](`/api${path}`)
      .set('Origin', this.container.config.origin)
    if (cookie) req.set('Cookie', cookie)
    if (groupId) req.set('X-Mainflix-Group', String(groupId))
    return body ? req.send(body) : req
  }
  async owner() {
    const user = await this.container.userService.create(null, 'owner', 'Owner', 'abcdef')
    const cookie = await this.login('owner')
    const group = (
      await this.call('post', '/groups', cookie, undefined, { name: 'Family' }).expect(201)
    ).body
    return { user, cookie, group }
  }
}

test('named groups and app-only signup keep a new account out of the inviter groups', async () => {
  const f = new GroupsFixture()
  const { cookie, group } = await f.owner()
  assert.equal(group.name, 'Family')
  await f.call('post', '/groups', cookie, undefined, { name: '  ' }).expect(400)
  const invitation = (await f.call('post', '/invitations', cookie, undefined, {}).expect(201)).body
  const token = invitation.url.split('#invite=')[1]
  assert.equal((await f.call('get', `/invitations/${token}`).expect(200)).body.groupName, null)
  await f
    .call('post', '/auth/register', undefined, undefined, {
      token,
      username: 'new_friend',
      password: 'abcdef',
    })
    .expect(201)
  const newcomer = await f.login('new_friend')
  assert.deepEqual((await f.call('get', '/groups', newcomer).expect(200)).body, [])
  assert.deepEqual((await f.call('get', '/auth/favorites', newcomer).expect(200)).body, [])
  assert.deepEqual((await f.call('get', '/auth/reviews', newcomer).expect(200)).body, [])
  await f.call('get', '/rounds/current', newcomer, group.id).expect(403)
  await f
    .call('post', '/auth/register', undefined, undefined, {
      token,
      username: 'second_friend',
      password: 'abcdef',
    })
    .expect(400)
  const own = (
    await f.call('post', '/groups', newcomer, undefined, { name: 'Friends' }).expect(201)
  ).body
  assert.equal(own.name, 'Friends')
})

test('group invites are owner-only, expire, are consumed once, and support existing accounts', async () => {
  const f = new GroupsFixture()
  const { cookie, group } = await f.owner()
  await f.container.userService.create(null, 'guest', 'Guest', 'abcdef')
  const guest = await f.login('guest')
  await f.call('post', '/invitations', guest, undefined, { groupId: group.id }).expect(403)
  const invite = (
    await f.call('post', '/invitations', cookie, undefined, { groupId: group.id }).expect(201)
  ).body
  const token = invite.url.split('#invite=')[1]
  const preview = (await f.call('get', `/invitations/${token}`).expect(200)).body
  assert.equal(preview.groupName, 'Family')
  const results = await Promise.all(
    [1, 2].map(() => f.call('post', `/invitations/${token}/accept`, guest, undefined, {})),
  )
  assert.deepEqual(results.map((r) => r.status).sort(), [200, 400])
  assert.ok(
    (await f.call('get', '/groups', guest)).body.some((g: { id: number }) => g.id === group.id),
  )
  const expired = (
    await f.call('post', '/invitations', cookie, undefined, { groupId: group.id }).expect(201)
  ).body.url.split('#invite=')[1]
  f.now = new Date('2026-11-24T12:00Z')
  await f.call('get', `/invitations/${expired}`).expect(400)
})

test('groups isolate catalogues, reviews, nominations and draws; owners can vote', async () => {
  const f = new GroupsFixture()
  const { cookie, group } = await f.owner()
  const other = (
    await f.call('post', '/groups', cookie, undefined, { name: 'Friends' }).expect(201)
  ).body
  const movie = (
    await f.call('post', '/movies', cookie, group.id, { title: 'Family movie' }).expect(201)
  ).body
  assert.deepEqual((await f.call('get', '/movies', cookie, other.id).expect(200)).body.local, [])
  await f.call('get', `/movies/${movie.id}`, cookie, other.id).expect(404)
  await f.call('put', `/movies/${movie.id}/review`, cookie, other.id, { rating: 4 }).expect(404)
  await f
    .call('patch', `/admin/movies/${movie.id}`, cookie, other.id, { eligible: false })
    .expect(404)
  const current = (await f.call('get', '/rounds/current', cookie, group.id).expect(200)).body
  assert.equal(current.members.length, 1)
  const ready = await f
    .call('put', `/rounds/${current.week}/response`, cookie, group.id, { movieId: movie.id })
    .expect(200)
  assert.equal(ready.body.status, 'ready')
  const drawn = await f
    .call('post', `/rounds/${current.week}/draw`, cookie, group.id, {})
    .expect(200)
  assert.equal(drawn.body.winner_id, movie.id)
  assert.equal((await f.call('get', '/rounds/current', cookie, other.id)).body.winner, null)
  await f.call('put', `/movies/${movie.id}/watched`, cookie, group.id, {}).expect(204)
  await f.call('put', `/movies/${movie.id}/review`, cookie, group.id, { rating: 4 }).expect(204)
  assert.deepEqual((await f.call('get', '/movies/reviews', cookie, other.id)).body, [])
  await f.call('post', '/admin/users/1/reset', cookie, group.id, {}).expect(403)
  await f.call('post', '/admin/USERS/1/reset', cookie, group.id, {}).expect(403)
  await f.call('get', '/admin/USERS', cookie, group.id).expect(403)
})

test('joining after the first response defers voting until the next Madrid week', async () => {
  const f = new GroupsFixture()
  const { cookie, group } = await f.owner()
  await f.container.userService.create(null, 'joining', 'Joining', 'abcdef')
  const guest = await f.login('joining')
  const movie = (await f.call('post', '/movies', cookie, group.id, { title: 'Movie' })).body
  const week = '2026-11-16'
  await f
    .call('put', `/rounds/${week}/response`, cookie, group.id, { movieId: movie.id })
    .expect(200)
  // Removing all nominations must not reopen this week's electorate.
  await f
    .call('patch', `/admin/movies/${movie.id}`, cookie, group.id, { eligible: false })
    .expect(200)
  const invite = (
    await f.call('post', '/invitations', cookie, undefined, { groupId: group.id })
  ).body.url.split('#invite=')[1]
  await f.call('post', `/invitations/${invite}/accept`, guest, undefined, {}).expect(200)
  const groups = (await f.call('get', '/groups', guest)).body
  assert.equal(groups.find((g: { id: number }) => g.id === group.id).can_vote, false)
  await f.call('put', `/rounds/${week}/response`, guest, group.id, { movieId: null }).expect(403)
  assert.equal((await f.call('get', '/rounds/current', cookie, group.id)).body.members.length, 1)
  f.now = new Date('2026-11-23T12:00Z')
  assert.equal((await f.call('get', '/rounds/current', guest, group.id)).body.members.length, 2)
})

test('failed signup preserves its invitation and successful concurrent signup creates one account', async () => {
  const f = new GroupsFixture()
  const { cookie, group } = await f.owner()
  const token = (
    await f.call('post', '/invitations', cookie, undefined, { groupId: group.id })
  ).body.url.split('#invite=')[1]
  await f
    .call('post', '/auth/register', undefined, undefined, {
      token,
      username: 'owner',
      password: 'abcdef',
    })
    .expect(409)
  await f.call('get', `/invitations/${token}`).expect(200)
  const results = await Promise.all(
    ['signup_one', 'signup_two'].map((username) =>
      f.call('post', '/auth/register', undefined, undefined, {
        token,
        username,
        password: 'abcdef',
      }),
    ),
  )
  assert.deepEqual(results.map((r) => r.status).sort(), [201, 400])
  const winner = results.find((r) => r.status === 201)!
  const memberCookie = winner.headers['set-cookie']![0]!.split(';')[0]!
  assert.deepEqual(
    (await f.call('get', '/groups', memberCookie).expect(200)).body.map(
      (g: { id: number }) => g.id,
    ),
    [group.id],
  )
  assert.equal((await f.call('get', '/rounds/current', cookie, group.id)).body.members.length, 2)
})

test('personal favorites and own reviews span groups without exposing other users activity', async () => {
  const f = new GroupsFixture()
  const { cookie, group } = await f.owner()
  const other = (await f.call('post', '/groups', cookie, undefined, { name: 'Friends' })).body
  const movie = (await f.call('post', '/movies', cookie, group.id, { title: 'Private favorite' }))
    .body
  await f.call('put', `/movies/${movie.id}/favorite`, cookie, group.id, {}).expect(204)
  await f.call('put', `/movies/${movie.id}/watched`, cookie, group.id, {}).expect(204)
  await f
    .call('put', `/movies/${movie.id}/review`, cookie, group.id, {
      rating: 4,
      text: 'Family review',
    })
    .expect(204)
  const favorites = (await f.call('get', '/movies/favorites', cookie, other.id)).body
  assert.equal(favorites[0].id, movie.id)
  assert.equal(favorites[0].group_id, group.id)
  assert.equal(
    (await f.call('get', '/movies/reviews?mine=true', cookie, other.id)).body[0].reviews[0].text,
    'Family review',
  )
  assert.deepEqual((await f.call('get', '/movies/reviews', cookie, other.id)).body, [])
  await f.container.userService.create(null, 'outsider', 'Outsider', 'abcdef')
  const outsider = await f.login('outsider')
  await f.call('get', '/rounds/current', outsider, group.id).expect(403)
  await f.call('get', `/movies/${movie.id}`, outsider, other.id).expect(403)
  await f.call('get', '/movies', cookie, -1).expect(400)
})

test('group migration preserves legacy credentials, sessions, movies, favorites, reviews and rounds', async () => {
  const { readFile } = await import('node:fs/promises')
  const client = await TestDatabase.pool.connect()
  try {
    await client.query('BEGIN')
    await client.query('CREATE SCHEMA groups_migration_test')
    await client.query('SET LOCAL search_path TO groups_migration_test')
    for (const file of [
      '001_initial.sql',
      '002_usernames.sql',
      '003_optional_email.sql',
      '004_half_point_reviews.sql',
      '005_profiles_favorites.sql',
    ])
      await client.query(await readFile(new URL(`../../db/${file}`, import.meta.url), 'utf8'))
    await client.query(
      "INSERT INTO users (username,password_hash,name,is_admin) VALUES ('legacy_admin','existing hash','Admin',true),('legacy_voter','voter hash','Voter',false)",
    )
    await client.query("INSERT INTO sessions VALUES ('existing session',2,'2027-01-01')")
    await client.query(
      "INSERT INTO movies (title,submitted_by,approval_status,eligible) VALUES ('Existing movie',2,'approved',false)",
    )
    await client.query('INSERT INTO favorite_movies (user_id,movie_id) VALUES (2,1)')
    await client.query('INSERT INTO user_watched_movies (user_id,movie_id) VALUES (2,1)')
    await client.query(
      "INSERT INTO reviews (user_id,movie_id,rating,text) VALUES (2,1,4.5,'Existing review')",
    )
    await client.query(
      "INSERT INTO rounds (week_start,winner_id,drawn_by,drawn_at) VALUES ('2026-11-09',1,2,now())",
    )
    await client.query(
      "INSERT INTO round_responses (week_start,user_id,movie_id) VALUES ('2026-11-09',2,1)",
    )
    await client.query(await readFile(new URL('../../db/006_groups.sql', import.meta.url), 'utf8'))
    assert.equal(
      (await client.query('SELECT password_hash FROM users WHERE id=2')).rows[0].password_hash,
      'voter hash',
    )
    assert.equal(
      (await client.query('SELECT token_hash FROM sessions')).rows[0].token_hash,
      'existing session',
    )
    assert.deepEqual((await client.query('SELECT title,eligible,group_id FROM movies')).rows, [
      { title: 'Existing movie', eligible: false, group_id: 1 },
    ])
    assert.equal((await client.query('SELECT owner_id FROM groups')).rows[0].owner_id, 1)
    assert.equal(
      (await client.query('SELECT voting_from FROM group_members WHERE user_id=1')).rows[0]
        .voting_from,
      null,
    )
    assert.notEqual(
      (await client.query('SELECT voting_from FROM group_members WHERE user_id=2')).rows[0]
        .voting_from,
      null,
    )
    assert.equal((await client.query('SELECT group_id,winner_id FROM rounds')).rows[0].winner_id, 1)
    assert.equal((await client.query('SELECT group_id FROM round_responses')).rows[0].group_id, 1)
    assert.equal(
      (await client.query('SELECT rating,text FROM reviews')).rows[0].text,
      'Existing review',
    )
    assert.equal((await client.query('SELECT movie_id FROM favorite_movies')).rows[0].movie_id, 1)
  } finally {
    await client.query('ROLLBACK')
    client.release()
  }
})

test('late joiners enter review completion checks when their voting week begins', async () => {
  const f = new GroupsFixture()
  const { cookie, group } = await f.owner()
  const movie = (await f.call('post', '/movies', cookie, group.id, { title: 'Already reviewed' }))
    .body
  await f
    .call('put', '/rounds/2026-11-16/response', cookie, group.id, { movieId: movie.id })
    .expect(200)
  await f.call('post', '/rounds/2026-11-16/draw', cookie, group.id, {}).expect(200)
  await f.call('put', `/movies/${movie.id}/watched`, cookie, group.id, {}).expect(204)
  await f.call('put', `/movies/${movie.id}/review`, cookie, group.id, { rating: 4 }).expect(204)
  const token = (
    await f.call('post', '/invitations', cookie, undefined, { groupId: group.id })
  ).body.url.split('#invite=')[1]
  await f
    .call('post', '/auth/register', undefined, undefined, {
      token,
      username: 'late_reviewer',
      password: 'abcdef',
    })
    .expect(201)
  assert.deepEqual((await f.call('get', '/movies/to-review', cookie, group.id)).body, [])
  f.now = new Date('2026-11-23T12:00Z')
  assert.equal((await f.call('get', '/movies/to-review', cookie, group.id)).body[0].id, movie.id)
})

test('the same TMDB film can be independently eligible and selected in different groups', async () => {
  const f = new GroupsFixture()
  const { cookie, group } = await f.owner()
  const other = (await f.call('post', '/groups', cookie, undefined, { name: 'Friends' })).body
  const movies = await TestDatabase.database.transaction(async (db) => {
    const family = await f.container
      .forGroup(group.id)
      .movieRepository.create(
        { title: 'Shared film', tmdb_id: 123, approval_status: 'approved' },
        db,
      )
    const friends = await f.container
      .forGroup(other.id)
      .movieRepository.create(
        { title: 'Shared film', tmdb_id: 123, approval_status: 'approved' },
        db,
      )
    return { family, friends }
  })
  await f
    .call('put', '/rounds/2026-11-16/response', cookie, group.id, { movieId: movies.family.id })
    .expect(200)
  await f.call('post', '/rounds/2026-11-16/draw', cookie, group.id, {}).expect(200)
  assert.equal(
    (await f.call('get', `/movies/${movies.family.id}`, cookie, group.id)).body.movie.eligible,
    false,
  )
  assert.equal(
    (await f.call('get', `/movies/${movies.friends.id}`, cookie, other.id)).body.movie.eligible,
    true,
  )
  await f
    .call('put', '/rounds/2026-11-16/response', cookie, other.id, { movieId: movies.family.id })
    .expect(409)
  await f
    .call('put', '/rounds/2026-11-16/response', cookie, other.id, { movieId: movies.friends.id })
    .expect(200)
  assert.equal(
    (await f.call('post', '/rounds/2026-11-16/draw', cookie, other.id, {})).body.winner_id,
    movies.friends.id,
  )
})

test('group names preserve emoji including joined family emoji', async () => {
  const f = new GroupsFixture()
  const { cookie } = await f.owner()
  for (const name of ['🍿 Family', '👨‍👩‍👧‍👦 Friends']) {
    const group = (await f.call('post', '/groups', cookie, undefined, { name }).expect(201)).body
    assert.equal(group.name, name)
    assert.ok(
      (await f.call('get', '/groups', cookie).expect(200)).body.some(
        (item: { name: string }) => item.name === name,
      ),
    )
  }
})
