import pg, { type Pool } from 'pg'
import { Kysely, PostgresDialect, sql, type Transaction } from 'kysely'
import type { Schema, Connection } from './schema.js'

export class Database {
  readonly client: Kysely<Schema>
  constructor(readonly pool: Pool) {
    this.client = new Kysely<Schema>({ dialect: new PostgresDialect({ pool }) })
  }
  static connect(connectionString: string): Database {
    const pool: Pool = new pg.Pool({
      connectionString,
      max: 5,
      connectionTimeoutMillis: 10_000,
      idleTimeoutMillis: 10_000,
      statement_timeout: 15_000,
      idle_in_transaction_session_timeout: 15_000,
      allowExitOnIdle: true,
    })
    pool.on('error', (): void => {
      console.error('DATABASE_POOL_ERROR')
    })
    return new Database(pool)
  }
  async transaction<T>(work: (db: Transaction<Schema>) => Promise<T>): Promise<T> {
    return this.client.transaction().execute(work)
  }
  async lockGroup(db: Connection): Promise<void> {
    await sql`SELECT pg_advisory_xact_lock(48151001)`.execute(db)
  }
  async lockUsers(db: Connection): Promise<void> {
    await sql`SELECT pg_advisory_xact_lock(48151003)`.execute(db)
  }
  async migrate(sources: string[]): Promise<void> {
    await this.transaction(async (db: Transaction<Schema>): Promise<void> => {
      await sql`SELECT pg_advisory_xact_lock(48151002)`.execute(db)
      await db.schema
        .createTable('schema_migrations')
        .ifNotExists()
        .addColumn('version', 'integer', (c) => c.primaryKey())
        .addColumn('applied_at', 'timestamptz', (c) => c.defaultTo(sql`now()`))
        .execute()
      for (const [index, source] of sources.entries()) {
        const version: number = index + 1
        if (
          !(await db
            .selectFrom('schema_migrations')
            .select('version')
            .where('version', '=', version)
            .executeTakeFirst())
        ) {
          await sql.raw(source).execute(db)
          await db.insertInto('schema_migrations').values({ version }).execute()
        }
      }
    })
  }
  async close(): Promise<void> {
    await this.client.destroy()
  }
}
