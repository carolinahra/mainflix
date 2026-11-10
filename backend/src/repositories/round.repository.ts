import { sql } from 'kysely'
import type { Database } from './database.js'
import type { Connection } from './schema.js'
import type { RoundRow, RoundResponse, Member, HistoryEntry } from '../models/entities.js'

export class RoundRepository {
  constructor(private readonly database: Database) {}
  async ensure(week: string, db: Connection): Promise<void> {
    await db
      .insertInto('rounds')
      .values({ week_start: week })
      .onConflict((oc) => oc.column('week_start').doNothing())
      .execute()
  }
  async prune(week: string, db: Connection): Promise<void> {
    await db
      .deleteFrom('round_responses')
      .where('week_start', '=', week)
      .where(
        'movie_id',
        'in',
        db
          .selectFrom('movies')
          .select('id')
          .where((eb) =>
            eb.or([eb('eligible', '=', false), eb('approval_status', '!=', 'approved')]),
          ),
      )
      .where((eb) =>
        eb.exists(
          eb
            .selectFrom('rounds')
            .select('week_start')
            .where('week_start', '=', week)
            .where('winner_id', 'is', null),
        ),
      )
      .execute()
  }
  async row(week: string, db: Connection): Promise<RoundRow | undefined> {
    return db
      .selectFrom('rounds')
      .select([
        sql<string>`week_start::text`.as('week'),
        'winner_id',
        'drawn_by',
        'drawn_at',
        sql<Date>`((week_start::timestamp + interval '7 days') AT TIME ZONE 'Europe/Madrid')`.as(
          'ends_at',
        ),
      ])
      .where('week_start', '=', week)
      .executeTakeFirst()
  }
  async responses(week: string, db: Connection): Promise<RoundResponse[]> {
    return db
      .selectFrom('round_responses as r')
      .innerJoin('users as u', 'u.id', 'r.user_id')
      .leftJoin('movies as m', 'm.id', 'r.movie_id')
      .select(['r.user_id', 'u.name', 'r.movie_id', 'm.title'])
      .where('r.week_start', '=', week)
      .orderBy('r.user_id')
      .execute()
  }
  async members(db: Connection): Promise<Member[]> {
    return db.selectFrom('users').select(['id', 'name']).orderBy('id').execute()
  }
  async respond(
    userId: number,
    week: string,
    movieId: number | null,
    db: Connection,
  ): Promise<void> {
    await db
      .insertInto('round_responses')
      .values({ week_start: week, user_id: userId, movie_id: movieId })
      .onConflict((oc) => oc.columns(['week_start', 'user_id']).doUpdateSet({ movie_id: movieId }))
      .execute()
  }
  async setWinner(
    week: string,
    winner: number,
    userId: number,
    at: Date,
    db: Connection,
  ): Promise<void> {
    await db
      .updateTable('rounds')
      .set({ winner_id: winner, drawn_by: userId, drawn_at: at })
      .where('week_start', '=', week)
      .execute()
  }
  async hasSelected(movieId: number, db: Connection): Promise<boolean> {
    return !!(await db
      .selectFrom('rounds')
      .select('week_start')
      .where('winner_id', '=', movieId)
      .executeTakeFirst())
  }
  async history(limit: number, offset: number): Promise<HistoryEntry[]> {
    const rows = await this.database.client
      .selectFrom('rounds')
      .select([sql<string>`week_start::text`.as('week'), 'winner_id', 'drawn_at', 'drawn_by'])
      .orderBy('week_start', 'desc')
      .limit(limit)
      .offset(offset)
      .execute()
    // Four people, one selection/week; fetch winners in a single additional query.
    const ids: number[] = rows.flatMap((row) => (row.winner_id ? [row.winner_id] : []))
    const movies = ids.length
      ? await this.database.client.selectFrom('movies').selectAll().where('id', 'in', ids).execute()
      : []
    return rows.map((row) => ({
      week: row.week,
      drawn_at: row.drawn_at,
      drawn_by: row.drawn_by,
      winner: movies.find((m) => m.id === row.winner_id) ?? null,
    }))
  }
}
