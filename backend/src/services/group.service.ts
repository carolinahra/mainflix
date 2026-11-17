import { z } from 'zod'
import type { Database } from '../repositories/database.js'
import type { GroupRepository } from '../repositories/group.repository.js'
import type { UserRepository } from '../repositories/user.repository.js'
import type { Clock } from './clock.js'
import type { Passwords } from './passwords.js'
import type { Group, User, Invitation, ResetToken, Member } from '../models/entities.js'
import type { Connection } from '../repositories/schema.js'
import {
  ForbiddenException,
  UsernameExistsException,
  InvalidInvitationException,
  ValidationException,
} from '../shared/exceptions/index.js'

export class GroupService {
  constructor(
    private readonly database: Database,
    private readonly repository: GroupRepository,
    private readonly users: UserRepository,
    private readonly clock: Clock,
    private readonly passwords: Passwords,
  ) {}
  async list(userId: number): Promise<Group[]> {
    return this.repository.list(userId, this.clock.weekKey())
  }
  async membership(
    userId: number,
    groupId: number,
    db: Connection = this.database.client,
  ): Promise<Group> {
    const group = (await this.repository.list(userId, this.clock.weekKey(), db)).find(
      (g) => g.id === groupId,
    )
    if (!group) throw new ForbiddenException()
    return group
  }
  async create(userId: number, name: string): Promise<Group> {
    name = z.string().trim().min(1).max(80).parse(name)
    return this.database.transaction((db) =>
      this.repository.create(userId, name, this.clock.weekKey(), db),
    )
  }
  async members(userId: number, groupId: number): Promise<Member[]> {
    if (!(await this.membership(userId, groupId)).is_owner) throw new ForbiddenException()
    return this.repository.members(groupId)
  }
  async rename(userId: number, groupId: number, name: string): Promise<Group> {
    return this.database.transaction(async (db) => {
      await this.database.lockGroup(db, groupId)
      if (!(await this.membership(userId, groupId, db)).is_owner) throw new ForbiddenException()
      await this.repository.rename(groupId, name, db)
      return this.membership(userId, groupId, db)
    })
  }
  async removeMember(userId: number, groupId: number, memberId: number): Promise<void> {
    await this.database.transaction(async (db) => {
      await this.database.lockGroup(db, groupId)
      if (!(await this.membership(userId, groupId, db)).is_owner) throw new ForbiddenException()
      if (userId === memberId) throw new ValidationException()
      await this.repository.removeMember(groupId, memberId, this.clock.now(), db)
    })
  }
  async delete(userId: number, groupId: number): Promise<void> {
    await this.database.transaction(async (db) => {
      await this.database.lockGroup(db, groupId)
      if (!(await this.membership(userId, groupId, db)).is_owner) throw new ForbiddenException()
      await this.repository.delete(groupId, db)
    })
  }
  async invite(userId: number, groupId: number | null): Promise<ResetToken> {
    if (groupId !== null && !(await this.membership(userId, groupId)).is_owner)
      throw new ForbiddenException()
    const token = this.passwords.token()
    const expiresAt = new Date(this.clock.now().getTime() + 7 * 24 * 60 * 60_000)
    await this.repository.invite(this.passwords.tokenHash(token), userId, groupId, expiresAt)
    return { token, expiresAt }
  }
  async invitation(token: string): Promise<Invitation> {
    const invite = await this.repository.invitation(
      this.passwords.tokenHash(token),
      this.clock.now(),
    )
    if (!invite) throw new InvalidInvitationException()
    return invite
  }
  async accept(token: string, userId: number): Promise<void> {
    await this.database.transaction(async (db) => {
      const invite = await this.repository.consume(
        this.passwords.tokenHash(token),
        this.clock.now(),
        db,
      )
      if (!invite) throw new InvalidInvitationException()
      if (invite.group_id !== null)
        await this.repository.join(userId, invite.group_id, this.clock.weekKey(), db)
    })
  }
  async register(token: string, username: string, password: string, name?: string): Promise<User> {
    username = z
      .string()
      .trim()
      .toLowerCase()
      .regex(/^[a-z0-9_]{3,32}$/)
      .parse(username)
    name = z
      .string()
      .trim()
      .min(1)
      .max(80)
      .parse(name ?? username)
    const passwordHash = await this.passwords.hash(password)
    return this.database.transaction(async (db) => {
      await this.database.lockUsers(db)
      const invite = await this.repository.consume(
        this.passwords.tokenHash(token),
        this.clock.now(),
        db,
      )
      if (!invite) throw new InvalidInvitationException()
      if ((await this.users.list(db)).some((u) => u.username === username))
        throw new UsernameExistsException()
      const user = await this.users.create(null, username, name, passwordHash, false, db)
      if (invite.group_id !== null)
        await this.repository.join(user.id, invite.group_id, this.clock.weekKey(), db)
      return user
    })
  }
}
