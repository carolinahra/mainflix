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
} from '../../backend/src/models/entities.js'

type Film = Serialized<Movie>
type Detail = { movie: Film } & Serialized<MovieReviews>
type Tab = 'week' | 'catalogue' | 'history' | 'admin'
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
  query: string
  detail: Detail | null
  history: Serialized<HistoryEntry>[]
  pending: Film[]
  accounts: User[]
  message: TranslationKey | null
  error: string | null
  resetToken: string | null
  language: Language
  spinning: boolean
}
export class Mainflix extends Component<Props, State> {
  private readonly dialog = createRef<HTMLDialogElement>()
  private readonly roulette = createRef<HTMLDivElement>()
  private poll: ReturnType<typeof setInterval> | undefined
  private debounce: ReturnType<typeof setTimeout> | undefined
  private spinTimer: ReturnType<typeof setTimeout> | undefined
  private searchController: AbortController | undefined
  override state: State = {
    loading: true,
    busy: false,
    user: null,
    round: null,
    tab: 'week',
    search: { local: [], remote: [], remoteError: null },
    query: '',
    detail: null,
    history: [],
    pending: [],
    accounts: [],
    message: null,
    error: null,
    resetToken: location.hash.startsWith('#reset=') ? location.hash.slice(7) : null,
    language: this.props.container.i18n.current,
    spinning: false,
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
    this.searchController?.abort()
  }
  private clearSession(): void {
    this.searchController?.abort()
    clearTimeout(this.debounce)
    clearTimeout(this.spinTimer)
    this.dialog.current?.close()
    this.setState({
      user: null,
      round: null,
      tab: 'week',
      query: '',
      search: { local: [], remote: [], remoteError: null },
      history: [],
      pending: [],
      accounts: [],
      detail: null,
      spinning: false,
    })
  }
  private async initialize(): Promise<void> {
    try {
      const user: User = await this.props.container.api.request('/auth/me')
      this.clearSession()
      this.setState({ user })
      await this.refreshRound()
      await this.search('')
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
    this.props.container.i18n.current = language
    this.setState({ language })
    if (this.state.user) void this.search(this.state.query)
  }
  private navigate(tab: Tab): void {
    this.setState({ tab, error: null, message: null })
    if (tab === 'history') void this.loadHistory(false)
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
    })
  }
  private importMovie(tmdbId: number): void {
    void this.perform(async (): Promise<void> => {
      await this.props.container.api.request(`/movies?language=${this.state.language}`, 'POST', {
        tmdbId,
      })
      this.setState({ message: 'submitted' })
      await this.search(this.state.query)
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
      this.setState({ detail: await this.props.container.api.request<Detail>(`/movies/${id}`) })
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
  private renderSearch(): ReactNode {
    return (
      <section className="catalogue-section" id="movie-catalogue">
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
            {this.t('tmdbWarning')}
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
            .map((movie: MovieMetadata) => (
              <article className="movie-card" key={`tmdb-${movie.tmdb_id}`}>
                {this.renderPoster(movie)}
                <h3>{movie.title}</h3>
                <p className="muted">{movie.release_year} · TMDB</p>
                <button
                  disabled={this.state.busy}
                  onClick={(): void => this.importMovie(movie.tmdb_id)}
                >
                  {this.t('import')}
                </button>
              </article>
            ))}
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
                    {member.name.slice(0, 1)}
                  </span>
                  <strong>{member.name}</strong>
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
          {round.status === 'collecting' && (
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
            <span>{user.email}</span>
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
          reviews.map((review) => (
            <article className="review" key={review.user_id}>
              <strong>{review.name}</strong>
              <span aria-label={`${review.rating}/5`}>
                {'★'.repeat(review.rating)}
                {'☆'.repeat(5 - review.rating)}
              </span>
              <p>{review.text}</p>
            </article>
          ))
        ) : (
          <p className="muted">{this.t('noReviews')}</p>
        )}
        {seen ? (
          <form key={`${movie.id}-${mine?.updated_at ?? 'new'}`} onSubmit={this.review.bind(this)}>
            <label>
              {this.t('rating')}
              <select name="rating" defaultValue={mine?.rating ?? 5}>
                {[1, 2, 3, 4, 5].map((n) => (
                  <option key={n} value={n}>
                    {'★'.repeat(n)}
                  </option>
                ))}
              </select>
            </label>
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
                minLength={this.state.resetToken ? 12 : 1}
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
              {this.state.tab === 'week'
                ? this.renderWeek()
                : this.state.tab === 'catalogue'
                  ? this.renderSearch()
                  : this.state.tab === 'history'
                    ? this.renderHistory()
                    : this.renderAdmin()}
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
                      minLength={12}
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
