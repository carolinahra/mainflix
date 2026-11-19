export interface User {
  id: number
  email: string | null
  username: string
  name: string
  is_admin: boolean
  avatar: string | null
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
  group_id: number
  id: number
  tmdb_id: number | null
  title: string
  release_year: number | null
  overview: string
  poster_path: string | null
  backdrop_path?: string | null
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
  backdrop_path?: string | null
}
export interface WatchProvider {
  provider_id: number
  provider_name: string
  logo_path: string
}
export interface MovieWatchProviders {
  link: string
  flatrate: WatchProvider[]
  rent: WatchProvider[]
}
export type Language = 'en' | 'es'
export interface MovieSearch {
  local: Movie[]
  remote: MovieMetadata[]
  remoteError: string | null
  watched?: number[]
  favorites?: number[]
}
export const movieCategories = [
  'featured',
  'christmas',
  'romanticComedy',
  'horror',
  'comedy',
  'recentlyAdded',
  'newReleases',
  'popular',
  'action',
  'scienceFiction',
  'drama',
  'thriller',
  'animation',
  'barbie',
  'adventure',
  'fantasy',
  'romance',
] as const
export type MovieCategory = (typeof movieCategories)[number]
export interface MovieBrowse extends MovieSearch {
  page: number
  totalPages: number
}
export interface RoundRow {
  survey_enabled: boolean
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
  username: string
  avatar: string | null
}
export type RoundStatus = 'collecting' | 'ready' | 'skipped' | 'selected'
export interface RoundState extends RoundRow {
  winner: Movie | null
  status: RoundStatus
  responses: RoundResponse[]
  members: Member[]
}
export interface SurveyAnswer {
  movieId: number
  userIds: number[] | null
}
export type SurveyAction = SurveyAnswer | { finish: true } | { skip: true }
export interface SurveyQuestion {
  movieId: number
  title: string
  answered: boolean
  userIds: number[] | null
  options: { userId: number; percentage: number; votes: number }[] | null
  answerCount: number | null
}
export interface RoundSurvey {
  eligible: boolean
  completed: boolean
  participants: (Member & { completed: boolean })[]
  questions: SurveyQuestion[]
}
export interface RoundView extends RoundState {
  revealed: boolean
  nominations: { movieId: number; title: string; count: number }[]
  survey: RoundSurvey | null
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
  avatar: string | null
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
  reviewsLocked: boolean
}
export interface ReviewedMovie {
  movie: Movie
  reviews: Review[]
  reviewsLocked: boolean
}
export type Serialized<T> = T extends Date
  ? string
  : T extends (infer U)[]
    ? Serialized<U>[]
    : T extends object
      ? { [K in keyof T]: Serialized<T[K]> }
      : T

export interface Group {
  id: number
  name: string
  is_owner: boolean
  can_vote: boolean
}

export interface Invitation {
  group_id: number | null
  groupName: string | null
  expiresAt: Date
}
