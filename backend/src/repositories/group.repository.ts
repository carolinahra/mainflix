import { sql } from 'kysely'
import type { Database } from './database.js'
import type { Connection } from './schema.js'
import type { Group, Invitation, Member } from '../models/entities.js'
import { NotFoundException } from '../shared/exceptions/index.js'
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
  async members(groupId: number): Promise<Member[]> {
    return this.database.client
      .selectFrom('group_members as m')
      .innerJoin('users as u', 'u.id', 'm.user_id')
      .select(['u.id', 'u.name', 'u.username', 'u.avatar'])
      .where('m.group_id', '=', groupId)
      .orderBy('u.id')
      .execute()
  }
  async rename(groupId: number, name: string, db: Connection): Promise<void> {
    await db.updateTable('groups').set({ name }).where('id', '=', groupId).execute()
  }
  async removeMember(groupId: number, userId: number, now: Date, db: Connection): Promise<void> {
    const result = await db
      .deleteFrom('group_members')
      .where('group_id', '=', groupId)
      .where('user_id', '=', userId)
      .executeTakeFirst()
    if (result.numDeletedRows === 0n) throw new NotFoundException()
    await db
      .deleteFrom('round_responses')
      .where('group_id', '=', groupId)
      .where('user_id', '=', userId)
      .where(
        'week_start',
        'in',
        db
          .selectFrom('rounds')
          .select('week_start')
          .where('group_id', '=', groupId)
          .where('winner_id', 'is', null),
      )
      .execute()
    await db
      .updateTable('round_survey_responses')
      .set({ completed_at: now })
      .where('group_id', '=', groupId)
      .where('user_id', '=', userId)
      .where('completed_at', 'is', null)
      .execute()
  }
  async delete(groupId: number, db: Connection): Promise<void> {
    const movies = db.selectFrom('movies').select('id').where('group_id', '=', groupId)
    await db.deleteFrom('round_responses').where('group_id', '=', groupId).execute()
    await db.deleteFrom('rounds').where('group_id', '=', groupId).execute()
    await db.deleteFrom('reviews').where('movie_id', 'in', movies).execute()
    await db.deleteFrom('user_watched_movies').where('movie_id', 'in', movies).execute()
    await db.deleteFrom('movies').where('group_id', '=', groupId).execute()
    await db.deleteFrom('invitations').where('group_id', '=', groupId).execute()
    await db.deleteFrom('group_members').where('group_id', '=', groupId).execute()
    await db.deleteFrom('groups').where('id', '=', groupId).execute()
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
    const invite = await this.invitation(hash, now, db)
    if (invite && invite.group_id !== null) return invite
    return db
      .deleteFrom('invitations')
      .where('token_hash', '=', hash)
      .where('expires_at', '>', now)
      .returning('group_id')
      .executeTakeFirst()
  }
}
