import { after, beforeEach, test } from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { UserService } from '../src/services/user.service.js'
import { UserRepository } from '../src/repositories/user.repository.js'
import { Clock } from '../src/services/clock.js'
import { pool, TestDatabase } from './helpers.js'

beforeEach(() => TestDatabase.reset())
after(() => pool.end())
const password = 'A long test password!'
test('username login is normalized and returns the username in the session', async () => {
  const { auth, user } = await TestDatabase.auth()
  const session = await auth.login(' ADMIN ', password)
  assert.equal(session.user.id, user.id)
  assert.equal(session.user.username, 'admin')
  assert.equal((await auth.user(session.token))?.username, 'admin')
  await assert.rejects(auth.login('admin', 'wrong'), { code: 'INVALID_CREDENTIALS' })
  await assert.rejects(auth.login('unknown', password), { code: 'INVALID_CREDENTIALS' })
})

test('usernames are validated and normalized, and concurrent duplicates are rejected', async () => {
  const { auth } = await TestDatabase.auth()
  for (const username of ['ab', 'a'.repeat(33), 'has space', 'email@example.com', 'usuário'])
    await assert.rejects(auth.create('other@example.com', username, 'Other', password))
  const results = await Promise.allSettled([
    auth.create('one@example.com', ' Movie_Fan ', 'One', password),
    auth.create('two@example.com', 'MOVIE_FAN', 'Two', password),
  ])
  assert.equal(results.filter((result) => result.status === 'fulfilled').length, 1)
  const rejected = results.find((result) => result.status === 'rejected')
  assert.ok(rejected?.status === 'rejected')
  assert.equal(rejected.reason.code, 'USERNAME_EXISTS')
  assert.equal((await auth.login('movie_fan', password)).user.username, 'movie_fan')
})

test('username and email login share the account rate limit', async () => {
  const { auth } = await TestDatabase.auth()
  for (let i = 0; i < 10; i++)
    await assert.rejects(auth.login(i % 2 ? 'ADMIN' : 'admin@example.com', 'wrong'), {
      code: 'INVALID_CREDENTIALS',
    })
  await assert.rejects(auth.login('admin', password), { code: 'RATE_LIMITED' })
  await assert.rejects(auth.login('admin@example.com', password), { code: 'RATE_LIMITED' })
})

test('username migration preserves existing accounts and can run repeatedly', async () => {
  const { auth, user } = await TestDatabase.auth()
  const session = await auth.login(user.email, password)
  await pool.query('ALTER TABLE users DROP COLUMN username')
  await pool.query('DELETE FROM schema_migrations WHERE version = 2')
  const sources = await Promise.all(
    ['001_initial.sql', '002_usernames.sql'].map((file) =>
      readFile(new URL(`../../db/${file}`, import.meta.url), 'utf8'),
    ),
  )
  await TestDatabase.database.migrate(sources)
  await TestDatabase.database.migrate(sources)
  const upgraded = await auth.login('user1', password)
  assert.equal(upgraded.user.id, user.id)
  assert.equal(upgraded.user.email, user.email)
  assert.equal((await auth.user(session.token))?.username, 'user1')
})

test('passwords are salted hashes and only normalized invited accounts can log in', async () => {
  const { auth, user } = await TestDatabase.auth()
  const {
    rows: [saved],
  } = await pool.query('SELECT * FROM users WHERE id=$1', [user.id])
  assert.notEqual(saved.password_hash, password)
  assert.notEqual(await TestDatabase.passwords.hash(password), saved.password_hash)
  const session = await auth.login(' ADMIN@example.com ', password)
  assert.equal((await auth.user(session.token))?.id, user.id)
  assert.equal(session.user.email, 'admin@example.com')
  await assert.rejects(auth.login('admin@example.com', 'wrong'), { code: 'INVALID_CREDENTIALS' })
  await assert.rejects(auth.login('stranger@example.com', password), {
    code: 'INVALID_CREDENTIALS',
  })
  assert.equal(await auth.user('unknown'), null)
  await auth.logout(session.token)
  assert.equal(await auth.user(session.token), null)
})

test('login rotates the current session and session expiry is enforced', async () => {
  let now = new Date('2026-11-09T12:00Z')
  const { auth } = await TestDatabase.auth(() => now)
  const first = await auth.login('admin@example.com', password)
  const second = await auth.login('admin@example.com', password, first.token)
  assert.equal(await auth.user(first.token), null)
  assert.ok(await auth.user(second.token))
  now = new Date('2026-12-10T12:00Z')
  assert.equal(await auth.user(second.token), null)
})

test('reset tokens expire, are single-use under concurrency and revoke existing sessions', async () => {
  let now = new Date('2026-11-09T12:00Z')
  const { auth, user } = await TestDatabase.auth(() => now)
  const session = await auth.login('admin@example.com', password)
  const expired = await auth.issueReset(user.id)
  now = new Date('2026-11-09T12:31Z')
  await assert.rejects(auth.reset(expired.token, 'New long password!'), {
    code: 'INVALID_RESET_TOKEN',
  })
  const reset = await auth.issueReset(user.id)
  const outcomes = await Promise.allSettled([
    auth.reset(reset.token, 'New long password!'),
    auth.reset(reset.token, 'New long password!'),
  ])
  assert.equal(outcomes.filter((r) => r.status === 'fulfilled').length, 1)
  assert.equal(await auth.user(session.token), null)
  await assert.rejects(auth.login('admin@example.com', password), { code: 'INVALID_CREDENTIALS' })
  assert.ok(await auth.login('admin@example.com', 'New long password!'))
})

test('password changes require the old password and revoke sessions/reset links', async () => {
  const { auth, user } = await TestDatabase.auth()
  const session = await auth.login(user.email, password)
  const reset = await auth.issueReset(user.id)
  await assert.rejects(auth.changePassword(user.id, 'wrong', 'Replacement password!'), {
    code: 'INVALID_CREDENTIALS',
  })
  await auth.changePassword(user.id, password, 'Replacement password!')
  assert.equal(await auth.user(session.token), null)
  await assert.rejects(auth.reset(reset.token, password), { code: 'INVALID_RESET_TOKEN' })
})

test('provisioning enforces four accounts and one admin, including concurrent creation', async () => {
  const { auth } = await TestDatabase.auth()
  await assert.rejects(auth.create('other@example.com', 'other', 'Admin', password, true), {
    code: 'ADMIN_EXISTS',
  })
  const results = await Promise.allSettled(
    [2, 3, 4, 5].map((n) =>
      auth.create(`friend${n}@example.com`, `friend${n}`, `Friend ${n}`, password, false),
    ),
  )
  assert.equal(results.filter((r) => r.status === 'fulfilled').length, 3)
  assert.equal(Number((await pool.query('SELECT count(*) FROM users')).rows[0].count), 4)
})

test('DB-backed rate limiting survives separate model instances', async () => {
  const { auth } = await TestDatabase.auth()
  for (let i = 0; i < 10; i++) await auth.attempt('login:person', 10)
  const second = new UserService(
    TestDatabase.database,
    new UserRepository(TestDatabase.database),
    new Clock(),
    TestDatabase.passwords,
  )
  await assert.rejects(second.attempt('login:person', 10), { code: 'RATE_LIMITED' })
})
