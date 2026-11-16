import { sql } from 'kysely'
import type { Database } from './database.js'
import type { Connection } from './schema.js'
import type { Group, Invitation } from '../models/entities.js'
export class GroupRepository {
  constructor(private readonly database: Database) {}
  async list(
    userId: number,
    week: string,
    db: Connection = this.database.client,
  ): Promise<Group[]> {
    return db
      .selectFrom('groups as g')
      .innerJoin('group_members as m', 'm.group_id', 'g.id')
      .select([
        'g.id',
        'g.name',
        sql<boolean>`coalesce(g.owner_id = ${userId},false)`.as('is_owner'),
        sql<boolean>`coalesce(m.voting_from <= ${week}::date,false)`.as('can_vote'),
      ])
      .where('m.user_id', '=', userId)
      .orderBy('g.id')
      .execute()
  }
  async create(userId: number, name: string, week: string, db: Connection): Promise<Group> {
    const group = await db
      .insertInto('groups')
      .values({ name, owner_id: userId })
      .returning(['id', 'name'])
      .executeTakeFirstOrThrow()
    await db
      .insertInto('group_members')
      .values({ group_id: group.id, user_id: userId, voting_from: week })
      .execute()
    return { ...group, is_owner: true, can_vote: true }
  }
  async join(userId: number, groupId: number, week: string, db: Connection): Promise<void> {
    await this.database.lockGroup(db, groupId)
    const started = await db
      .selectFrom('rounds')
      .select('week_start')
      .where('group_id', '=', groupId)
      .where('week_start', '=', week)
      .where('started_at', 'is not', null)
      .executeTakeFirst()
    const next = new Date(`${week}T12:00:00Z`)
    next.setUTCDate(next.getUTCDate() + 7)
    await db
      .insertInto('group_members')
      .values({
        group_id: groupId,
        user_id: userId,
        voting_from: started ? next.toISOString().slice(0, 10) : week,
      })
      .onConflict((oc) => oc.columns(['group_id', 'user_id']).doNothing())
      .execute()
  }
  async invite(
    hash: string,
    userId: number,
    groupId: number | null,
    expiresAt: Date,
  ): Promise<void> {
    await this.database.client
      .insertInto('invitations')
      .values({ token_hash: hash, created_by: userId, group_id: groupId, expires_at: expiresAt })
      .execute()
  }
  async invitation(
    hash: string,
    now: Date,
    db: Connection = this.database.client,
  ): Promise<Invitation | undefined> {
    return db
      .selectFrom('invitations as i')
      .leftJoin('groups as g', 'g.id', 'i.group_id')
      .select(['i.group_id', 'g.name as groupName', 'i.expires_at as expiresAt'])
      .where('i.token_hash', '=', hash)
      .where('i.expires_at', '>', now)
      .executeTakeFirst()
  }
  async consume(
    hash: string,
    now: Date,
    db: Connection,
  ): Promise<{ group_id: number | null } | undefined> {
    return db
      .deleteFrom('invitations')
      .where('token_hash', '=', hash)
      .where('expires_at', '>', now)
      .returning('group_id')
      .executeTakeFirst()
  }
}
