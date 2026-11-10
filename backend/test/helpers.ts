import pg, { type Pool } from 'pg'
import { readFile } from 'node:fs/promises'
import { Database } from '../src/repositories/database.js'
import { Clock } from '../src/services/clock.js'
import { Lottery } from '../src/services/lottery.js'
import { RoundService } from '../src/services/round.service.js'
import { RoundRepository } from '../src/repositories/round.repository.js'
import { MovieRepository } from '../src/repositories/movie.repository.js'
import { UserRepository } from '../src/repositories/user.repository.js'
import { UserService } from '../src/services/user.service.js'
import { Passwords } from '../src/services/passwords.js'
import type { User, Movie } from '../src/models/entities.js'

export class TestDatabase {
  // Never use DATABASE_URL: avoid resetting a developer's real database.
  static readonly pool: Pool = new pg.Pool({
    connectionString:
      process.env.TEST_DATABASE_URL ?? 'postgres://mainflix:mainflix@localhost:55433/mainflix_test',
    max: 8,
  })
  static readonly database: Database = new Database(TestDatabase.pool)
  static readonly passwords: Passwords = new Passwords()
  static async reset(): Promise<void> {
    const {
      rows: [db],
    } = await this.pool.query<{ name: string }>('select current_database() as name')
    if (!db?.name.endsWith('_test'))
      throw new Error('TEST_DATABASE_URL must point to a database ending in _test')
    await this.database.migrate(
      await Promise.all(
        ['001_initial.sql', '002_usernames.sql'].map((file) =>
          readFile(new URL(`../../db/${file}`, import.meta.url), 'utf8'),
        ),
      ),
    )
    await this.pool.query('TRUNCATE users, movies, rounds, rate_limits RESTART IDENTITY CASCADE')
  }
  static async users(): Promise<User[]> {
    return (
      await this.pool.query<User>(`INSERT INTO users (email,username,password_hash,name,is_admin)
      SELECT 'friend' || n || '@example.com','friend' || n,'unused','Friend ' || n,n=1 FROM generate_series(1,4) n RETURNING id,email,username,name,is_admin`)
    ).rows
  }
  static async movie(title: string = 'Movie', status: string = 'approved'): Promise<Movie> {
    return (
      await this.pool.query<Movie>(
        'INSERT INTO movies (title,approval_status) VALUES ($1,$2) RETURNING *',
        [title, status],
      )
    ).rows[0]!
  }
  static rounds(
    clock: () => Date = (): Date => new Date('2026-11-09T12:00Z'),
    pick?: (size: number) => number,
  ): RoundService {
    return new RoundService(
      this.database,
      new RoundRepository(this.database),
      new MovieRepository(this.database),
      new Clock(clock),
      new Lottery(pick),
    )
  }
  static async auth(
    clock: () => Date = (): Date => new Date(),
  ): Promise<{ auth: UserService; user: User }> {
    const auth: UserService = new UserService(
      this.database,
      new UserRepository(this.database),
      new Clock(clock),
      this.passwords,
    )
    const user: User = await auth.create(
      'Admin@Example.COM',
      'admin',
      'Admin',
      'A long test password!',
      true,
    )
    return { auth, user }
  }
}
export const pool: Pool = TestDatabase.pool
