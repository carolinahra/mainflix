export interface User {
  id: number
  email: string
  username: string
  name: string
  is_admin: boolean
}
export interface StoredUser extends User {
  password_hash: string
}
export interface Session {
  token: string
  expiresAt: Date
  user: User
}
export interface ResetToken {
  token: string
  expiresAt: Date
}
export type ApprovalStatus = 'pending' | 'approved' | 'rejected'
export interface Movie {
  id: number
  tmdb_id: number | null
  title: string
  release_year: number | null
  overview: string
  poster_path: string | null
  approval_status: ApprovalStatus
  submitted_by: number | null
  eligible: boolean
  eligibility_changed_by: number | null
  eligibility_changed_at: Date | null
  created_at: Date
}
export interface MovieInput {
  tmdbId?: number
  title?: string
  releaseYear?: number | null
}
export interface MoviePatch {
  tmdbId?: number
  title?: string
  releaseYear?: number | null
  overview?: string
  approvalStatus?: ApprovalStatus
  eligible?: boolean
}
export interface MovieMetadata {
  tmdb_id: number
  title: string
  release_year: number | null
  overview: string
  poster_path: string | null
}
export type Language = 'en' | 'es'
export interface MovieSearch {
  local: Movie[]
  remote: MovieMetadata[]
  remoteError: string | null
}
export interface RoundRow {
  week: string
  winner_id: number | null
  drawn_by: number | null
  drawn_at: Date | null
  ends_at: Date
}
export interface RoundResponse {
  user_id: number
  name: string
  movie_id: number | null
  title: string | null
}
export interface Member {
  id: number
  name: string
}
export type RoundStatus = 'collecting' | 'ready' | 'skipped' | 'selected'
export interface RoundState extends RoundRow {
  winner: Movie | null
  status: RoundStatus
  responses: RoundResponse[]
  members: Member[]
}
export interface HistoryEntry {
  week: string
  drawn_at: Date | null
  drawn_by: number | null
  winner: Movie | null
}
export interface Review {
  user_id: number
  movie_id: number
  name: string
  rating: number
  text: string
  created_at: Date
  updated_at: Date
}
export interface Watched {
  user_id: number
  name: string
  watched_at: Date
}
export interface MovieReviews {
  reviews: Review[]
  watched: Watched[]
}
export type Serialized<T> = T extends Date
  ? string
  : T extends (infer U)[]
    ? Serialized<U>[]
    : T extends object
      ? { [K in keyof T]: Serialized<T[K]> }
      : T
