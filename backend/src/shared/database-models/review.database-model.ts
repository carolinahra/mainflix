import type { Generated, GeneratedAlways, ColumnType, Selectable } from 'kysely'
import type { ApprovalStatus } from '../../models/entities.js'
type Timestamp = ColumnType<Date, Date | undefined, Date>

interface WatchedTableDef {
  user_id: number
  movie_id: number
  watched_at: Timestamp
}
export type WatchedTuple = Selectable<WatchedTableDef>
export interface WatchedTable {
  user_watched_movies: WatchedTableDef
}

interface ReviewTableDef {
  user_id: number
  movie_id: number
  rating: number
  text: Generated<string>
  created_at: Timestamp
  updated_at: Timestamp
}
export type ReviewTuple = Selectable<ReviewTableDef>
export interface ReviewTable {
  reviews: ReviewTableDef
}
