import { sql, type Insertable, type Updateable } from 'kysely'
import type { Database } from './database.js'
import type { Connection, Schema } from './schema.js'
import type { Movie } from '../models/entities.js'

export class MovieRepository {
  constructor(
    private readonly database: Database,
    readonly groupId: number = 1,
  ) {}
  async find(id: number, db: Connection = this.database.client): Promise<Movie | undefined> {
    return db
      .selectFrom('movies')
      .where('group_id', '=', this.groupId)
      .selectAll()
      .where('id', '=', id)
      .executeTakeFirst()
  }
  async favorites(userId: number, limit: number, offset: number): Promise<Movie[]> {
    return this.database.client
      .selectFrom('favorite_movies as f')
      .innerJoin('movies as m', 'm.id', 'f.movie_id')
      .selectAll('m')
      .where('f.user_id', '=', userId)
      .orderBy('f.created_at', 'desc')
      .orderBy('m.id', 'desc')
      .limit(limit)
      .offset(offset)
      .execute()
  }
  async isFavorite(userId: number, movieId: number): Promise<boolean> {
    return !!(await this.database.client
      .selectFrom('favorite_movies')
      .select('movie_id')
      .where('user_id', '=', userId)
      .where('movie_id', '=', movieId)
      .executeTakeFirst())
  }
  async favorite(
    userId: number,
    movieId: number,
    favorite: boolean,
    db: Connection,
  ): Promise<void> {
    if (favorite)
      await db
        .insertInto('favorite_movies')
        .values({ user_id: userId, movie_id: movieId })
        .onConflict((oc) => oc.columns(['user_id', 'movie_id']).doNothing())
        .execute()
    else
      await db
        .deleteFrom('favorite_movies')
        .where('user_id', '=', userId)
        .where('movie_id', '=', movieId)
        .execute()
  }
  async findTmdb(id: number, db: Connection = this.database.client): Promise<Movie | undefined> {
    return db
      .selectFrom('movies')
      .where('group_id', '=', this.groupId)
      .selectAll()
      .where('tmdb_id', '=', id)
      .executeTakeFirst()
  }
  async search(query: string, limit: number, offset: number): Promise<Movie[]> {
    return this.database.client
      .selectFrom('movies')
      .where('group_id', '=', this.groupId)
      .selectAll()
      .where(sql<boolean>`position(lower(${query}) in lower(title)) > 0`)
      .orderBy('title')
      .orderBy('id')
      .limit(limit)
      .offset(offset)
      .execute()
  }
  async watchedIds(userId: number): Promise<number[]> {
    const rows = await this.database.client
      .selectFrom('user_watched_movies as w')
      .innerJoin('movies as m', 'm.id', 'w.movie_id')
      .select('m.id')
      .where('m.group_id', '=', this.groupId)
      .where('w.user_id', '=', userId)
      .orderBy('m.id')
      .execute()
    return rows.map((row) => row.id)
  }
  async favoriteIds(userId: number): Promise<number[]> {
    const rows = await this.database.client
      .selectFrom('favorite_movies as f')
      .innerJoin('movies as m', 'm.id', 'f.movie_id')
      .select('m.id')
      .where('m.group_id', '=', this.groupId)
      .where('f.user_id', '=', userId)
      .orderBy('m.id')
      .execute()
    return rows.map((row) => row.id)
  }
  async pending(limit: number, offset: number): Promise<Movie[]> {
    return this.database.client
      .selectFrom('movies')
      .where('group_id', '=', this.groupId)
      .selectAll()
      .where('approval_status', '=', 'pending')
      .orderBy('id')
      .limit(limit)
      .offset(offset)
      .execute()
  }
  async recentlyAdded(limit: number, offset: number): Promise<Movie[]> {
    return this.database.client
      .selectFrom('movies')
      .where('group_id', '=', this.groupId)
      .selectAll()
      .orderBy('created_at', 'desc')
      .orderBy('id', 'desc')
      .limit(limit)
      .offset(offset)
      .execute()
  }
  async findTmdbIds(ids: number[]): Promise<Movie[]> {
    if (!ids.length) return []
    return this.database.client
      .selectFrom('movies')
      .where('group_id', '=', this.groupId)
      .selectAll()
      .where('tmdb_id', 'in', ids)
      .execute()
  }
  async create(
    values: Insertable<Schema['movies']> & Pick<Movie, 'backdrop_path'>,
    db: Connection,
  ): Promise<Movie> {
    const { backdrop_path, ...stored } = values
    return db
      .insertInto('movies')
      .values({ ...stored, group_id: this.groupId })
      .returningAll()
      .executeTakeFirstOrThrow()
  }
  async update(
    id: number,
    values: Updateable<Schema['movies']> & Pick<Movie, 'backdrop_path'>,
    db: Connection,
  ): Promise<Movie> {
    const { backdrop_path, ...stored } = values
    return db
      .updateTable('movies')
      .set(stored)
      .where('id', '=', id)
      .where('group_id', '=', this.groupId)
      .returningAll()
      .executeTakeFirstOrThrow()
  }
  async mergeFavorites(source: number, target: number, db: Connection): Promise<void> {
    await db
      .insertInto('favorite_movies')
      .columns(['user_id', 'movie_id', 'created_at'])
      .expression((eb) =>
        eb
          .selectFrom('favorite_movies')
          .select(['user_id', eb.val(target).as('movie_id'), 'created_at'])
          .where('movie_id', '=', source),
      )
      .onConflict((oc) => oc.columns(['user_id', 'movie_id']).doNothing())
      .execute()
  }
  async removePending(id: number, db: Connection): Promise<void> {
    await db
      .deleteFrom('movies')
      .where('group_id', '=', this.groupId)
      .where('id', '=', id)
      .where('approval_status', '=', 'pending')
      .execute()
  }
}
