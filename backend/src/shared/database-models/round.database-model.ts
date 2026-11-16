import type { Generated, GeneratedAlways, ColumnType, Selectable, JSONColumnType } from 'kysely'
import type { SurveyAnswer } from '../../models/entities.js'
import type { ApprovalStatus } from '../../models/entities.js'
type Timestamp = ColumnType<Date, Date | undefined, Date>

interface RoundTableDef {
  survey_enabled: Generated<boolean>
  started_at: Generated<Date | null>
  group_id: Generated<number>
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
  group_id: Generated<number>
  week_start: string
  user_id: number
  movie_id: number | null
}
export type ResponseTuple = Selectable<ResponseTableDef>
export interface ResponseTable {
  round_responses: ResponseTableDef
}
export interface SurveyTable {
  round_survey_responses: {
    group_id: number
    week_start: string
    user_id: number
    answers: JSONColumnType<SurveyAnswer[]>
    completed_at: Date | null
  }
}
