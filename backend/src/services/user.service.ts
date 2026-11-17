import { z } from 'zod'
import type { Database } from '../repositories/database.js'
import type { UserRepository } from '../repositories/user.repository.js'
import type { Passwords } from './passwords.js'
import type { Clock } from './clock.js'
import type { User, StoredUser, Session, ResetToken } from '../models/entities.js'
import {
  EmailExistsException,
  UsernameExistsException,
  AdminExistsException,
  RateLimitedException,
  InvalidCredentialsException,
  UserNotFoundException,
  InvalidResetTokenException,
  ValidationException,
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
      if (email !== null && existing.some((u) => u.email === email))
        throw new EmailExistsException()
      if (existing.some((u) => u.username === username)) throw new UsernameExistsException()
      if (admin && existing.some((u) => u.is_admin)) throw new AdminExistsException()
      const user = await this.repository.create(email, username, name, hash, admin, db)
      // CLI provisioning retains membership in the original group; invitation signup does not.
      await this.repository.provisionMembership(user.id, admin, this.clock.weekKey(), db)
      return user
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
        avatar: saved.avatar,
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
  async update(id: number, input: unknown): Promise<User> {
    const values = z
      .object({
        name: z.string().trim().min(1).max(80).optional(),
        username: z
          .string()
          .trim()
          .toLowerCase()
          .regex(/^[a-z0-9_]{3,32}$/)
          .optional(),
        avatar: z
          .string()
          .max(22000)
          .regex(/^data:image\/(?:webp|jpeg);base64,[A-Za-z0-9+/]+={0,2}$/)
          .nullable()
          .optional(),
      })
      .strict()
      .refine((value) => Object.keys(value).length > 0)
      .parse(input)
    if (values.avatar) {
      const data = Buffer.from(values.avatar.slice(values.avatar.indexOf(',') + 1), 'base64')
      if (data.length < 20 || data.length > 16384)
        throw new ValidationException('Invalid profile thumbnail')
      let width = 0
      let height = 0
      if (values.avatar.startsWith('data:image/jpeg;')) {
        if (data.readUInt16BE(0) !== 0xffd8 || data.readUInt16BE(data.length - 2) !== 0xffd9)
          throw new ValidationException('Invalid profile thumbnail')
        for (let offset = 2; offset + 4 <= data.length;) {
          if (data[offset] !== 0xff) throw new ValidationException('Invalid profile thumbnail')
          const marker = data[offset + 1]
          if (marker === 0xda || marker === 0xd9) break
          const length = data.readUInt16BE(offset + 2)
          if (length < 2 || offset + 2 + length > data.length)
            throw new ValidationException('Invalid profile thumbnail')
          if (marker === 0xc0 || marker === 0xc2) {
            if (length < 8 || data[offset + 4] !== 8)
              throw new ValidationException('Invalid profile thumbnail')
            height = data.readUInt16BE(offset + 5)
            width = data.readUInt16BE(offset + 7)
            break
          }
          offset += length + 2
        }
      } else {
        if (
          data.toString('ascii', 0, 4) !== 'RIFF' ||
          data.toString('ascii', 8, 12) !== 'WEBP' ||
          data.readUInt32LE(4) !== data.length - 8 ||
          !['VP8 ', 'VP8L', 'VP8X'].includes(data.toString('ascii', 12, 16))
        )
          throw new ValidationException('Invalid profile thumbnail')
        const kind = data.toString('ascii', 12, 16)
        if (
          kind === 'VP8 ' &&
          data.length >= 30 &&
          data.subarray(23, 26).equals(Buffer.from([0x9d, 0x01, 0x2a]))
        ) {
          width = data.readUInt16LE(26) & 0x3fff
          height = data.readUInt16LE(28) & 0x3fff
        } else if (kind === 'VP8L' && data.length >= 25 && data[20] === 0x2f) {
          const bits = data.readUInt32LE(21)
          width = (bits & 0x3fff) + 1
          height = ((bits >>> 14) & 0x3fff) + 1
        } else if (kind === 'VP8X' && data.length >= 30 && !(data[20]! & 2)) {
          width = data.readUIntLE(24, 3) + 1
          height = data.readUIntLE(27, 3) + 1
        }
      }
      if (width < 1 || height < 1 || width > 128 || height > 128)
        throw new ValidationException('Profile thumbnail must be at most 128 by 128 pixels')
    }
    return this.database.transaction(async (db) => {
      await this.database.lockUsers(db)
      if (!(await this.repository.lock(id, db))) throw new UserNotFoundException()
      if (
        values.username &&
        (await this.repository.list(db)).some(
          (user) => user.id !== id && user.username === values.username,
        )
      )
        throw new UsernameExistsException()
      return this.repository.update(id, values, db)
    })
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
