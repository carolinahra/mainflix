import { after, beforeEach, test } from 'node:test'
import assert from 'node:assert/strict'
import { Clock } from '../src/services/clock.js'
import { pool, TestDatabase } from './helpers.js'

beforeEach(() => TestDatabase.reset())
after(() => pool.end())
const monday = () => new Date('2026-11-09T12:00:00Z')

test('the admin cannot vote or skip and old admin responses do not affect the four voters or draw', async () => {
  const friends = await TestDatabase.users()
  const {
    rows: [admin],
  } = await pool.query<{ id: number }>(
    "INSERT INTO users (username,password_hash,name,is_admin) VALUES ('admin','unused','Admin',true) RETURNING id",
  )
  assert.ok(admin)
  const a = await TestDatabase.movie('Voter film')
  const b = await TestDatabase.movie('Admin film')
  const rounds = TestDatabase.rounds(monday, () => 0)
  const { week } = await rounds.current()
  await pool.query('INSERT INTO round_responses (week_start,user_id,movie_id) VALUES ($1,$2,$3)', [
    week,
    admin.id,
    b.id,
  ])
  let state = await rounds.current()
  assert.deepEqual(
    state.members.map((m) => m.id),
    friends.map((u) => u.id),
  )
  assert.equal(state.responses.length, 0)
  for (const movieId of [a.id, null])
    await assert.rejects(rounds.respond(admin.id, week, movieId), { code: 'FORBIDDEN' })
  for (const friend of friends.slice(0, 3)) await rounds.respond(friend.id, week, a.id)
  await assert.rejects(rounds.draw(admin.id, week), { code: 'ROUND_NOT_READY' })
  state = await rounds.respond(friends[3]!.id, week, null)
  assert.equal(state.status, 'ready')
  assert.equal(state.responses.length, 4)
  assert.equal((await rounds.draw(admin.id, week)).winner?.id, a.id)
})

test('Madrid weeks reset at local midnight, including both DST changes', () => {
  for (const [input, expected] of [
    ['2026-11-08T22:59:59Z', '2026-11-02'],
    ['2026-11-08T23:00:00Z', '2026-11-09'],
    ['2026-03-29T21:59:59Z', '2026-03-23'],
    ['2026-03-29T22:00:00Z', '2026-03-30'],
    ['2026-10-25T22:59:59Z', '2026-10-19'],
    ['2026-10-25T23:00:00Z', '2026-10-26'],
  ])
    assert.equal(new Clock().weekKey(new Date(input!)), expected)
})

test('four responses unlock draw, duplicate movie nominations keep separate weight', async () => {
  const friends = await TestDatabase.users()
  const a = await TestDatabase.movie('A')
  const b = await TestDatabase.movie('B')
  // Index 1 must still select A: entries are A, A, B, skip, rather than deduplicated A, B.
  const rounds = TestDatabase.rounds(monday, () => 1)
  let state = await rounds.current()
  assert.deepEqual(
    state.members.map((member) => member.username),
    friends.map((user) => user.username),
  )
  await rounds.respond(friends[0]!.id, state.week, a.id)
  await rounds.respond(friends[1]!.id, state.week, a.id)
  await rounds.respond(friends[2]!.id, state.week, b.id)
  await assert.rejects(rounds.draw(friends[0]!.id, state.week), { code: 'ROUND_NOT_READY' })
  state = await rounds.respond(friends[3]!.id, state.week, null)
  assert.equal(state.status, 'ready')
  await assert.rejects(rounds.respond(friends[0]!.id, state.week, b.id), { code: 'ROUND_LOCKED' })
  const results = await Promise.all(friends.map((u) => rounds.draw(u.id, state.week)))
  assert.deepEqual(
    results.map((r) => r.winner!.id),
    [a.id, a.id, a.id, a.id],
  )
  const {
    rows: [saved],
  } = await pool.query('SELECT eligible FROM movies WHERE id=$1', [a.id])
  assert.equal(saved.eligible, false)
  assert.equal((await rounds.history(20, 0)).length, 1)
})

test('last nomination index has its own chance and personal watched movies stay eligible', async () => {
  const friends = await TestDatabase.users()
  const a = await TestDatabase.movie('A')
  const b = await TestDatabase.movie('B')
  await pool.query('INSERT INTO user_watched_movies (user_id,movie_id) VALUES ($1,$2)', [
    friends[0]!.id,
    b.id,
  ])
  const rounds = TestDatabase.rounds(monday, () => 3)
  const { week } = await rounds.current()
  for (const [i, u] of friends.entries()) await rounds.respond(u.id, week, i === 3 ? b.id : a.id)
  assert.equal((await rounds.draw(friends[0]!.id, week)).winner!.id, b.id)
})

test('all skips close the round and incomplete rounds cannot be drawn after Monday', async () => {
  const friends = await TestDatabase.users()
  let now = monday()
  const rounds = TestDatabase.rounds(() => now)
  const { week } = await rounds.current()
  for (const u of friends) await rounds.respond(u.id, week, null)
  assert.equal((await rounds.current()).status, 'skipped')
  await assert.rejects(rounds.draw(friends[0]!.id, week), { code: 'NO_NOMINATIONS' })
  now = new Date('2026-11-15T23:00:00Z')
  assert.equal((await rounds.current()).week, '2026-11-16')
  await assert.rejects(rounds.draw(friends[0]!.id, week), { code: 'ROUND_EXPIRED' })
  await assert.rejects(rounds.respond(friends[0]!.id, week, null), { code: 'ROUND_EXPIRED' })
})

test('pending, rejected and previously selected movies cannot be nominated', async () => {
  const friends = await TestDatabase.users()
  const pending = await TestDatabase.movie('Pending', 'pending')
  const unavailable = await TestDatabase.movie()
  await pool.query('UPDATE movies SET eligible=false WHERE id=$1', [unavailable.id])
  const rounds = TestDatabase.rounds(monday)
  const { week } = await rounds.current()
  for (const id of [pending.id, unavailable.id, 99999]) {
    await assert.rejects(rounds.respond(friends[0]!.id, week, id), { code: 'MOVIE_NOT_ELIGIBLE' })
  }
})

test('eligibility is rechecked and invalid nominations reopen readiness', async () => {
  const friends = await TestDatabase.users()
  const a = await TestDatabase.movie()
  const rounds = TestDatabase.rounds(monday)
  const { week } = await rounds.current()
  for (const u of friends) await rounds.respond(u.id, week, a.id)
  await pool.query('UPDATE movies SET eligible=false WHERE id=$1', [a.id])
  await assert.rejects(rounds.draw(friends[0]!.id, week), { code: 'ROUND_NOT_READY' })
  const state = await rounds.current()
  assert.equal(state.responses.length, 0)
  assert.equal(state.status, 'collecting')
})
