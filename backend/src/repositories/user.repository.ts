import { sql } from 'kysely'
import type { Database } from './database.js'
import type { Connection } from './schema.js'
import type { User, StoredUser } from '../models/entities.js'

export class UserRepository {
  constructor(private readonly database: Database) {}
  async list(db: Connection = this.database.client): Promise<User[]> {
    return db
      .selectFrom('users')
      .select(['id', 'email', 'username', 'name', 'is_admin'])
      .orderBy('id')
      .execute()
  }
  async create(
    email: string,
    username: string,
    name: string,
    passwordHash: string,
    admin: boolean,
    db: Connection,
  ): Promise<User> {
    return db
      .insertInto('users')
      .values({ email, username, name, password_hash: passwordHash, is_admin: admin })
      .returning(['id', 'email', 'username', 'name', 'is_admin'])
      .executeTakeFirstOrThrow()
  }
  async byLogin(identifier: string): Promise<StoredUser | undefined> {
    return this.database.client
      .selectFrom('users')
      .selectAll()
      .where((eb) => eb.or([eb('email', '=', identifier), eb('username', '=', identifier)]))
      .executeTakeFirst()
  }
  async lock(id: number, db: Connection): Promise<StoredUser | undefined> {
    return db.selectFrom('users').selectAll().where('id', '=', id).forUpdate().executeTakeFirst()
  }
  async setPassword(id: number, passwordHash: string, db: Connection): Promise<void> {
    await db
      .updateTable('users')
      .set({ password_hash: passwordHash })
      .where('id', '=', id)
      .execute()
  }
  async deleteSession(hash: string, db: Connection = this.database.client): Promise<void> {
    await db.deleteFrom('sessions').where('token_hash', '=', hash).execute()
  }
  async deleteUserSessions(id: number, db: Connection): Promise<void> {
    await db.deleteFrom('sessions').where('user_id', '=', id).execute()
  }
  async createSession(
    hash: string,
    id: number,
    expiresAt: Date,
    now: Date,
    db: Connection,
  ): Promise<void> {
    await db.deleteFrom('sessions').where('expires_at', '<=', now).execute()
    await db
      .insertInto('sessions')
      .values({ token_hash: hash, user_id: id, expires_at: expiresAt })
      .execute()
  }
  async sessionUser(hash: string, now: Date): Promise<User | undefined> {
    return this.database.client
      .selectFrom('sessions as s')
      .innerJoin('users as u', 'u.id', 's.user_id')
      .select(['u.id', 'u.email', 'u.username', 'u.name', 'u.is_admin'])
      .where('s.token_hash', '=', hash)
      .where('s.expires_at', '>', now)
      .executeTakeFirst()
  }
  async deleteResets(id: number, db: Connection): Promise<void> {
    await db.deleteFrom('password_resets').where('user_id', '=', id).execute()
  }
  async createReset(hash: string, id: number, expiresAt: Date, db: Connection): Promise<void> {
    await db
      .insertInto('password_resets')
      .values({ token_hash: hash, user_id: id, expires_at: expiresAt })
      .execute()
  }
  async resetOwner(hash: string): Promise<number | undefined> {
    return (
      await this.database.client
        .selectFrom('password_resets')
        .select('user_id')
        .where('token_hash', '=', hash)
        .executeTakeFirst()
    )?.user_id
  }
  async consumeReset(hash: string, now: Date, db: Connection): Promise<boolean> {
    const result = await db
      .deleteFrom('password_resets')
      .where('token_hash', '=', hash)
      .where('expires_at', '>', now)
      .executeTakeFirst()
    return result.numDeletedRows === 1n
  }
  async attempt(key: string, now: Date): Promise<number> {
    const db: Connection = this.database.client
    await db.deleteFrom('rate_limits').where('expires_at', '<=', now).execute()
    const until: Date = new Date(now.getTime() + 15 * 60_000)
    const row = await db
      .insertInto('rate_limits')
      .values({ key, attempts: 1, expires_at: until })
      .onConflict((oc) =>
        oc.column('key').doUpdateSet({
          attempts: sql<number>`CASE WHEN rate_limits.expires_at <= ${now} THEN 1 ELSE rate_limits.attempts+1 END`,
          expires_at: sql<Date>`CASE WHEN rate_limits.expires_at <= ${now} THEN ${until} ELSE rate_limits.expires_at END`,
        }),
      )
      .returning('attempts')
      .executeTakeFirstOrThrow()
    return row.attempts
  }
}
