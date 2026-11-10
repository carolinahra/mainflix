import { after, beforeEach, test } from 'node:test'
import assert from 'node:assert/strict'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { fileURLToPath } from 'node:url'
import { TestDatabase } from './helpers.js'

beforeEach(() => TestDatabase.reset())
after(() => TestDatabase.pool.end())

test('CLI requires a username, provisions without email, and resets by username', async () => {
  const env = {
    ...process.env,
    DATABASE_URL: TestDatabase.pool.options.connectionString,
    APP_ORIGIN: 'http://localhost:5173',
    NODE_ENV: 'development',
    MAINFLIX_PASSWORD: 'A long test password!',
  }
  const run = (args: string[]) =>
    promisify(execFile)(
      process.execPath,
      ['--import', 'tsx', fileURLToPath(new URL('../src/cli.ts', import.meta.url)), ...args],
      { env },
    )
  await assert.rejects(run(['create-user', '--name', 'Admin', '--admin']))
  const created = await run(['create-user', '--username', 'admin', '--name', 'Admin', '--admin'])
  assert.match(created.stdout, /Created admin/)
  const users = await TestDatabase.database.client.selectFrom('users').select('email').execute()
  assert.equal(users.length, 1)
  assert.equal(users[0]?.email, null)
  const reset = await run(['reset-password', '--username', ' ADMIN '])
  assert.match(reset.stdout, /http:\/\/localhost:5173\/#reset=/)
})
