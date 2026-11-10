import { z } from 'zod'
import type { Database } from '../repositories/database.js'
import type { UserRepository } from '../repositories/user.repository.js'
import type { Passwords } from './passwords.js'
import type { Clock } from './clock.js'
import type { User, StoredUser, Session, ResetToken } from '../models/entities.js'
import {
  GroupFullException,
  EmailExistsException,
  UsernameExistsException,
  AdminExistsException,
  RateLimitedException,
  InvalidCredentialsException,
  UserNotFoundException,
  InvalidResetTokenException,
} from '../shared/exceptions/index.js'

export class UserService {
  constructor(
    private readonly database: Database,
    private readonly repository: UserRepository,
    private readonly clock: Clock,
    private readonly passwords: Passwords,
  ) {}
  private normalizeEmail(email: string): string {
    return email.trim().toLowerCase()
  }
  async create(
    email: string | null,
    username: string,
    name: string,
    password: string,
    admin: boolean = false,
  ): Promise<User> {
    email = email === null ? null : z.string().email().max(254).parse(this.normalizeEmail(email))
    username = z
      .string()
      .regex(/^[a-z0-9_]{3,32}$/)
      .parse(username.trim().toLowerCase())
    name = z.string().trim().min(1).max(80).parse(name)
    const hash: string = await this.passwords.hash(password)
    return this.database.transaction(async (db) => {
      await this.database.lockUsers(db)
      const existing: User[] = await this.repository.list(db)
      if (existing.length >= 4) throw new GroupFullException()
      if (email !== null && existing.some((u) => u.email === email))
        throw new EmailExistsException()
      if (existing.some((u) => u.username === username)) throw new UsernameExistsException()
      if (admin && existing.some((u) => u.is_admin)) throw new AdminExistsException()
      return this.repository.create(email, username, name, hash, admin, db)
    })
  }
  async attempt(key: string, max: number): Promise<void> {
    if ((await this.repository.attempt(key, this.clock.now())) > max)
      throw new RateLimitedException()
  }
  async login(identifier: string, password: string, oldToken?: string): Promise<Session> {
    identifier = identifier.trim().toLowerCase()
    const account: StoredUser | undefined = await this.repository.byLogin(identifier)
    // Both login aliases share the same account attempt limit.
    await this.attempt(
      `login:${account ? `user:${account.id}` : this.passwords.tokenHash(identifier)}`,
      10,
    )
    return this.database.transaction(async (db) => {
      const saved: StoredUser | undefined = account
        ? await this.repository.lock(account.id, db)
        : undefined
      const valid: boolean = await this.passwords.verify(password, saved?.password_hash)
      if (!saved || !valid) throw new InvalidCredentialsException()
      if (oldToken) await this.repository.deleteSession(this.passwords.tokenHash(oldToken), db)
      const token: string = this.passwords.token()
      const expiresAt: Date = new Date(this.clock.now().getTime() + 30 * 24 * 60 * 60_000)
      await this.repository.createSession(
        this.passwords.tokenHash(token),
        saved.id,
        expiresAt,
        this.clock.now(),
        db,
      )
      const user: User = {
        id: saved.id,
        email: saved.email,
        username: saved.username,
        name: saved.name,
        is_admin: saved.is_admin,
      }
      return { token, expiresAt, user }
    })
  }
  async user(token?: string): Promise<User | null> {
    return token
      ? ((await this.repository.sessionUser(this.passwords.tokenHash(token), this.clock.now())) ??
          null)
      : null
  }
  async logout(token?: string): Promise<void> {
    if (token) await this.repository.deleteSession(this.passwords.tokenHash(token))
  }
  async changePassword(id: number, current: string, password: string): Promise<void> {
    this.passwords.validate(password)
    await this.database.transaction(async (db) => {
      const user: StoredUser | undefined = await this.repository.lock(id, db)
      if (!user || !(await this.passwords.verify(current, user.password_hash)))
        throw new InvalidCredentialsException()
      await this.repository.setPassword(id, await this.passwords.hash(password), db)
      await this.repository.deleteUserSessions(id, db)
      await this.repository.deleteResets(id, db)
    })
  }
  async issueReset(id: number): Promise<ResetToken> {
    return this.database.transaction(async (db) => {
      if (!(await this.repository.lock(id, db))) throw new UserNotFoundException()
      await this.repository.deleteResets(id, db)
      const token: string = this.passwords.token()
      const expiresAt: Date = new Date(this.clock.now().getTime() + 30 * 60_000)
      await this.repository.createReset(this.passwords.tokenHash(token), id, expiresAt, db)
      return { token, expiresAt }
    })
  }
  async reset(token: string, password: string): Promise<void> {
    this.passwords.validate(password)
    const hash: string = this.passwords.tokenHash(token)
    const id: number | undefined = await this.repository.resetOwner(hash)
    if (!id) throw new InvalidResetTokenException()
    // Consistent user -> reset lock order serializes password changes with login.
    await this.database.transaction(async (db) => {
      await this.repository.lock(id, db)
      if (!(await this.repository.consumeReset(hash, this.clock.now(), db)))
        throw new InvalidResetTokenException()
      await this.repository.setPassword(id, await this.passwords.hash(password), db)
      await this.repository.deleteUserSessions(id, db)
      await this.repository.deleteResets(id, db)
    })
  }
  async list(): Promise<User[]> {
    return this.repository.list()
  }
}
