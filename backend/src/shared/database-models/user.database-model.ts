import type { Generated, GeneratedAlways, ColumnType, Selectable } from 'kysely'
import type { ApprovalStatus } from '../../models/entities.js'
type Timestamp = ColumnType<Date, Date | undefined, Date>

interface UserTableDef {
  id: GeneratedAlways<number>
  email: string
  username: string
  password_hash: string
  name: string
  is_admin: Generated<boolean>
}
export type UserTuple = Selectable<UserTableDef>
export interface UserTable {
  users: UserTableDef
}

interface SessionTableDef {
  token_hash: string
  user_id: number
  expires_at: Date
}
export type SessionTuple = Selectable<SessionTableDef>
export interface SessionTable {
  sessions: SessionTableDef
}

export interface ResetTable {
  password_resets: SessionTableDef
}
export interface RateLimitTable {
  rate_limits: { key: string; attempts: number; expires_at: Date }
}
