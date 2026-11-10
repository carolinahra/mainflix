import type { Generated, GeneratedAlways, ColumnType, Selectable } from 'kysely'
import type { ApprovalStatus } from '../../models/entities.js'
type Timestamp = ColumnType<Date, Date | undefined, Date>

interface RoundTableDef {
  week_start: string
  winner_id: Generated<number | null>
  drawn_by: Generated<number | null>
  drawn_at: Generated<Date | null>
}
export type RoundTuple = Selectable<RoundTableDef>
export interface RoundTable {
  rounds: RoundTableDef
}

interface ResponseTableDef {
  week_start: string
  user_id: number
  movie_id: number | null
}
export type ResponseTuple = Selectable<ResponseTableDef>
export interface ResponseTable {
  round_responses: ResponseTableDef
}
