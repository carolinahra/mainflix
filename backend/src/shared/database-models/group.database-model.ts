import type { Generated } from 'kysely'
export interface GroupTable {
  groups: {
    id: Generated<number>
    name: string
    owner_id: number | null
    created_at: Generated<Date>
  }
  group_members: {
    group_id: number
    user_id: number
    voting_from: string | null
  }
  invitations: {
    token_hash: string
    created_by: number
    group_id: number | null
    expires_at: Date
  }
}
