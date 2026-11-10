import type { Kysely, Transaction, Generated } from 'kysely'
import type {
  UserTable,
  SessionTable,
  ResetTable,
  RateLimitTable,
} from '../shared/database-models/user.database-model.js'
import type { MovieTable } from '../shared/database-models/movie.database-model.js'
import type { RoundTable, ResponseTable } from '../shared/database-models/round.database-model.js'
import type { WatchedTable, ReviewTable } from '../shared/database-models/review.database-model.js'
export type Schema = UserTable &
  SessionTable &
  ResetTable &
  RateLimitTable &
  MovieTable &
  RoundTable &
  ResponseTable &
  WatchedTable &
  ReviewTable & {
    schema_migrations: { version: number; applied_at: Generated<Date> }
  }
export type Connection = Kysely<Schema> | Transaction<Schema>
