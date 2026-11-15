import { Component, createRef, type ReactNode, type FormEvent, type ChangeEvent } from 'react'
import type { Container } from './container.js'
import { ApiException } from './api.js'
import type { TranslationKey, Language } from './i18n.js'
import type {
  Serialized,
  User,
  Movie,
  MovieSearch,
  MovieMetadata,
  RoundState,
  HistoryEntry,
  MovieReviews,
  MoviePatch,
  MovieCategory,
  MovieBrowse,
  Review,
  ReviewedMovie,
} from '../../backend/src/models/entities.js'

type Film = Serialized<Movie>
type Detail = { movie: Film } & Serialized<MovieReviews>
type Tab = 'week' | 'catalogue' | 'history' | 'reviews' | 'admin'
interface Props {
  container: Container
}
interface State {
  loading: boolean
  busy: boolean
  user: User | null
  round: Serialized<RoundState> | null
  tab: Tab
  search: Serialized<MovieSearch>
  browse: Partial<Record<MovieCategory, Serialized<MovieBrowse>>>
  browseLoading: Partial<Record<MovieCategory, boolean>>
  genre: MovieCategory
  query: string
  detail: Detail | null
  history: Serialized<HistoryEntry>[]
  reviewed: Serialized<ReviewedMovie>[]
  pending: Film[]
  accounts: User[]
  message: TranslationKey | null
  error: string | null
  resetToken: string | null
  language: Language
  spinning: boolean
  randomOpen: boolean
  randomMovie: MovieMetadata | null
  randomLoading: boolean
  randomError: string | null
  randomCategory: MovieCategory
  randomFrom: string
  randomTo: string
}
export class Mainflix extends Component<Props, State> {
  private readonly dialog = createRef<HTMLDialogElement>()
  private readonly randomDialog = createRef<HTMLDialogElement>()
  private readonly roulette = createRef<HTMLDivElement>()
  private poll: ReturnType<typeof setInterval> | undefined
  private debounce: ReturnType<typeof setTimeout> | undefined
  private spinTimer: ReturnType<typeof setTimeout> | undefined
  private randomController: AbortController | undefined
  private searchController: AbortController | undefined
  private readonly browseControllers = new Map<MovieCategory, AbortController>()
  override state: State = {
    loading: true,
    busy: false,
    user: null,
    round: null,
    tab: 'week',
    search: { local: [], remote: [], remoteError: null },
    browse: {},
    browseLoading: {},
    genre: 'action',
    query: '',
    detail: null,
    history: [],
    reviewed: [],
    pending: [],
    accounts: [],
    message: null,
    error: null,
    resetToken: location.hash.startsWith('#reset=') ? location.hash.slice(7) : null,
    language: this.props.container.i18n.current,
    spinning: false,
    randomOpen: false,
    randomMovie: null,
    randomLoading: false,
    randomError: null,
    randomCategory: 'popular',
    randomFrom: '',
    randomTo: '',
  }
  private t(key: TranslationKey): string {
    return this.props.container.i18n.t(key)
  }
  override componentDidMount(): void {
    void this.initialize()
    this.poll = setInterval((): void => {
      if (this.state.user && !document.hidden) void this.refreshRound()
    }, 5000)
  }
  override componentWillUnmount(): void {
    clearInterval(this.poll)
    clearTimeout(this.debounce)
    clearTimeout(this.spinTimer)
    this.randomController?.abort()
    this.searchController?.abort()
    this.browseControllers.forEach((controller) => controller.abort())
  }
  private clearSession(): void {
    this.randomController?.abort()
    this.searchController?.abort()
    this.browseControllers.forEach((controller) => controller.abort())
    this.browseControllers.clear()
    clearTimeout(this.debounce)
    clearTimeout(this.spinTimer)
    this.dialog.current?.close()
    this.randomDialog.current?.close()
    this.setState({
      user: null,
      round: null,
      tab: 'week',
      query: '',
      search: { local: [], remote: [], remoteError: null },
      browse: {},
      browseLoading: {},
      genre: 'action',
      history: [],
      reviewed: [],
      pending: [],
      accounts: [],
      detail: null,
      spinning: false,
      randomOpen: false,
      randomMovie: null,
      randomLoading: false,
      randomError: null,
      randomCategory: 'popular',
      randomFrom: '',
      randomTo: '',
    })
  }
  private async initialize(): Promise<void> {
    try {
      const user: User = await this.props.container.api.request('/auth/me')
      this.clearSession()
      this.setState({ user })
      await this.refreshRound()
      await this.search('')
      this.loadDiscovery()
    } catch (error: unknown) {
      if (!(error instanceof ApiException && error.status === 401))
        this.setState({ error: error instanceof ApiException ? error.code : 'genericError' })
    } finally {
      this.setState({ loading: false })
    }
  }
  private async perform(work: () => Promise<void>): Promise<void> {
    this.setState({ busy: true, error: null, message: null })
    try {
      await work()
    } catch (error: unknown) {
      if (
        error instanceof ApiException &&
        error.status === 401 &&
        error.code === 'AUTHENTICATION_REQUIRED'
      )
        this.clearSession()
      this.setState({ error: error instanceof ApiException ? error.code : 'genericError' })
      if (error instanceof ApiException && error.code.startsWith('ROUND_'))
        await this.refreshRound()
    } finally {
      this.setState({ busy: false })
    }
  }
  private async refreshRound(): Promise<void> {
    try {
      const round: Serialized<RoundState> =
        await this.props.container.api.request('/rounds/current')
      this.setState({ round })
    } catch (error: unknown) {
      if (error instanceof ApiException && error.status === 401) this.clearSession()
      else this.setState({ error: error instanceof ApiException ? error.code : 'genericError' })
    }
  }
  private login(event: FormEvent<HTMLFormElement>): void {
    event.preventDefault()
    const data: FormData = new FormData(event.currentTarget)
    void this.perform(async (): Promise<void> => {
      const user: User = await this.props.container.api.request('/auth/login', 'POST', {
        identifier: data.get('identifier'),
        password: data.get('password'),
      })
      this.clearSession()
      this.setState({ user })
      await this.refreshRound()
      await this.search('')
      this.loadDiscovery()
    })
  }
  private logout(): void {
    void this.perform(async (): Promise<void> => {
      await this.props.container.api.request('/auth/logout', 'POST')
      this.clearSession()
    })
  }
  private password(event: FormEvent<HTMLFormElement>): void {
    event.preventDefault()
    const data: FormData = new FormData(event.currentTarget)
    void this.perform(async (): Promise<void> => {
      if (this.state.resetToken) {
        await this.props.container.api.request('/auth/reset', 'POST', {
          token: this.state.resetToken,
          password: data.get('password'),
        })
        history.replaceState(null, '', location.pathname)
        this.clearSession()
        this.setState({ resetToken: null, message: 'resetDone' })
      } else {
        await this.props.container.api.request('/auth/password', 'PUT', {
          currentPassword: data.get('currentPassword'),
          password: data.get('password'),
        })
        this.clearSession()
        this.setState({ message: 'passwordChanged' })
      }
    })
  }
  private language(event: ChangeEvent<HTMLSelectElement>): void {
    const language: Language = event.target.value === 'es' ? 'es' : 'en'
    this.randomController?.abort()
    this.props.container.i18n.current = language
    this.setState({ randomMovie: null, randomLoading: false, randomError: null })
    this.setState({ language }, (): void => {
      if (this.state.user) void this.search(this.state.query)
      this.browseControllers.forEach((controller) => controller.abort())
      this.setState({ browse: {}, browseLoading: {} }, () => this.loadDiscovery())
    })
  }
  private navigate(tab: Tab): void {
    this.setState({ tab, error: null, message: null })
    if (tab === 'history') void this.loadHistory(false)
    if (tab === 'reviews') void this.loadReviews(false)
    if (tab === 'admin') void this.loadAdmin()
    if (tab === 'catalogue' || tab === 'week') void this.search(this.state.query)
  }
  private searchChanged(event: ChangeEvent<HTMLInputElement>): void {
    const query: string = event.target.value
    this.setState({ query })
    clearTimeout(this.debounce)
    this.searchController?.abort()
    this.debounce = setTimeout((): void => {
      void this.search(query)
    }, 300)
  }
  private async search(query: string, more: boolean = false): Promise<void> {
    this.searchController?.abort()
    const controller: AbortController = new AbortController()
    this.searchController = controller
    try {
      const offset: number = more ? this.state.search.local.length : 0
      const result: Serialized<MovieSearch> = await this.props.container.api.request(
        `/movies?q=${encodeURIComponent(query)}&language=${this.state.language}&limit=30&offset=${offset}`,
        'GET',
        undefined,
        controller.signal,
      )
      if (controller.signal.aborted) return
      this.setState((state) => ({
        search: more ? { ...result, local: [...state.search.local, ...result.local] } : result,
      }))
    } catch (error: unknown) {
      if (!controller.signal.aborted)
        this.setState({ error: error instanceof ApiException ? error.code : 'genericError' })
    }
  }
  private loadDiscovery(): void {
    if (!this.state.user) return
    const categories: MovieCategory[] = [
      'featured',
      'romanticComedy',
      'horror',
      'comedy',
      'barbie',
      'animation',
      'recentlyAdded',
      'newReleases',
      'popular',
      this.state.genre,
    ]
    categories.forEach((category) => {
      void this.loadBrowse(category)
    })
  }
  private async loadBrowse(category: MovieCategory, more: boolean = false): Promise<void> {
    this.browseControllers.get(category)?.abort()
    const controller = new AbortController()
    this.browseControllers.set(category, controller)
    const page = more ? (this.state.browse[category]?.page ?? 0) + 1 : 1
    this.setState((state) => ({ browseLoading: { ...state.browseLoading, [category]: true } }))
    try {
      const result: Serialized<MovieBrowse> = await this.props.container.api.request(
        `/movies/browse?category=${category}&language=${this.state.language}&page=${page}`,
        'GET',
        undefined,
        controller.signal,
      )
      if (controller.signal.aborted) return
      this.setState((state) => {
        const previous = more ? state.browse[category] : undefined
        return {
          browse: {
            ...state.browse,
            [category]: {
              ...result,
              page: result.remoteError && previous ? previous.page : result.page,
              totalPages: result.remoteError && previous ? previous.totalPages : result.totalPages,
              local: [
                ...new Map(
                  [...(previous?.local ?? []), ...result.local].map((movie) => [movie.id, movie]),
                ).values(),
              ],
              remote: [
                ...new Map(
                  [...(previous?.remote ?? []), ...result.remote].map((movie) => [
                    movie.tmdb_id,
                    movie,
                  ]),
                ).values(),
              ],
            },
          },
        }
      })
    } catch (error: unknown) {
      if (controller.signal.aborted) return
      if (error instanceof ApiException && error.status === 401) {
        this.clearSession()
        return
      }
      this.setState((state) => ({
        browse: {
          ...state.browse,
          [category]: {
            ...(state.browse[category] ?? { local: [], remote: [], page: 0, totalPages: 1 }),
            remoteError: error instanceof ApiException ? error.code : 'genericError',
          },
        },
      }))
    } finally {
      if (!controller.signal.aborted)
        this.setState((state) => ({ browseLoading: { ...state.browseLoading, [category]: false } }))
    }
  }
  private cancelRandom(): void {
    this.randomController?.abort()
    this.randomDialog.current?.close()
    this.setState(
      { randomOpen: false, randomMovie: null, randomLoading: false, randomError: null },
      () => document.getElementById('random-trigger')?.focus(),
    )
  }
  private async pickRandom(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault()
    this.randomController?.abort()
    const controller = new AbortController()
    this.randomController = controller
    const { randomCategory, randomFrom, randomTo, randomMovie, language } = this.state
    if (randomFrom && randomTo && Number(randomFrom) > Number(randomTo)) {
      this.setState({ randomError: 'VALIDATION_ERROR' })
      return
    }
    this.setState({ randomLoading: true, randomError: null })
    const params = new URLSearchParams({ category: randomCategory, language })
    if (randomFrom) params.set('yearFrom', randomFrom)
    if (randomTo || randomFrom) params.set('yearTo', randomTo || randomFrom)
    try {
      const first = await this.props.container.api.request<Serialized<MovieBrowse>>(
        `/movies/browse?${params}&page=1`,
        'GET',
        undefined,
        controller.signal,
      )
      if (controller.signal.aborted) return
      if (first.remoteError) throw new ApiException(first.remoteError, 503)
      // shortcut: TMDB exposes at most 500 pages; use a larger catalogue for exhaustive sampling.
      const page = Math.floor(Math.random() * Math.max(first.totalPages, 1)) + 1
      const result =
        page === 1
          ? first
          : await this.props.container.api.request<Serialized<MovieBrowse>>(
              `/movies/browse?${params}&page=${page}`,
              'GET',
              undefined,
              controller.signal,
            )
      if (controller.signal.aborted) return
      if (result.remoteError) throw new ApiException(result.remoteError, 503)
      const available = (browse: Serialized<MovieBrowse>): MovieMetadata[] =>
        browse.remote.filter((movie) => {
          const local = browse.local.find((local) => local.tmdb_id === movie.tmdb_id)
          return (
            movie.tmdb_id !== randomMovie?.tmdb_id &&
            (!local || (local.eligible && local.approval_status !== 'rejected'))
          )
        })
      const candidates = available(result)
      if (!candidates.length && page !== 1) candidates.push(...available(first))
      if (!candidates.length)
        this.setState({ randomError: randomMovie ? 'randomNoOther' : 'noMovies' })
      else
        this.setState({ randomMovie: candidates[Math.floor(Math.random() * candidates.length)]! })
    } catch (error: unknown) {
      if (!controller.signal.aborted)
        this.setState({ randomError: error instanceof ApiException ? error.code : 'genericError' })
    } finally {
      if (!controller.signal.aborted) this.setState({ randomLoading: false })
    }
  }
  private nominateTmdb(tmdbId: number): void {
    const { round, language } = this.state
    if (!round) return
    void this.perform(async () => {
      const updated = await this.props.container.api.request<Serialized<RoundState>>(
        `/rounds/${round.week}/response?language=${language}`,
        'PUT',
        { tmdbId },
      )
      this.setState({ round: updated, message: 'nominated' })
      this.cancelRandom()
      await this.search(this.state.query)
      this.loadDiscovery()
    })
  }
  private renderRandom(): ReactNode {
    if (this.state.user?.is_admin || this.state.round?.status !== 'collecting') return null
    const { randomMovie, randomLoading, busy } = this.state
    const categories: MovieCategory[] = [
      'popular',
      'romanticComedy',
      'horror',
      'comedy',
      'action',
      'scienceFiction',
      'drama',
      'thriller',
      'animation',
      'adventure',
      'fantasy',
      'romance',
    ]
    return (
      <section className="random-picker" aria-label={this.t('randomMovie')}>
        <button
          id="random-trigger"
          className="primary random-trigger"
          aria-expanded={this.state.randomOpen}
          aria-haspopup="dialog"
          aria-controls="random-options"
          disabled={busy}
          onClick={() =>
            this.setState({ randomOpen: true, error: null }, () =>
              this.randomDialog.current?.showModal(),
            )
          }
        >
          <img src="/art/diamond.png" alt="" width="24" height="24" />
          {this.t('randomMovie')}
        </button>
        {this.state.randomOpen && (
          <dialog
            id="random-options"
            ref={this.randomDialog}
            aria-labelledby="random-title"
            onCancel={(event) => {
              event.preventDefault()
              if (!busy) this.cancelRandom()
            }}
            onClick={(event) => {
              if (busy || event.target !== event.currentTarget) return
              const bounds = event.currentTarget.getBoundingClientRect()
              if (
                event.clientX < bounds.left ||
                event.clientX > bounds.right ||
                event.clientY < bounds.top ||
                event.clientY > bounds.bottom
              )
                this.cancelRandom()
            }}
          >
            <button className="close" disabled={busy} onClick={() => this.cancelRandom()}>
              {this.t('close')} ×
            </button>
            <h2 id="random-title">{this.t('randomMovie')}</h2>
            {this.state.error && (
              <p className="notice error" role="alert">
                {this.props.container.i18n.error(this.state.error)}
              </p>
            )}
            <form
              onSubmit={(event) => {
                void this.pickRandom(event)
              }}
            >
              <fieldset disabled={randomLoading || busy}>
                <legend>{this.t('randomFilters')}</legend>
                <label>
                  {this.t('randomCategory')}
                  <select
                    aria-label={this.t('randomCategory')}
                    value={this.state.randomCategory}
                    onChange={(event) =>
                      this.setState({
                        randomCategory: event.target.value as MovieCategory,
                        randomMovie: null,
                        randomError: null,
                      })
                    }
                  >
                    {categories.map((category) => (
                      <option key={category} value={category}>
                        {this.t(category)}
                      </option>
                    ))}
                  </select>
                </label>
                <label>
                  {this.t('randomFrom')}
                  <input
                    type="number"
                    min="1870"
                    max="2200"
                    step="1"
                    value={this.state.randomFrom}
                    onChange={(event) =>
                      this.setState({
                        randomFrom: event.target.value,
                        randomMovie: null,
                        randomError: null,
                      })
                    }
                  />
                </label>
                <label>
                  {this.t('randomTo')}
                  <input
                    type="number"
                    min={this.state.randomFrom || '1870'}
                    max="2200"
                    step="1"
                    value={this.state.randomTo}
                    onChange={(event) =>
                      this.setState({
                        randomTo: event.target.value,
                        randomMovie: null,
                        randomError: null,
                      })
                    }
                  />
                </label>
                <p className="muted">{this.t('randomYearHint')}</p>
                <button type="submit">{this.t(randomMovie ? 'retry' : 'randomChoose')}</button>
              </fieldset>
            </form>
            <div aria-live="polite" aria-busy={randomLoading}>
              {randomLoading && <p>{this.t('loading')}</p>}
              {this.state.randomError && (
                <p role="alert">{this.props.container.i18n.error(this.state.randomError)}</p>
              )}
              {randomMovie && (
                <article className="random-result">
                  {this.renderPoster(randomMovie)}
                  <h3>{randomMovie.title}</h3>
                  <p className="muted">{randomMovie.release_year}</p>
                  <p>{randomMovie.overview}</p>
                  <button
                    className="primary"
                    disabled={busy || randomLoading}
                    onClick={() => this.nominateTmdb(randomMovie.tmdb_id)}
                  >
                    {this.t('randomAccept')}
                  </button>
                </article>
              )}
            </div>
            <button disabled={busy} onClick={() => this.cancelRandom()}>
              {this.t('cancel')}
            </button>
          </dialog>
        )}
      </section>
    )
  }
  private nominate(movieId: number | null): void {
    const week: string | undefined = this.state.round?.week
    if (!week) return
    void this.perform(async (): Promise<void> => {
      const round: Serialized<RoundState> = await this.props.container.api.request(
        `/rounds/${week}/response`,
        'PUT',
        { movieId },
      )
      this.setState({ round, message: 'nominated' })
    })
  }
  private draw(): void {
    const week: string | undefined = this.state.round?.week
    if (!week) return
    void this.perform(async (): Promise<void> => {
      const round: Serialized<RoundState> = await this.props.container.api.request(
        `/rounds/${week}/draw`,
        'POST',
      )
      clearTimeout(this.spinTimer)
      const reducedMotion: boolean = matchMedia('(prefers-reduced-motion: reduce)').matches
      this.setState({ round, spinning: true }, (): void => {
        this.roulette.current?.scrollIntoView({
          block: 'center',
          behavior: reducedMotion ? 'auto' : 'smooth',
        })
      })
      this.spinTimer = setTimeout(
        (): void => {
          this.setState({ spinning: false })
        },
        reducedMotion ? 0 : 4400,
      )
    })
  }
  private submitMovie(event: FormEvent<HTMLFormElement>): void {
    event.preventDefault()
    const form: HTMLFormElement = event.currentTarget
    const data: FormData = new FormData(form)
    void this.perform(async (): Promise<void> => {
      await this.props.container.api.request('/movies', 'POST', {
        title: data.get('title'),
        releaseYear: data.get('year') ? Number(data.get('year')) : null,
      })
      form.reset()
      this.setState({ message: 'submitted' })
      await this.search(this.state.query)
      this.loadDiscovery()
    })
  }
  private importMovie(tmdbId: number): void {
    void this.perform(async (): Promise<void> => {
      await this.props.container.api.request(`/movies?language=${this.state.language}`, 'POST', {
        tmdbId,
      })
      this.setState({ message: 'submitted' })
      await this.search(this.state.query)
      this.loadDiscovery()
    })
  }
  private openMovie(id: number): void {
    void this.perform(async (): Promise<void> => {
      const detail: Detail = await this.props.container.api.request(`/movies/${id}`)
      this.setState({ detail }, (): void => {
        if (!this.dialog.current?.open) this.dialog.current?.showModal()
      })
    })
  }
  private closeDetail(): void {
    this.dialog.current?.close()
    this.setState({ detail: null })
  }
  private watched(): void {
    const id: number | undefined = this.state.detail?.movie.id
    if (!id) return
    void this.perform(async (): Promise<void> => {
      await this.props.container.api.request(`/movies/${id}/watched`, 'PUT', {})
      this.setState({ detail: await this.props.container.api.request<Detail>(`/movies/${id}`) })
    })
  }
  private review(event: FormEvent<HTMLFormElement>): void {
    event.preventDefault()
    const data: FormData = new FormData(event.currentTarget)
    const id: number | undefined = this.state.detail?.movie.id
    if (!id) return
    void this.perform(async (): Promise<void> => {
      await this.props.container.api.request(`/movies/${id}/review`, 'PUT', {
        rating: Number(data.get('rating')),
        text: data.get('text'),
      })
      const detail = await this.props.container.api.request<Detail>(`/movies/${id}`)
      this.setState((state) => ({
        detail,
        reviewed: state.reviewed.map((entry) =>
          entry.movie.id === id ? { ...entry, reviews: detail.reviews } : entry,
        ),
      }))
    })
  }
  private async loadHistory(more: boolean): Promise<void> {
    await this.perform(async (): Promise<void> => {
      const rows: Serialized<HistoryEntry>[] = await this.props.container.api.request(
        `/rounds?limit=30&offset=${more ? this.state.history.length : 0}`,
      )
      this.setState((state) => ({ history: more ? [...state.history, ...rows] : rows }))
    })
  }
  private async loadReviews(more: boolean): Promise<void> {
    const userId = this.state.user?.id
    await this.perform(async (): Promise<void> => {
      const rows: Serialized<ReviewedMovie>[] = await this.props.container.api.request(
        `/movies/reviews?limit=30&offset=${more ? this.state.reviewed.length : 0}`,
      )
      if (this.state.user?.id === userId)
        this.setState((state) => ({ reviewed: more ? [...state.reviewed, ...rows] : rows }))
    })
  }
  private async loadAdmin(): Promise<void> {
    const userId: number | undefined = this.state.user?.id
    await this.perform(async (): Promise<void> => {
      const [pending, accounts] = await Promise.all([
        this.props.container.api.request<Film[]>('/admin/movies/pending?limit=100'),
        this.props.container.api.request<User[]>('/admin/users'),
      ])
      if (this.state.user?.id === userId && this.state.user?.is_admin)
        this.setState({ pending, accounts })
    })
  }
  private updateMovie(id: number, patch: MoviePatch): void {
    void this.perform(async (): Promise<void> => {
      const movie: Film = await this.props.container.api.request(
        `/admin/movies/${id}`,
        'PATCH',
        patch,
      )
      this.setState((state) => ({
        pending: state.pending.filter((m) => m.id !== id),
        detail: state.detail ? { ...state.detail, movie } : null,
      }))
      await this.refreshRound()
      await this.search(this.state.query)
      this.loadDiscovery()
    })
  }
  private editMovie(event: FormEvent<HTMLFormElement>, id: number): void {
    event.preventDefault()
    const data: FormData = new FormData(event.currentTarget)
    this.updateMovie(id, {
      title: String(data.get('title')),
      releaseYear: data.get('year') ? Number(data.get('year')) : null,
      overview: String(data.get('overview')),
      ...(data.get('tmdbId') ? { tmdbId: Number(data.get('tmdbId')) } : {}),
    })
  }
  private mergeMovie(event: FormEvent<HTMLFormElement>, id: number): void {
    event.preventDefault()
    const data: FormData = new FormData(event.currentTarget)
    void this.perform(async (): Promise<void> => {
      await this.props.container.api.request(`/admin/movies/${id}/merge`, 'POST', {
        targetId: Number(data.get('targetId')),
      })
      this.closeDetail()
      this.setState((state) => ({ pending: state.pending.filter((m) => m.id !== id) }))
      await this.search(this.state.query)
      this.loadDiscovery()
    })
  }
  private resetLink(id: number): void {
    void this.perform(async (): Promise<void> => {
      const result: { url: string; expiresAt: string } = await this.props.container.api.request(
        `/admin/users/${id}/reset`,
        'POST',
      )
      const output: HTMLInputElement | null = document.querySelector(`#reset-${id}`)
      if (output) {
        output.value = result.url
        output.focus()
        output.select()
      }
    })
  }
  private renderPoster(movie: Pick<Film, 'title' | 'poster_path'>): ReactNode {
    return movie.poster_path ? (
      <img
        src={`https://image.tmdb.org/t/p/w342${movie.poster_path}`}
        alt={movie.title}
        loading="lazy"
      />
    ) : (
      <div className="poster-fallback" aria-hidden="true">
        ▦
      </div>
    )
  }
  private renderCard(movie: Film): ReactNode {
    const canNominate: boolean =
      !this.state.user?.is_admin &&
      this.state.round?.status === 'collecting' &&
      movie.eligible &&
      movie.approval_status === 'approved'
    return (
      <article className="movie-card" key={movie.id}>
        <button className="poster-button" onClick={(): void => this.openMovie(movie.id)}>
          {this.renderPoster(movie)}
        </button>
        <h3>
          <button className="text-button" onClick={(): void => this.openMovie(movie.id)}>
            {movie.title}
          </button>
        </h3>
        <p className="muted">
          {movie.release_year} · #{movie.id}
        </p>
        <span className="badge">{this.t(movie.approval_status)}</span>
        {!movie.eligible && <p className="muted">{this.t('excluded')}</p>}
        {canNominate && (
          <button disabled={this.state.busy} onClick={(): void => this.nominate(movie.id)}>
            {this.t('nominate')}
          </button>
        )}
      </article>
    )
  }
  private renderRemoteCard(movie: MovieMetadata): ReactNode {
    const canNominate = !this.state.user?.is_admin && this.state.round?.status === 'collecting'
    return (
      <article className="movie-card" key={`tmdb-${movie.tmdb_id}`}>
        {this.renderPoster(movie)}
        <h3>{movie.title}</h3>
        <p className="muted">{movie.release_year} · TMDB</p>
        <button
          disabled={this.state.busy}
          onClick={(): void =>
            canNominate ? this.nominateTmdb(movie.tmdb_id) : this.importMovie(movie.tmdb_id)
          }
        >
          {this.t(canNominate ? 'nominate' : 'import')}
        </button>
      </article>
    )
  }
  private renderBrowseRow(category: MovieCategory): ReactNode {
    const result = this.state.browse[category]
    const pinned = category === 'popular' ? this.state.browse.featured : undefined
    const localMovies = [...(result?.local ?? []), ...(pinned?.local ?? [])]
    const remoteMovies = [
      ...new Map(
        [...(pinned?.remote ?? []), ...(result?.remote ?? [])].map((movie) => [
          movie.tmdb_id,
          movie,
        ]),
      ).values(),
    ]
    const loading = this.state.browseLoading[category] ?? false
    return (
      <section
        className={`browse-section ${category === 'popular' ? 'featured-section' : ''}`}
        key={category}
        aria-labelledby={`browse-${category}`}
      >
        <h2 id={`browse-${category}`}>{this.t(category)}</h2>
        <div className="movie-row" role="region" aria-label={this.t(category)} tabIndex={0}>
          {category === 'recentlyAdded'
            ? localMovies.map((movie) => this.renderCard(movie))
            : remoteMovies.map((movie) => {
                const local = localMovies.find((local) => local.tmdb_id === movie.tmdb_id)
                return local ? this.renderCard(local) : this.renderRemoteCard(movie)
              })}
        </div>
        {(!result || loading) && (
          <p role="status" className="muted">
            {this.t('loading')}
          </p>
        )}
        {result?.remoteError && (
          <p role="status" className="muted">
            {this.props.container.i18n.error(result.remoteError)}
          </p>
        )}
        {result &&
          !loading &&
          !result.remoteError &&
          !localMovies.length &&
          !remoteMovies.length && <p className="muted">{this.t('noMovies')}</p>}
        {result && (result.remoteError || result.page < result.totalPages) && (
          <button
            disabled={loading}
            onClick={() => {
              void this.loadBrowse(category, result.page > 0 && result.page < result.totalPages)
            }}
          >
            {this.t(result.remoteError ? 'retry' : 'more')}
          </button>
        )}
      </section>
    )
  }
  private renderDiscovery(): ReactNode {
    const favorites: MovieCategory[] = [
      'romanticComedy',
      'horror',
      'comedy',
      'barbie',
      'animation',
      'recentlyAdded',
      'newReleases',
    ]
    const genres: MovieCategory[] = [
      'action',
      'scienceFiction',
      'drama',
      'thriller',
      'adventure',
      'fantasy',
      'romance',
    ]
    return (
      <div className="discovery">
        {favorites.map((category) => this.renderBrowseRow(category))}
        <label className="genre-picker">
          {this.t('browseGenre')}
          <select
            aria-label={this.t('browseGenre')}
            value={this.state.genre}
            onChange={(event) => {
              const genre = event.target.value as MovieCategory
              this.setState({ genre })
              void this.loadBrowse(genre)
            }}
          >
            {genres.map((genre) => (
              <option key={genre} value={genre}>
                {this.t(genre)}
              </option>
            ))}
          </select>
        </label>
        {this.renderBrowseRow(this.state.genre)}
      </div>
    )
  }
  private renderSearch(): ReactNode {
    return (
      <section className="catalogue-section" id="movie-catalogue">
        {this.renderRandom()}
        <h2>{this.t('search')}</h2>
        <label>
          {this.t('search')}
          <input
            type="search"
            value={this.state.query}
            placeholder={this.t('searchHint')}
            onChange={this.searchChanged.bind(this)}
          />
        </label>
        {this.state.search.remoteError && (
          <p role="status" className="muted">
            {this.t(
              this.state.search.remoteError === 'TMDB_NOT_CONFIGURED'
                ? 'TMDB_NOT_CONFIGURED'
                : 'tmdbWarning',
            )}
          </p>
        )}
        <div className="movie-grid">
          {this.state.search.local.map((movie) => this.renderCard(movie))}
        </div>
        {!this.state.search.local.length && <p className="muted">{this.t('noMovies')}</p>}
        {this.state.search.local.length >= 30 && (
          <button
            onClick={(): void => {
              void this.search(this.state.query, true)
            }}
          >
            {this.t('more')}
          </button>
        )}
        <div className="movie-grid">
          {this.state.search.remote
            .filter(
              (movie) => !this.state.search.local.some((local) => local.tmdb_id === movie.tmdb_id),
            )
            .map((movie) => this.renderRemoteCard(movie))}
        </div>
        <details>
          <summary>{this.t('addMovie')}</summary>
          <form onSubmit={this.submitMovie.bind(this)}>
            <label>
              {this.t('title')}
              <input name="title" required maxLength={300} />
            </label>
            <label>
              {this.t('year')}
              <input name="year" type="number" min={1870} max={2200} />
            </label>
            <button disabled={this.state.busy}>{this.t('submit')}</button>
          </form>
        </details>
      </section>
    )
  }
  private renderRoulette(round: Serialized<RoundState>): ReactNode {
    const entries = round.responses.filter((response) => response.movie_id !== null)
    const winnerIndex = entries.findIndex((response) => response.movie_id === round.winner_id)
    if (!entries.length || winnerIndex < 0) return null
    const wedges = Array.from({ length: 8 }, (_, index) => entries[index % entries.length]!)
    const angle: number = 360 / wedges.length
    const colors: string[] = [
      '#ffca3a',
      '#ff6b8a',
      '#55ddeb',
      '#a8f05a',
      '#bd8aff',
      '#ff934f',
      '#62a8ff',
      '#ff82d2',
    ]
    const sectors: string = wedges
      .map(
        (_, index) =>
          `${colors[index % colors.length]} ${index * angle}deg ${(index + 1) * angle}deg`,
      )
      .join(', ')
    const rotation: number = 2160 - (winnerIndex + 0.5) * angle
    return (
      <div className="roulette" ref={this.roulette} role="status" aria-label={this.t('drawing')}>
        <p className="eyebrow">{this.t('drawing')}</p>
        <div className="roulette-stage">
          <svg
            className="roulette-wheel"
            viewBox="0 0 320 320"
            aria-hidden="true"
            style={{
              background: `conic-gradient(${sectors})`,
              transform: `rotate(${rotation}deg)`,
            }}
          >
            {wedges.map((entry, index) => {
              const title: string = entry.title ?? ''
              return (
                <g key={index}>
                  <title>{title}</title>
                  <line
                    className="roulette-divider"
                    x1="160"
                    y1="160"
                    x2="160"
                    y2="0"
                    transform={`rotate(${index * angle} 160 160)`}
                  />
                  <text
                    x="298"
                    y="160"
                    textAnchor="end"
                    dominantBaseline="middle"
                    textLength={title.length > 14 ? 100 : undefined}
                    lengthAdjust="spacingAndGlyphs"
                    transform={`rotate(${(index + 0.5) * angle - 90} 160 160)`}
                  >
                    {title.length > 18 ? `${title.slice(0, 17)}…` : title}
                  </text>
                </g>
              )
            })}
          </svg>
          <div className="roulette-hub" aria-hidden="true">
            ★
          </div>
        </div>
      </div>
    )
  }
  private renderWeek(): ReactNode {
    const round: Serialized<RoundState> | null = this.state.round
    if (!round) return <p>{this.t('loading')}</p>
    return (
      <>
        {this.renderWelcome()}
        {this.renderBrowseRow('popular')}
        <section className="party-panel" aria-label={this.t('party')}>
          <div className="party-heading">
            <span className="party-icon" aria-hidden="true">
              ◆
            </span>
            <h2>{this.t('party')}</h2>
          </div>
          <div className="participants">
            {round.members.map((member, index) => {
              const response = round.responses.find((r) => r.user_id === member.id)
              return (
                <div className={`participant ${response ? 'done' : ''}`} key={member.id}>
                  <span className={`avatar avatar-${index % 4}`} aria-hidden="true">
                    {member.username.slice(0, 1)}
                  </span>
                  <strong>{member.username}</strong>
                  <small>
                    {response ? (response.title ?? this.t('skipLabel')) : this.t('waiting')}
                  </small>
                </div>
              )
            })}
          </div>
          <div className="party-progress">
            <strong>
              {round.responses.length} / {round.members.length}
            </strong>
            <span>{this.t('responsesReady')}</span>
            <progress
              aria-label={this.t('responsesReady')}
              value={round.responses.length}
              max={Math.max(round.members.length, 1)}
            />
          </div>
        </section>
        <section className="round-panel">
          <div className="round-heading">
            <div>
              <p className="eyebrow">{round.week}</p>
              <h2>
                {this.t(
                  this.state.spinning
                    ? 'drawing'
                    : round.status === 'selected'
                      ? 'selected'
                      : round.status,
                )}
              </h2>
            </div>
            <p className="muted">{this.t('resetTime')}</p>
          </div>
          {round.status === 'collecting' && !this.state.user?.is_admin && (
            <button disabled={this.state.busy} onClick={(): void => this.nominate(null)}>
              {this.t('skip')}
            </button>
          )}
          {round.status === 'ready' && (
            <button
              className="primary draw"
              disabled={this.state.busy}
              onClick={this.draw.bind(this)}
            >
              {this.t('draw')}
            </button>
          )}
          {this.state.spinning && this.renderRoulette(round)}
          {round.winner && !this.state.spinning && (
            <div className="winner" role="status">
              {this.renderCard(round.winner)}
              <button disabled={this.state.busy} onClick={this.draw.bind(this)}>
                {this.t('replayRoulette')}
              </button>
            </div>
          )}
        </section>
        {this.renderSearch()}
        {this.renderDiscovery()}
      </>
    )
  }
  private renderWelcome(): ReactNode {
    return (
      <section className="hero">
        <div className="hero-copy">
          <p className="eyebrow">{this.t('heroEyebrow')}</p>
          <h1>{this.t('heroTitle')}</h1>
          <p className="hero-description">{this.t('heroDescription')}</p>
          {this.state.user && (
            <div className="hero-actions">
              {!this.state.user.is_admin && (
                <button
                  className="primary"
                  onClick={(): void => {
                    document.getElementById('movie-catalogue')?.scrollIntoView({
                      behavior: matchMedia('(prefers-reduced-motion: reduce)').matches
                        ? 'instant'
                        : 'smooth',
                      block: 'start',
                    })
                    document
                      .querySelector<HTMLInputElement>('#movie-catalogue input[type="search"]')
                      ?.focus({ preventScroll: true })
                  }}
                >
                  <span aria-hidden="true">▶</span> {this.t('nominateMovie')}
                </button>
              )}
              <button className="secondary" onClick={(): void => this.navigate('catalogue')}>
                {this.t('browseCatalogue')}
              </button>
            </div>
          )}
        </div>
      </section>
    )
  }
  private renderHistory(): ReactNode {
    return (
      <section>
        <h1>{this.t('history')}</h1>
        {!this.state.history.length && <p>{this.t('emptyHistory')}</p>}
        {this.state.history.map((row) => (
          <article className="history-row" key={row.week}>
            <time>{row.week}</time>
            {row.winner ? (
              <button className="text-button" onClick={(): void => this.openMovie(row.winner!.id)}>
                {row.winner.title}
              </button>
            ) : (
              <span className="muted">{this.t('noWinner')}</span>
            )}
          </article>
        ))}
        {this.state.history.length >= 30 && (
          <button
            disabled={this.state.busy}
            onClick={(): void => {
              void this.loadHistory(true)
            }}
          >
            {this.t('more')}
          </button>
        )}
      </section>
    )
  }
  private renderReviews(): ReactNode {
    return (
      <section>
        <h1>{this.t('reviews')}</h1>
        {!this.state.reviewed.length && (
          <p className="muted">{this.t(this.state.busy ? 'loading' : 'noReviews')}</p>
        )}
        {this.state.reviewed.map(({ movie, reviews }) => (
          <section
            className="reviewed-movie"
            key={movie.id}
            aria-labelledby={`reviewed-${movie.id}`}
          >
            <div className="reviewed-movie-heading">
              {this.renderPoster(movie)}
              <div>
                <h2 id={`reviewed-${movie.id}`}>
                  {movie.title} <small>{movie.release_year}</small>
                </h2>
                <button onClick={() => this.openMovie(movie.id)}>{this.t('rateMovie')}</button>
              </div>
            </div>
            {reviews.map((review) => this.renderReview(review))}
          </section>
        ))}
        {this.state.reviewed.length >= 30 && (
          <button
            disabled={this.state.busy}
            onClick={() => {
              void this.loadReviews(true)
            }}
          >
            {this.t('more')}
          </button>
        )}
      </section>
    )
  }
  private renderAdmin(): ReactNode {
    if (!this.state.user?.is_admin) return this.renderWeek()
    return (
      <section>
        <h1>{this.t('admin')}</h1>
        <h2>{this.t('pending')}</h2>
        <div className="movie-grid">
          {this.state.pending.map((movie) => this.renderCard(movie))}
        </div>
        <h2>{this.t('accounts')}</h2>
        {this.state.accounts.map((user) => (
          <article className="account" key={user.id}>
            <strong>{user.name}</strong>
            <span>@{user.username}</span>
            {user.email && <span>{user.email}</span>}
            <button disabled={this.state.busy} onClick={(): void => this.resetLink(user.id)}>
              {this.t('resetLink')}
            </button>
            <label>
              {this.t('copyHint')}
              <input id={`reset-${user.id}`} readOnly />
            </label>
          </article>
        ))}
      </section>
    )
  }
  private renderReview(review: Serialized<Review>): ReactNode {
    return (
      <article className="review" key={review.user_id}>
        <strong>{review.name}</strong>
        <span role="img" aria-label={`${review.rating}/5`}>
          {[1, 2, 3, 4, 5].map((n) => (
            <span className="rating-diamond" key={n} aria-hidden="true">
              <img
                src="/art/diamond.png"
                alt=""
                style={{
                  clipPath: `inset(0 ${100 - Math.max(0, Math.min(1, review.rating - n + 1)) * 100}% 0 0)`,
                }}
              />
            </span>
          ))}
        </span>
        <p>{review.text}</p>
      </article>
    )
  }
  private renderDetail(): ReactNode {
    const detail: Detail | null = this.state.detail
    if (!detail) return null
    const { movie, reviews, watched } = detail
    const mine = reviews.find((r) => r.user_id === this.state.user?.id)
    const seen: boolean = watched.some((w) => w.user_id === this.state.user?.id)
    return (
      <>
        <button className="close" onClick={this.closeDetail.bind(this)}>
          {this.t('close')} ×
        </button>
        <h2>
          {movie.title} <small>{movie.release_year}</small>
        </h2>
        <p className="muted">
          {this.t('movieId')}: {movie.id} · {this.t(movie.approval_status)}
        </p>
        <p>{movie.overview}</p>
        <p>
          {this.t('watchedBy')}: {watched.map((w) => w.name).join(', ') || '—'}
        </p>
        {!seen && movie.approval_status === 'approved' && (
          <button disabled={this.state.busy} onClick={this.watched.bind(this)}>
            {this.t('watched')}
          </button>
        )}
        <h3>{this.t('reviews')}</h3>
        {reviews.length ? (
          reviews.map((review) => this.renderReview(review))
        ) : (
          <p className="muted">{this.t('noReviews')}</p>
        )}
        {seen ? (
          <form key={`${movie.id}-${mine?.updated_at ?? 'new'}`} onSubmit={this.review.bind(this)}>
            <fieldset className="diamond-picker" disabled={this.state.busy}>
              <legend>{this.t('rating')}</legend>
              {Array.from({ length: 10 }, (_, index) => (index + 1) / 2).map((rating) => (
                <label key={rating} title={`${rating}/5`}>
                  <input
                    type="radio"
                    name="rating"
                    value={rating}
                    aria-label={`${rating}/5`}
                    defaultChecked={rating === mine?.rating}
                    required
                  />
                  <span className="diamond-half" aria-hidden="true" />
                </label>
              ))}
            </fieldset>
            <label>
              {this.t('review')}
              <textarea name="text" maxLength={10000} defaultValue={mine?.text ?? ''} />
            </label>
            <button disabled={this.state.busy}>{this.t('saveReview')}</button>
          </form>
        ) : (
          <p className="muted">{this.t('watchFirst')}</p>
        )}
        {this.state.user?.is_admin && (
          <details>
            <summary>{this.t('edit')}</summary>
            <form
              key={`${movie.id}-${movie.title}`}
              onSubmit={(event: FormEvent<HTMLFormElement>): void =>
                this.editMovie(event, movie.id)
              }
            >
              <label>
                {this.t('title')}
                <input name="title" required defaultValue={movie.title} maxLength={300} />
              </label>
              <label>
                {this.t('year')}
                <input
                  name="year"
                  type="number"
                  min={1870}
                  max={2200}
                  defaultValue={movie.release_year ?? ''}
                />
              </label>
              <label>
                {this.t('overview')}
                <textarea name="overview" defaultValue={movie.overview} maxLength={20000} />
              </label>
              <label>
                {this.t('tmdbId')}
                <input name="tmdbId" type="number" min={1} />
              </label>
              <button disabled={this.state.busy}>{this.t('save')}</button>
            </form>
            {movie.approval_status !== 'approved' && (
              <button
                disabled={this.state.busy}
                onClick={(): void => this.updateMovie(movie.id, { approvalStatus: 'approved' })}
              >
                {this.t('approve')}
              </button>
            )}
            {movie.approval_status === 'pending' && (
              <button
                disabled={this.state.busy}
                onClick={(): void => this.updateMovie(movie.id, { approvalStatus: 'rejected' })}
              >
                {this.t('reject')}
              </button>
            )}
            <button
              disabled={this.state.busy}
              onClick={(): void => this.updateMovie(movie.id, { eligible: !movie.eligible })}
            >
              {this.t(movie.eligible ? 'exclude' : 'allow')}
            </button>
            {movie.approval_status === 'pending' && (
              <form
                onSubmit={(event: FormEvent<HTMLFormElement>): void =>
                  this.mergeMovie(event, movie.id)
                }
              >
                <label>
                  {this.t('targetId')}
                  <input name="targetId" type="number" min={1} required />
                </label>
                <button disabled={this.state.busy}>{this.t('merge')}</button>
              </form>
            )}
          </details>
        )}
      </>
    )
  }
  private renderLogin(): ReactNode {
    return (
      <div className="auth-layout">
        {this.renderWelcome()}
        <section className="auth-panel">
          <p className="eyebrow">MAINFLIX</p>
          <h1>{this.t(this.state.resetToken ? 'resetPassword' : 'login')}</h1>
          <form onSubmit={this.state.resetToken ? this.password.bind(this) : this.login.bind(this)}>
            {!this.state.resetToken && (
              <label>
                {this.t('loginIdentifier')}
                <input
                  name="identifier"
                  type="text"
                  autoComplete="username"
                  autoCapitalize="none"
                  spellCheck={false}
                  required
                  maxLength={254}
                />
              </label>
            )}
            <label>
              {this.t(this.state.resetToken ? 'newPassword' : 'password')}
              <input
                name="password"
                type="password"
                minLength={this.state.resetToken ? 6 : 1}
                maxLength={128}
                autoComplete={this.state.resetToken ? 'new-password' : 'current-password'}
                required
              />
            </label>
            <button className="primary" disabled={this.state.busy}>
              {this.t(this.state.resetToken ? 'save' : 'login')}
            </button>
          </form>
          {!this.state.resetToken && <p className="muted">{this.t('forgot')}</p>}
        </section>
      </div>
    )
  }
  override render(): ReactNode {
    return (
      <>
        <header>
          <a className="brand" href="/">
            <img src="/art/mainflix-mark.webp" alt="" width="64" height="64" />
            MAIN<span>FLIX</span>
          </a>
          {this.state.user && (
            <nav aria-label="Mainflix">
              {(
                [
                  'week',
                  'catalogue',
                  'history',
                  'reviews',
                  ...(this.state.user.is_admin ? ['admin'] : []),
                ] as Tab[]
              ).map((tab) => (
                <button
                  aria-current={this.state.tab === tab ? 'page' : undefined}
                  key={tab}
                  onClick={(): void => this.navigate(tab)}
                >
                  {this.t(tab === 'admin' ? 'adminNav' : tab)}
                </button>
              ))}
            </nav>
          )}
          <select
            aria-label="Language / Idioma"
            value={this.state.language}
            onChange={this.language.bind(this)}
          >
            <option value="en">English</option>
            <option value="es">Español</option>
          </select>
          {this.state.user && (
            <button onClick={this.logout.bind(this)} disabled={this.state.busy}>
              {this.t('logout')}
            </button>
          )}
        </header>
        <main
          className={
            this.state.user && this.state.tab === 'week' && !this.state.resetToken
              ? 'week-page'
              : undefined
          }
        >
          {this.state.error && (
            <p className="notice error" role="alert">
              {this.props.container.i18n.error(this.state.error)}
            </p>
          )}
          {this.state.message && (
            <p className="notice" role="status">
              {this.t(this.state.message)}
            </p>
          )}
          {this.state.loading ? (
            <p>{this.t('loading')}</p>
          ) : this.state.resetToken || !this.state.user ? (
            this.renderLogin()
          ) : (
            <>
              {this.state.tab === 'week' ? (
                this.renderWeek()
              ) : this.state.tab === 'catalogue' ? (
                <>
                  {this.renderBrowseRow('popular')}
                  {this.renderSearch()}
                  {this.renderDiscovery()}
                </>
              ) : this.state.tab === 'history' ? (
                this.renderHistory()
              ) : this.state.tab === 'reviews' ? (
                this.renderReviews()
              ) : (
                this.renderAdmin()
              )}
              <details className="password-settings">
                <summary>{this.t('changePassword')}</summary>
                <form onSubmit={this.password.bind(this)}>
                  <label>
                    {this.t('currentPassword')}
                    <input
                      name="currentPassword"
                      type="password"
                      autoComplete="current-password"
                      required
                      maxLength={128}
                    />
                  </label>
                  <label>
                    {this.t('newPassword')}
                    <input
                      name="password"
                      type="password"
                      autoComplete="new-password"
                      minLength={6}
                      maxLength={128}
                      required
                    />
                  </label>
                  <button disabled={this.state.busy}>{this.t('save')}</button>
                </form>
              </details>
            </>
          )}
        </main>
        <footer>
          <p>{this.t('tagline')}</p>
          <a href="https://www.themoviedb.org/" target="_blank" rel="noreferrer">
            <img className="tmdb-logo" src="/tmdb-logo.svg" alt="TMDB" />
          </a>
          <small>{this.t('tmdbCredit')}</small>
        </footer>
        <dialog ref={this.dialog} onCancel={this.closeDetail.bind(this)}>
          {this.state.error && (
            <p className="notice error" role="alert">
              {this.props.container.i18n.error(this.state.error)}
            </p>
          )}
          {this.renderDetail()}
        </dialog>
      </>
    )
  }
}
