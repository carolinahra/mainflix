import type { Generated, GeneratedAlways, ColumnType, Selectable } from 'kysely'
import type { ApprovalStatus } from '../../models/entities.js'
type Timestamp = ColumnType<Date, Date | undefined, Date>

interface MovieTableDef {
  id: GeneratedAlways<number>
  tmdb_id: Generated<number | null>
  title: string
  release_year: Generated<number | null>
  overview: Generated<string>
  poster_path: Generated<string | null>
  approval_status: Generated<ApprovalStatus>
  submitted_by: Generated<number | null>
  eligible: Generated<boolean>
  eligibility_changed_by: Generated<number | null>
  eligibility_changed_at: Generated<Date | null>
  created_at: Timestamp
}
export type MovieTuple = Selectable<MovieTableDef>
export interface MovieTable {
  movies: MovieTableDef
}
