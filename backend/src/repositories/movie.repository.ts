import { sql, type Insertable, type Updateable } from 'kysely'
import type { Database } from './database.js'
import type { Connection, Schema } from './schema.js'
import type { Movie } from '../models/entities.js'

export class MovieRepository {
  constructor(private readonly database: Database) {}
  async find(id: number, db: Connection = this.database.client): Promise<Movie | undefined> {
    return db.selectFrom('movies').selectAll().where('id', '=', id).executeTakeFirst()
  }
  async findTmdb(id: number, db: Connection = this.database.client): Promise<Movie | undefined> {
    return db.selectFrom('movies').selectAll().where('tmdb_id', '=', id).executeTakeFirst()
  }
  async search(query: string, limit: number, offset: number): Promise<Movie[]> {
    return this.database.client
      .selectFrom('movies')
      .selectAll()
      .where(sql<boolean>`position(lower(${query}) in lower(title)) > 0`)
      .orderBy('title')
      .orderBy('id')
      .limit(limit)
      .offset(offset)
      .execute()
  }
  async pending(limit: number, offset: number): Promise<Movie[]> {
    return this.database.client
      .selectFrom('movies')
      .selectAll()
      .where('approval_status', '=', 'pending')
      .orderBy('id')
      .limit(limit)
      .offset(offset)
      .execute()
  }
  async create(values: Insertable<Schema['movies']>, db: Connection): Promise<Movie> {
    return db.insertInto('movies').values(values).returningAll().executeTakeFirstOrThrow()
  }
  async update(id: number, values: Updateable<Schema['movies']>, db: Connection): Promise<Movie> {
    return db
      .updateTable('movies')
      .set(values)
      .where('id', '=', id)
      .returningAll()
      .executeTakeFirstOrThrow()
  }
  async removePending(id: number, db: Connection): Promise<void> {
    await db
      .deleteFrom('movies')
      .where('id', '=', id)
      .where('approval_status', '=', 'pending')
      .execute()
  }
}
