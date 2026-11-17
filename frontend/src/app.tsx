import { Component, createRef, type ReactNode, type FormEvent, type ChangeEvent } from 'react'
import type { Container } from './container.js'
import { ApiException } from './api.js'
import type { TranslationKey, Language } from './i18n.js'
import type {
  Serialized,
  User,
  Group,
  Movie,
  MovieSearch,
  MovieMetadata,
  RoundView as RoundState,
  SurveyAction,
  HistoryEntry,
  MovieReviews,
  MoviePatch,
  MovieCategory,
  MovieBrowse,
  Review,
  ReviewedMovie,
  MovieWatchProviders,
  Member,
} from '../../backend/src/models/entities.js'

type Film = Serialized<Movie>
type Detail = { movie: Film; favorite: boolean } & Serialized<MovieReviews>
type Tab = 'week' | 'catalogue' | 'history' | 'reviews' | 'profile' | 'admin' | 'about'
interface Props {
  container: Container
}
interface State {
  groupMembers: Member[]
  groupAction: { type: 'delete' } | { type: 'kick'; member: Member } | null
  creatingGroup: boolean
  groups: Group[]
  group: Group | null
  inviteToken: string | null
  invitation: { groupName: string | null; expiresAt: string } | null
  invitationLogin: boolean
  invitationLink: { url: string; expiresAt: string } | null
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
  watchProviders: Record<number, MovieWatchProviders | null>
  history: Serialized<HistoryEntry>[]
  reviewed: Serialized<ReviewedMovie>[]
  myReviews: Serialized<ReviewedMovie>[]
  favorites: Film[]
  toReview: Film[]
  pending: Film[]
  accounts: User[]
  message: TranslationKey | null
  error: string | null
  resetToken: string | null
  language: Language
  spinning: boolean
  surveyRound: Serialized<RoundState> | null
  surveyIndex: number
  surveyDismissed: string | null
  randomOpen: boolean
  randomMovie: MovieMetadata | null
  randomLoading: boolean
  randomError: string | null
  randomCategory: MovieCategory
  randomFrom: string
  randomTo: string
}
export class Mainflix extends Component<Props, State> {
  private readonly profileMenu = createRef<HTMLDetailsElement>()
  private readonly dialog = createRef<HTMLDialogElement>()
  private readonly randomDialog = createRef<HTMLDialogElement>()
  private readonly roulette = createRef<HTMLDivElement>()
  private readonly surveyDialog = createRef<HTMLDialogElement>()
  private poll: ReturnType<typeof setInterval> | undefined
  private debounce: ReturnType<typeof setTimeout> | undefined
  private errorTimer: ReturnType<typeof setTimeout> | undefined
  private spinTimer: ReturnType<typeof setTimeout> | undefined
  private randomController: AbortController | undefined
  private searchController: AbortController | undefined
  private readonly browseControllers = new Map<MovieCategory, AbortController>()
  private readonly watchProviderObserver: IntersectionObserver | null =
    typeof IntersectionObserver === 'undefined'
      ? null
      : new IntersectionObserver(
          (entries) => {
            for (const entry of entries) {
              if (!entry.isIntersecting || !entry.target.isConnected) continue
              this.watchProviderObserver?.unobserve(entry.target)
              void this.loadWatchProviders(Number(entry.target.getAttribute('data-tmdb-id')))
            }
          },
          { rootMargin: '100px' },
        )
  override state: State = {
    groupMembers: [],
    groupAction: null,
    creatingGroup: false,
    groups: [],
    group: null,
    inviteToken: location.hash.startsWith('#invite=') ? location.hash.slice(8) : null,
    invitation: null,
    invitationLogin: false,
    invitationLink: null,
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
    watchProviders: {},
    history: [],
    reviewed: [],
    myReviews: [],
    favorites: [],
    toReview: [],
    pending: [],
    accounts: [],
    message: null,
    error: null,
    resetToken: location.hash.startsWith('#reset=') ? location.hash.slice(7) : null,
    language: this.props.container.i18n.current,
    spinning: false,
    surveyRound: null,
    surveyIndex: 0,
    surveyDismissed: null,
    randomOpen: false,
    randomMovie: null,
    randomLoading: false,
    randomError: null,
    randomCategory: 'popular',
    randomFrom: '',
    randomTo: '',
  }
  private get canVote(): boolean {
    return Boolean(this.state.group?.can_vote)
  }
  private get canManage(): boolean {
    return Boolean(this.state.group?.is_owner)
  }
  private async loadGroups(): Promise<void> {
    const groups = await this.props.container.api.request<Group[]>('/groups')
    this.setState({ groups })
  }
  private async selectGroup(group: Group): Promise<void> {
    const { user, groups } = this.state
    this.clearSession()
    this.props.container.api.groupId = group.id
    await new Promise<void>((resolve) => this.setState({ user, groups, group }, resolve))
    await this.refreshRound()
    await this.search('')
    this.loadDiscovery()
  }
  private chooseGroups(): void {
    const user = this.state.user
    this.clearSession()
    this.setState({ user }, () => {
      void this.perform(() => this.loadGroups())
    })
  }
  private createGroup(event: FormEvent<HTMLFormElement>): void {
    event.preventDefault()
    const name = new FormData(event.currentTarget).get('name')
    void this.perform(async () => {
      const group = await this.props.container.api.request<Group>('/groups', 'POST', { name })
      await this.loadGroups()
      await this.selectGroup(group)
    })
  }
  private invite(groupId?: number): void {
    this.profileMenu.current?.removeAttribute('open')
    this.setState({ invitationLink: null })
    void this.perform(async () => {
      const invitationLink = await this.props.container.api.request<{
        url: string
        expiresAt: string
      }>('/invitations', 'POST', groupId === undefined ? {} : { groupId })
      this.setState({ invitationLink })
    })
  }
  private finishInvitation(): void {
    history.replaceState(null, '', location.pathname + location.search)
    this.setState({ inviteToken: null, invitation: null, invitationLogin: false })
  }
  private register(event: FormEvent<HTMLFormElement>): void {
    event.preventDefault()
    const data = new FormData(event.currentTarget)
    void this.perform(async () => {
      const user = await this.props.container.api.request<User>('/auth/register', 'POST', {
        token: this.state.inviteToken,
        username: data.get('username'),
        password: data.get('password'),
      })
      this.clearSession()
      this.finishInvitation()
      this.setState({ user })
      await this.loadGroups()
    })
  }
  private acceptInvitation(): void {
    void this.perform(async () => {
      const groups = await this.props.container.api.request<Group[]>(
        `/invitations/${this.state.inviteToken}/accept`,
        'POST',
        {},
      )
      this.finishInvitation()
      this.setState({ groups })
    })
  }
  private renderInvitationLink(): ReactNode {
    const link = this.state.invitationLink
    if (!link) return null
    return (
      <section className="invitation-link" aria-live="polite">
        <label>
          {this.t('copyInvitation')}
          <input value={link.url} readOnly onFocus={(event) => event.currentTarget.select()} />
        </label>
        <p>
          {this.t('invitationExpires')}{' '}
          {new Date(link.expiresAt).toLocaleString(this.state.language)}
        </p>
        <button
          onClick={() => {
            void this.perform(async () => {
              await navigator.clipboard.writeText(link.url)
              this.setState({ message: 'invitationCopied' })
            })
          }}
        >
          {this.t('copyLink')}
        </button>
        <button onClick={() => this.setState({ invitationLink: null })}>{this.t('close')}</button>
      </section>
    )
  }
  private renderGroups(): ReactNode {
    return (
      <section className="groups-page">
        <p className="eyebrow">MAINFLIX</p>
        <h1>{this.t('chooseGroup')}</h1>
        <p className="groups-description">{this.t('groupsDescription')}</p>
        {!this.state.groups.length && <p>{this.t('firstGroup')}</p>}
        <div className="group-grid">
          {this.state.groups.map((group) => (
            <button
              className="group-card"
              key={group.id}
              disabled={this.state.busy}
              onClick={() => {
                void this.perform(() => this.selectGroup(group))
              }}
            >
              <span className="group-card-icon" aria-hidden="true">
                ▦
              </span>
              <span>{group.name}</span>
            </button>
          ))}
          <button
            className="create-group-circle"
            type="button"
            title={this.t('createNewGroup')}
            aria-label={this.t('createNewGroup')}
            aria-expanded={this.state.creatingGroup}
            aria-controls="create-group-form"
            disabled={this.state.busy}
            onClick={() => this.setState({ creatingGroup: true })}
          >
            <span aria-hidden="true">+</span>
          </button>
        </div>
        {this.state.creatingGroup && (
          <form id="create-group-form" onSubmit={this.createGroup.bind(this)}>
            <label>
              {this.t('groupName')}
              <input
                name="name"
                required
                maxLength={80}
                placeholder={this.t('groupNameExample')}
                autoFocus
              />
            </label>
            <button className="primary" disabled={this.state.busy}>
              {this.t('createGroup')}
            </button>
          </form>
        )}
        <button
          className="group-invite-button"
          disabled={this.state.busy}
          onClick={() => this.invite()}
        >
          {this.t('inviteToApp')}
        </button>
        {this.renderInvitationLink()}
      </section>
    )
  }
  private renderInvitation(): ReactNode {
    const invite = this.state.invitation
    return (
      <section className="auth-panel invitation-page">
        <h1>
          {invite?.groupName
            ? `${this.t('invitedToGroup')} ${invite.groupName}`
            : this.t('invitedToApp')}
        </h1>
        {invite && (
          <>
            <p>{this.t(invite.groupName ? 'groupInvitationHint' : 'appInvitationHint')}</p>
            {this.state.user ? (
              <>
                <p>
                  {this.t('signedInAs')} @{this.state.user.username}
                </p>
                <button
                  className="primary"
                  disabled={this.state.busy}
                  onClick={this.acceptInvitation.bind(this)}
                >
                  {this.t('acceptInvitation')}
                </button>
              </>
            ) : this.state.invitationLogin ? (
              this.renderLogin()
            ) : (
              <>
                <form onSubmit={this.register.bind(this)}>
                  <label>
                    {this.t('username')}
                    <input
                      name="username"
                      required
                      minLength={3}
                      maxLength={32}
                      pattern="[A-Za-z0-9_]{3,32}"
                      autoComplete="username"
                      autoCapitalize="none"
                      spellCheck={false}
                    />
                  </label>
                  <label>
                    {this.t('password')}
                    <input
                      name="password"
                      type="password"
                      required
                      minLength={6}
                      maxLength={128}
                      autoComplete="new-password"
                    />
                  </label>
                  <button className="primary" disabled={this.state.busy}>
                    {this.t('createAccount')}
                  </button>
                </form>
                <button onClick={() => this.setState({ invitationLogin: true })}>
                  {this.t('alreadyHaveAccount')}
                </button>
              </>
            )}
          </>
        )}
        <button
          onClick={() => {
            this.finishInvitation()
            if (this.state.user) void this.loadGroups()
          }}
        >
          {this.t('cancel')}
        </button>
      </section>
    )
  }
  private showError(code: string): void {
    clearTimeout(this.errorTimer)
    this.setState({ error: code })
    this.errorTimer = setTimeout(() => this.setState({ error: null }), 5000)
  }
  private renderErrorToast(): ReactNode {
    return this.state.error ? (
      <p className="notice error error-toast" role="alert" aria-atomic="true">
        {this.props.container.i18n.error(this.state.error)}
      </p>
    ) : null
  }
  private t(key: TranslationKey): string {
    return this.props.container.i18n.t(key)
  }
  override componentDidMount(): void {
    void this.initialize()
    window.addEventListener('hashchange', this.hashChanged)
    this.poll = setInterval((): void => {
      if (this.state.user && this.state.group && !document.hidden) void this.refreshRound()
    }, 5000)
  }
  private readonly hashChanged = (): void => {
    this.setState(
      {
        inviteToken: location.hash.startsWith('#invite=') ? location.hash.slice(8) : null,
        invitation: null,
        invitationLogin: false,
        error: null,
      },
      () => {
        void this.initialize()
      },
    )
  }
  override componentWillUnmount(): void {
    this.watchProviderObserver?.disconnect()
    window.removeEventListener('hashchange', this.hashChanged)
    clearInterval(this.poll)
    clearTimeout(this.debounce)
    clearTimeout(this.spinTimer)
    clearTimeout(this.errorTimer)
    this.randomController?.abort()
    this.searchController?.abort()
    this.browseControllers.forEach((controller) => controller.abort())
  }
  override componentDidUpdate(): void {
    const movies = [this.state.round?.winner, this.state.detail?.movie]
    for (const id of new Set(movies.flatMap((movie) => (movie?.tmdb_id ? [movie.tmdb_id] : []))))
      void this.loadWatchProviders(id)
  }
  private observeWatchProviders(element: HTMLElement | null): (() => void) | undefined {
    if (!element) return
    const id = Number(element.dataset.tmdbId)
    if (!id || Object.hasOwn(this.state.watchProviders, id)) return
    this.watchProviderObserver?.observe(element)
    return () => this.watchProviderObserver?.unobserve(element)
  }
  private async loadWatchProviders(id: number): Promise<void> {
    // shortcut: availability is cached for this group session; add expiry if live updates are needed.
    if (Object.hasOwn(this.state.watchProviders, id)) return
    const groupId = this.state.group?.id
    this.setState((state) => ({ watchProviders: { ...state.watchProviders, [id]: null } }))
    try {
      const providers = await this.props.container.api.request<MovieWatchProviders | null>(
        `/movies/providers/${id}`,
      )
      if (this.state.group?.id === groupId)
        this.setState((state) => ({ watchProviders: { ...state.watchProviders, [id]: providers } }))
    } catch (error: unknown) {
      if (error instanceof ApiException && error.status === 401) this.clearSession()
    }
  }
  private clearSession(): void {
    this.watchProviderObserver?.disconnect()
    this.props.container.api.groupId = null
    this.profileMenu.current?.removeAttribute('open')
    this.randomController?.abort()
    this.searchController?.abort()
    this.browseControllers.forEach((controller) => controller.abort())
    this.browseControllers.clear()
    clearTimeout(this.debounce)
    clearTimeout(this.spinTimer)
    clearTimeout(this.errorTimer)
    this.dialog.current?.close()
    this.randomDialog.current?.close()
    this.surveyDialog.current?.close()
    this.setState({
      user: null,
      groupMembers: [],
      groupAction: null,
      error: null,
      creatingGroup: false,
      groups: [],
      group: null,
      invitationLink: null,
      round: null,
      tab: 'week',
      query: '',
      search: { local: [], remote: [], remoteError: null },
      browse: {},
      browseLoading: {},
      genre: 'action',
      history: [],
      reviewed: [],
      myReviews: [],
      favorites: [],
      toReview: [],
      pending: [],
      accounts: [],
      detail: null,
      watchProviders: {},
      spinning: false,
      surveyRound: null,
      surveyIndex: 0,
      surveyDismissed: null,
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
      if (this.state.inviteToken) {
        const invitation = await this.props.container.api.request<{
          groupName: string | null
          expiresAt: string
        }>(`/invitations/${this.state.inviteToken}`)
        this.setState({ invitation })
      }
      const user = await this.props.container.api.request<User>('/auth/me')
      this.clearSession()
      this.setState({ user })
      await this.loadGroups()
    } catch (error: unknown) {
      if (!(
        error instanceof ApiException &&
        (error.status === 401 || error.code === 'STALE_REQUEST')
      ))
        this.showError(error instanceof ApiException ? error.code : 'genericError')
    } finally {
      this.setState({ loading: false })
    }
  }
  private async perform(work: () => Promise<void>): Promise<void> {
    this.setState({ busy: true, error: null, message: null })
    try {
      await work()
    } catch (error: unknown) {
      if (error instanceof ApiException && error.code === 'STALE_REQUEST') return
      if (
        error instanceof ApiException &&
        error.status === 401 &&
        error.code === 'AUTHENTICATION_REQUIRED'
      )
        this.clearSession()
      this.showError(error instanceof ApiException ? error.code : 'genericError')
      if (error instanceof ApiException && error.code.startsWith('ROUND_'))
        await this.refreshRound()
    } finally {
      this.setState({ busy: false })
    }
  }
  private async refreshRound(): Promise<void> {
    const previousRound = this.state.round
    const previousSurvey = this.state.surveyRound
    try {
      const round: Serialized<RoundState> =
        await this.props.container.api.request('/rounds/current')
      this.setState(
        (state) => ({
          round: state.round === previousRound ? round : state.round,
          surveyRound:
            state.surveyRound === previousSurvey && previousSurvey?.week === round.week
              ? round
              : state.surveyRound,
          group: state.group
            ? {
                ...state.group,
                can_vote: round.members.some((member) => member.id === state.user?.id),
              }
            : null,
        }),
        () => {
          const current = this.state.round
          if (
            !previousSurvey &&
            current?.survey?.eligible &&
            !current.survey.completed &&
            !this.state.surveyRound &&
            this.state.surveyDismissed !== current.week &&
            !this.state.spinning &&
            !this.state.detail &&
            !this.state.randomOpen &&
            this.state.tab === 'week'
          )
            this.openSurvey(current)
        },
      )
      const pendingSurvey = this.state.surveyRound
      if (pendingSurvey && pendingSurvey.week !== round.week) {
        const surveyRound = await this.props.container.api.request<Serialized<RoundState>>(
          `/rounds/${pendingSurvey.week}`,
        )
        this.setState((state) => ({
          surveyRound: state.surveyRound === pendingSurvey ? surveyRound : state.surveyRound,
        }))
      }
      if (this.state.tab === 'week') {
        const toReview: Film[] = await this.props.container.api.request('/movies/to-review')
        this.setState({ toReview })
      }
    } catch (error: unknown) {
      if (error instanceof ApiException && error.code === 'STALE_REQUEST') return
      if (error instanceof ApiException && error.status === 401) this.clearSession()
      else if (error instanceof ApiException && error.status === 403) this.chooseGroups()
      else this.showError(error instanceof ApiException ? error.code : 'genericError')
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
      await this.loadGroups()
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
      if (this.state.user && this.state.group) void this.search(this.state.query)
      this.browseControllers.forEach((controller) => controller.abort())
      this.setState({ browse: {}, browseLoading: {} }, () => this.loadDiscovery())
    })
  }
  private profile(event: FormEvent<HTMLFormElement>): void {
    event.preventDefault()
    const data = new FormData(event.currentTarget)
    void this.perform(() =>
      this.updateProfile({
        name: String(data.get('name')),
        username: String(data.get('username')),
      }),
    )
  }
  private async updateProfile(values: {
    name?: string
    username?: string
    avatar?: string | null
  }): Promise<void> {
    const userId = this.state.user?.id
    const user: User = await this.props.container.api.request('/auth/me', 'PATCH', values)
    if (this.state.user?.id !== userId) return
    this.setState((state) => ({
      user,
      message: 'profileSaved',
      myReviews: state.myReviews.map((entry) => ({
        ...entry,
        reviews: entry.reviews.map((review) => ({
          ...review,
          name: user.name,
          avatar: user.avatar,
        })),
      })),
    }))
    await this.refreshRound()
  }
  private uploadAvatar(event: ChangeEvent<HTMLInputElement>): void {
    const file = event.target.files?.[0]
    event.target.value = ''
    if (!file) return
    const userId = this.state.user?.id
    void this.perform(async () => {
      if (
        !['image/png', 'image/jpeg', 'image/webp'].includes(file.type) ||
        file.size > 20 * 1024 * 1024
      )
        throw new ApiException('invalidAvatar', 400)
      let image: ImageBitmap
      try {
        image = await createImageBitmap(file)
      } catch {
        throw new ApiException('invalidAvatar', 400)
      }
      try {
        const canvas = document.createElement('canvas')
        canvas.width = canvas.height = 128
        const context = canvas.getContext('2d')
        if (!context) throw new ApiException('invalidAvatar', 400)
        const size = Math.min(image.width, image.height)
        context.drawImage(
          image,
          (image.width - size) / 2,
          (image.height - size) / 2,
          size,
          size,
          0,
          0,
          128,
          128,
        )
        let avatar = canvas.toDataURL('image/webp', 0.8)
        // iPhone returns PNG when its canvas cannot encode WebP.
        if (!avatar.startsWith('data:image/webp;base64,'))
          avatar = canvas.toDataURL('image/jpeg', 0.8)
        if (!/^data:image\/(?:webp|jpeg);base64,/.test(avatar) || avatar.length > 21869)
          throw new ApiException('invalidAvatar', 400)
        if (this.state.user?.id === userId) await this.updateProfile({ avatar })
      } finally {
        image.close()
      }
    })
  }
  private async loadProfile(): Promise<void> {
    const userId = this.state.user?.id
    await this.perform(async () => {
      const [favorites, myReviews] = await Promise.all([
        this.props.container.api.request<Film[]>('/auth/favorites?limit=30'),
        this.props.container.api.request<Serialized<ReviewedMovie>[]>('/auth/reviews?limit=30'),
      ])
      if (this.state.user?.id === userId) this.setState({ favorites, myReviews })
    })
  }
  private async loadFavorites(): Promise<void> {
    const userId = this.state.user?.id
    await this.perform(async () => {
      const rows: Film[] = await this.props.container.api.request(
        `/auth/favorites?limit=30&offset=${this.state.favorites.length}`,
      )
      if (this.state.user?.id === userId)
        this.setState((state) => ({ favorites: [...state.favorites, ...rows] }))
    })
  }
  private async loadMyReviews(): Promise<void> {
    const userId = this.state.user?.id
    await this.perform(async () => {
      const rows: Serialized<ReviewedMovie>[] = await this.props.container.api.request(
        `/auth/reviews?limit=30&offset=${this.state.myReviews.length}`,
      )
      if (this.state.user?.id === userId)
        this.setState((state) => ({ myReviews: [...state.myReviews, ...rows] }))
    })
  }
  private favorite(movie: Film, favorite: boolean): void {
    const userId = this.state.user?.id
    void this.perform(async () => {
      if (movie.group_id !== this.state.group?.id) {
        const group = this.state.groups.find((group) => group.id === movie.group_id)
        if (group) {
          await this.selectGroup(group)
          await new Promise<void>((resolve) => this.setState({ tab: 'profile' }, resolve))
          await this.loadProfile()
        }
      }
      await this.props.container.api.request(
        `/movies/${movie.id}/favorite`,
        favorite ? 'PUT' : 'DELETE',
        {},
      )
      const favorites: Film[] = await this.props.container.api.request('/auth/favorites?limit=30')
      if (this.state.user?.id !== userId) return
      this.setState((state) => ({
        favorites,
        detail: state.detail?.movie.id === movie.id ? { ...state.detail, favorite } : state.detail,
        message: favorite ? 'favoriteAdded' : 'favoriteRemoved',
      }))
    })
  }
  private favoriteTmdb(tmdbId: number): void {
    const userId = this.state.user?.id
    void this.perform(async () => {
      const movie: Film = await this.props.container.api.request(
        `/movies/favorites?language=${this.state.language}`,
        'POST',
        { tmdbId },
      )
      if (this.state.user?.id !== userId) return
      this.setState((state) => ({
        favorites: [movie, ...state.favorites.filter((entry) => entry.id !== movie.id)],
        message: 'favoriteAdded',
      }))
      this.loadDiscovery()
    })
  }
  private navigate(tab: Tab): void {
    this.profileMenu.current?.removeAttribute('open')
    this.setState({ tab, error: null, message: null })
    if (tab === 'week') void this.refreshRound()
    if (tab === 'history') void this.loadHistory(false)
    if (tab === 'reviews') void this.loadReviews(false)
    if (tab === 'profile') void this.loadProfile()
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
        this.showError(error instanceof ApiException ? error.code : 'genericError')
    }
  }
  private loadDiscovery(): void {
    if (!this.state.user || !this.state.group) return
    const categories: MovieCategory[] = [
      'featured',
      'christmas',
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
      this.showError('VALIDATION_ERROR')
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
        this.showError(error instanceof ApiException ? error.code : 'genericError')
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
    if (!this.canVote || this.state.round?.status !== 'collecting') return null
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
            {this.renderErrorToast()}
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
          this.setState({ spinning: false }, () => {
            if (round.survey?.eligible && !round.survey.completed && !this.state.surveyRound)
              this.openSurvey(round)
          })
        },
        reducedMotion ? 0 : 4400,
      )
    })
  }
  private openSurvey(round: Serialized<RoundState>): void {
    if (!round.survey) return
    const unanswered = round.survey.questions.findIndex((question) => !question.answered)
    this.setState(
      {
        surveyRound: round,
        surveyIndex:
          round.survey.completed || !round.survey.eligible
            ? 0
            : unanswered < 0
              ? round.survey.questions.length - 1
              : unanswered,
      },
      () => {
        if (!this.surveyDialog.current?.open) this.surveyDialog.current?.showModal()
      },
    )
  }
  private closeSurvey(): void {
    this.surveyDialog.current?.close()
    this.setState({ surveyDismissed: this.state.surveyRound?.week ?? null, surveyRound: null })
  }
  private async saveSurvey(action: SurveyAction): Promise<void> {
    const week = this.state.surveyRound?.week
    if (!week) return
    const result = await this.props.container.api.request<Serialized<RoundState>>(
      `/rounds/${week}/survey`,
      'POST',
      action,
    )
    this.setState(
      (state) => ({
        surveyRound: state.surveyRound?.week === week ? result : state.surveyRound,
        round: state.round?.week === week ? result : state.round,
      }),
      () => {
        if (this.state.surveyRound?.week === week && ('finish' in action || 'skip' in action)) {
          this.surveyDialog.current?.scrollTo({ top: 0 })
          this.surveyDialog.current
            ?.querySelector<HTMLElement>('#survey-title')
            ?.focus({ preventScroll: true })
        }
      },
    )
  }
  private sendSurvey(event: FormEvent<HTMLFormElement>): void {
    event.preventDefault()
    const question = this.state.surveyRound?.survey?.questions[this.state.surveyIndex]
    if (!question) return
    const userIds = new FormData(event.currentTarget).getAll('userIds').map(Number)
    void this.perform(() => this.saveSurvey({ movieId: question.movieId, userIds }))
  }
  private nextSurvey(): void {
    const survey = this.state.surveyRound?.survey
    if (!survey) return
    if (this.state.surveyIndex < survey.questions.length - 1)
      this.setState({ surveyIndex: this.state.surveyIndex + 1 }, () => {
        this.surveyDialog.current?.querySelector<HTMLElement>('#survey-question')?.focus()
      })
    else if (survey.eligible && !survey.completed)
      void this.perform(() => this.saveSurvey({ finish: true }))
    else this.closeSurvey()
  }
  private renderReveal(round: Serialized<RoundState>): ReactNode {
    if (!round.revealed) return null
    return (
      <section className="nomination-reveal" aria-label={this.t('nominationReveal')}>
        <h3>{this.t('nominationReveal')}</h3>
        <ul>
          {round.responses.map((response) => (
            <li key={response.user_id}>
              <strong>
                {round.members.find((member) => member.id === response.user_id)?.username ??
                  response.name}
              </strong>
              {' · '}
              {response.title ?? this.t('skipLabel')}
            </li>
          ))}
        </ul>
      </section>
    )
  }
  private renderSurvey(): ReactNode {
    const round = this.state.surveyRound
    const survey = round?.survey
    const question = survey?.questions[this.state.surveyIndex]
    if (!round || !survey || !question) return null
    const completed = survey.completed || !survey.eligible
    const questions = completed ? survey.questions : [question]
    const finished = survey.participants.filter((participant) => participant.completed).length
    return (
      <dialog
        className="survey-dialog"
        ref={this.surveyDialog}
        aria-labelledby="survey-title"
        onCancel={this.closeSurvey.bind(this)}
      >
        {this.renderErrorToast()}
        <div className="survey-heading">
          <button
            className="close survey-close"
            aria-label={`${this.t('close')} ×`}
            onClick={this.closeSurvey.bind(this)}
          >
            ×
          </button>
          <div className="survey-kicker">
            <span>{this.t('surveyEyebrow')}</span>
            <span>{round.week}</span>
          </div>
          <h2 id="survey-title" tabIndex={-1}>
            {this.t(completed ? 'surveyResults' : 'guessNominations')}
          </h2>
          {completed ? (
            <>
              <p className="survey-subtitle">{this.t('surveyResultsIntro')}</p>
              <div className="survey-stats">
                <div>
                  <strong>{survey.questions.length}</strong>
                  <span>{this.t('surveyMovies')}</span>
                </div>
                <div>
                  <strong>{survey.participants.length}</strong>
                  <span>{this.t('surveyPeople')}</span>
                </div>
                <div>
                  <strong>
                    {finished}/{survey.participants.length}
                  </strong>
                  <span>{this.t('surveyFinished')}</span>
                </div>
              </div>
            </>
          ) : (
            <>
              <div className="survey-step">
                <span>
                  {this.t('surveyQuestion')} <strong>{this.state.surveyIndex + 1}</strong> /{' '}
                  {survey.questions.length}
                </span>
                <span>
                  {finished}/{survey.participants.length} {this.t('surveyFinished')}
                </span>
              </div>
              <progress
                className="survey-step-progress"
                aria-label={this.t('surveyProgress')}
                value={this.state.surveyIndex + 1}
                max={survey.questions.length}
              />
            </>
          )}
        </div>
        <div
          className={`survey-body${completed ? ' survey-overview' : ''}`}
          key={completed ? 'overview' : question.movieId}
        >
          {completed && (
            <p className={`survey-status${round.revealed ? ' is-revealed' : ''}`} role="status">
              <span className="survey-status-icon" aria-hidden="true">
                {round.revealed ? '✓' : '◷'}
              </span>
              <span>
                {this.t(
                  round.revealed
                    ? 'surveyRevealed'
                    : survey.completed
                      ? 'surveyWaiting'
                      : 'surveyPending',
                )}
              </span>
            </p>
          )}
          {questions.map((item, index) => {
            const headingId = completed ? `survey-result-${item.movieId}` : 'survey-question'
            const results = completed || item.options !== null
            return (
              <section className="survey-movie-card" aria-labelledby={headingId} key={item.movieId}>
                <div className="survey-movie-heading">
                  <span className="survey-movie-number" aria-hidden="true">
                    {String(completed ? index + 1 : this.state.surveyIndex + 1).padStart(2, '0')}
                  </span>
                  <div>
                    <p>
                      {completed
                        ? `${this.t('surveyAnswers')} · ${item.answerCount ?? 0}`
                        : this.t('whoNominated')}
                    </p>
                    <h3 id={headingId} tabIndex={-1}>
                      {item.title}
                    </h3>
                  </div>
                </div>
                {results ? (
                  <div className="survey-results" aria-live={completed ? 'off' : 'polite'}>
                    {(item.options ?? []).map((option) => {
                      const participant = survey.participants.find(
                        (participant) => participant.id === option.userId,
                      )
                      const nominated =
                        round.revealed &&
                        round.responses.some(
                          (response) =>
                            response.movie_id === item.movieId &&
                            response.user_id === option.userId,
                        )
                      const guessed = item.userIds?.includes(option.userId)
                      return (
                        <div
                          className={`survey-result${nominated ? ' is-nominator' : ''}`}
                          key={option.userId}
                        >
                          <img
                            src={participant?.avatar ?? '/art/creeper-avatar.png'}
                            alt=""
                            width="36"
                            height="36"
                          />
                          <div className="survey-result-copy">
                            <div className="survey-result-label">
                              <span>{participant?.username}</span>
                              <strong>{option.percentage}%</strong>
                            </div>
                            <progress
                              max="100"
                              value={option.percentage}
                              aria-label={`${participant?.username}: ${option.percentage}%`}
                            />
                            {(nominated || guessed) && (
                              <div className="survey-result-tags">
                                {nominated && (
                                  <span className="survey-nominator">
                                    {this.t('surveyNominated')}
                                  </span>
                                )}
                                {guessed && <span>{this.t('surveyYourGuess')}</span>}
                              </div>
                            )}
                          </div>
                        </div>
                      )
                    })}
                    {!completed && (
                      <>
                        <p className="survey-note">
                          {this.t('surveyAnswers')}: {item.answerCount ?? 0}.{' '}
                          {this.t('surveyPercentHint')}
                        </p>
                        {item.answered && item.userIds === null && (
                          <p className="survey-note">{this.t('surveyQuestionSkipped')}</p>
                        )}
                        <div className="survey-actions">
                          <button
                            className="primary"
                            disabled={this.state.busy}
                            onClick={this.nextSurvey.bind(this)}
                          >
                            {this.t(
                              this.state.surveyIndex < survey.questions.length - 1
                                ? 'surveyNext'
                                : 'surveyFinish',
                            )}
                            <span aria-hidden="true">→</span>
                          </button>
                        </div>
                      </>
                    )}
                  </div>
                ) : (
                  <form key={`${round.week}-${item.movieId}`} onSubmit={this.sendSurvey.bind(this)}>
                    <fieldset disabled={this.state.busy}>
                      <legend>{this.t('selectNames')}</legend>
                      <div className="survey-choices">
                        {survey.participants.map((participant) => (
                          <label className="survey-choice" key={participant.id}>
                            <input type="checkbox" name="userIds" value={participant.id} />
                            <img
                              src={participant.avatar ?? '/art/creeper-avatar.png'}
                              alt=""
                              width="52"
                              height="52"
                            />
                            <span>{participant.username}</span>
                          </label>
                        ))}
                      </div>
                    </fieldset>
                    <div className="survey-actions">
                      <button className="primary" disabled={this.state.busy}>
                        {this.t('surveySend')}
                        <span aria-hidden="true">→</span>
                      </button>
                      <button
                        type="button"
                        disabled={this.state.busy}
                        onClick={() => {
                          void this.perform(() =>
                            this.saveSurvey({ movieId: item.movieId, userIds: null }),
                          )
                        }}
                      >
                        {this.t('surveySkipQuestion')}
                      </button>
                    </div>
                  </form>
                )}
              </section>
            )
          })}
          {completed ? (
            <>
              <p className="survey-note">{this.t('surveyPercentHint')}</p>
              <button className="survey-done" onClick={this.closeSurvey.bind(this)}>
                {this.t('close')}
              </button>
            </>
          ) : (
            <button
              className="survey-skip"
              disabled={this.state.busy}
              onClick={() => {
                void this.perform(() => this.saveSurvey({ skip: true }))
              }}
            >
              {this.t('surveySkip')}
            </button>
          )}
        </div>
      </dialog>
    )
  }
  private renderAbout(): ReactNode {
    return (
      <section className="about-page" aria-labelledby="about-title">
        <p className="eyebrow">{this.t('tagline')}</p>
        <h1 id="about-title">{this.t('about')}</h1>
        <p className="about-intro">{this.t('aboutIntro')}</p>
        <ol className="about-steps">
          {(['Groups', 'Nominate', 'Draw', 'Survey', 'Review'] as const).map((step) => (
            <li key={step}>
              <h2>{this.t(`about${step}Title`)}</h2>
              <p>{this.t(`about${step}`)}</p>
            </li>
          ))}
        </ol>
        <section>
          <h2>{this.t('aboutMoreTitle')}</h2>
          <p>{this.t('aboutMore')}</p>
        </section>
        <p className="muted">{this.t('resetTime')}</p>
      </section>
    )
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
      const personalMovie =
        this.state.favorites.find((movie) => movie.id === id) ??
        this.state.myReviews.find((entry) => entry.movie.id === id)?.movie
      if (personalMovie && personalMovie.group_id !== this.state.group?.id) {
        const group = this.state.groups.find((group) => group.id === personalMovie.group_id)
        if (group) await this.selectGroup(group)
      }
      const detail: Detail = await this.props.container.api.request(
        `/movies/${id}?language=${this.state.language}`,
      )
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
      this.setState({
        detail: await this.props.container.api.request<Detail>(
          `/movies/${id}?language=${this.state.language}`,
        ),
      })
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
      const detail = await this.props.container.api.request<Detail>(
        `/movies/${id}?language=${this.state.language}`,
      )
      this.setState((state) => ({
        detail,
        reviewed: state.reviewed.map((entry) =>
          entry.movie.id === id
            ? { ...entry, reviews: detail.reviews, reviewsLocked: detail.reviewsLocked }
            : entry,
        ),
        myReviews: [
          {
            movie: detail.movie,
            reviews: detail.reviews.filter((review) => review.user_id === state.user?.id),
            reviewsLocked: false,
          },
          ...state.myReviews.filter((entry) => entry.movie.id !== id),
        ],
      }))
      if (this.state.tab === 'week') await this.refreshRound()
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
    const groupId = this.state.group?.id
    await this.perform(async (): Promise<void> => {
      const [pending, accounts, groupMembers] = await Promise.all([
        this.props.container.api.request<Film[]>('/admin/movies/pending?limit=100'),
        this.state.user?.is_admin
          ? this.props.container.api.request<User[]>('/admin/users')
          : Promise.resolve([]),
        this.props.container.api.request<Member[]>(`/groups/${groupId}/members`),
      ])
      if (this.state.user?.id === userId && this.state.group?.id === groupId && this.canManage)
        this.setState({ pending, accounts, groupMembers })
    })
  }
  private renameGroup(event: FormEvent<HTMLFormElement>): void {
    event.preventDefault()
    const id = this.state.group?.id
    if (!id || !this.canManage) return
    const name = new FormData(event.currentTarget).get('name')
    void this.perform(async () => {
      const group = await this.props.container.api.request<Group>(`/groups/${id}`, 'PATCH', {
        name,
      })
      if (this.state.group?.id === id)
        this.setState((state) => ({
          group,
          groups: state.groups.map((entry) => (entry.id === id ? group : entry)),
          message: 'groupRenamed',
        }))
    })
  }
  private confirmGroupAction(): void {
    const group = this.state.group
    const action = this.state.groupAction
    if (!group || !action || !this.canManage) return
    void this.perform(async () => {
      const path =
        action.type === 'delete'
          ? `/groups/${group.id}`
          : `/groups/${group.id}/members/${action.member.id}`
      await this.props.container.api.request(path, 'DELETE', {})
      if (this.state.group?.id !== group.id) return
      if (action.type === 'delete') this.chooseGroups()
      else {
        this.setState((state) => ({
          groupAction: null,
          groupMembers: state.groupMembers.filter((member) => member.id !== action.member.id),
          message: 'memberRemoved',
        }))
        await this.refreshRound()
      }
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
      this.canVote &&
      this.state.round?.status === 'collecting' &&
      movie.group_id === this.state.group?.id &&
      movie.eligible &&
      movie.approval_status === 'approved'
    return (
      <article
        className="movie-card"
        key={movie.id}
        data-tmdb-id={movie.tmdb_id ?? undefined}
        ref={(element) => this.observeWatchProviders(element)}
      >
        <button className="poster-button" onClick={(): void => this.openMovie(movie.id)}>
          {this.renderPoster(movie)}
        </button>
        <h3>
          <button className="text-button" onClick={(): void => this.openMovie(movie.id)}>
            {movie.title}
          </button>
        </h3>
        <p className="muted">{movie.release_year}</p>
        {movie.tmdb_id && this.renderWatchProviders(movie.tmdb_id)}
        <span className="badge">{this.t(movie.approval_status)}</span>
        {!movie.eligible && <p className="muted">{this.t('excluded')}</p>}
        {canNominate && (
          <button disabled={this.state.busy} onClick={(): void => this.nominate(movie.id)}>
            {this.t('nominate')}
          </button>
        )}
        <button
          disabled={this.state.busy}
          onClick={() => this.favorite(movie, this.state.tab !== 'profile')}
        >
          {this.t(this.state.tab === 'profile' ? 'removeFavorite' : 'addFavorite')}
        </button>
      </article>
    )
  }
  private renderRemoteCard(movie: MovieMetadata): ReactNode {
    const canNominate = this.canVote && this.state.round?.status === 'collecting'
    return (
      <article
        className="movie-card"
        key={`tmdb-${movie.tmdb_id}`}
        data-tmdb-id={movie.tmdb_id}
        ref={(element) => this.observeWatchProviders(element)}
      >
        {this.renderPoster(movie)}
        <h3>{movie.title}</h3>
        <p className="muted">{movie.release_year} · TMDB</p>
        {this.renderWatchProviders(movie.tmdb_id)}
        <button
          disabled={this.state.busy}
          onClick={(): void =>
            canNominate ? this.nominateTmdb(movie.tmdb_id) : this.importMovie(movie.tmdb_id)
          }
        >
          {this.t(canNominate ? 'nominate' : 'import')}
        </button>
        <button disabled={this.state.busy} onClick={() => this.favoriteTmdb(movie.tmdb_id)}>
          {this.t('addFavorite')}
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
    const entries = (round.nominations ?? []).flatMap((nomination) =>
      Array.from({ length: nomination.count }, () => ({
        movie_id: nomination.movieId,
        title: nomination.title,
      })),
    )
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
    const toReview = this.state.toReview.filter((movie) => movie.id !== round.winner_id)
    return (
      <>
        {this.renderWelcome()}
        {this.renderBrowseRow('christmas')}
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
                    <img src={member.avatar ?? '/art/creeper-avatar.png'} alt="" />
                  </span>
                  <strong>{member.username}</strong>
                  <small>
                    {response
                      ? round.revealed || member.id === this.state.user?.id
                        ? (response.title ?? this.t('skipLabel'))
                        : this.t('anonymousResponse')
                      : this.t('waiting')}
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
          {round.status === 'collecting' && this.canVote && (
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
        {round.survey && !this.state.spinning && (
          <section className="survey-panel">
            <h2>{this.t('guessNominations')}</h2>
            <p>{this.t(round.revealed ? 'surveyRevealed' : 'surveyIntro')}</p>
            <button onClick={() => this.openSurvey(round)}>
              {this.t(
                round.survey.eligible && !round.survey.completed ? 'surveyOpen' : 'surveyResults',
              )}
            </button>
            {this.renderReveal(round)}
          </section>
        )}
        {toReview.length > 0 && (
          <section aria-labelledby="to-review-title">
            <h2 id="to-review-title">{this.t('toReview')}</h2>
            <div className="movie-grid">
              {toReview.map((movie) => (
                <div className="to-review-card" key={movie.id}>
                  {this.renderCard(movie)}
                  <button onClick={() => this.openMovie(movie.id)}>{this.t('rateMovie')}</button>
                </div>
              ))}
            </div>
          </section>
        )}
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
              {this.canVote && (
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
            {row.winner && (
              <button
                disabled={this.state.busy}
                onClick={() => {
                  void this.perform(async () => {
                    const round = await this.props.container.api.request<Serialized<RoundState>>(
                      `/rounds/${row.week}`,
                    )
                    if (round.survey) this.openSurvey(round)
                    else this.setState({ message: 'surveyUnavailable' })
                  })
                }}
              >
                {this.t('surveyOpen')}
              </button>
            )}
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
        {this.state.reviewed.map(({ movie, reviews, reviewsLocked }) => (
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
            {reviewsLocked ? (
              <p className="muted">{this.t('reviewToSeeFriends')}</p>
            ) : (
              reviews.map((review) => this.renderReview(review))
            )}
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
  private renderProfile(): ReactNode {
    const user = this.state.user!
    return (
      <section className="profile-page">
        <h1>{this.t('profile')}</h1>
        <section className="profile-details">
          <div className="profile-photo">
            <img src={user.avatar ?? '/art/creeper-avatar.png'} alt={this.t('profilePhoto')} />
            <label>
              {this.t('profilePhoto')}
              <input
                type="file"
                accept="image/jpeg,image/png,image/webp"
                disabled={this.state.busy}
                onChange={this.uploadAvatar.bind(this)}
              />
            </label>
            <small className="muted">{this.t('avatarHint')}</small>
            {user.avatar && (
              <button
                disabled={this.state.busy}
                onClick={() => {
                  void this.perform(() => this.updateProfile({ avatar: null }))
                }}
              >
                {this.t('removePhoto')}
              </button>
            )}
          </div>
          <form key={`${user.id}-${user.username}-${user.name}`} onSubmit={this.profile.bind(this)}>
            <label>
              {this.t('displayName')}
              <input
                name="name"
                required
                minLength={1}
                maxLength={80}
                defaultValue={user.name}
                autoComplete="name"
              />
            </label>
            <label>
              {this.t('username')}
              <input
                name="username"
                required
                minLength={3}
                maxLength={32}
                pattern="[a-z0-9_]{3,32}"
                defaultValue={user.username}
                autoComplete="username"
                autoCapitalize="none"
                spellCheck={false}
              />
            </label>
            <small className="muted">{this.t('usernameHint')}</small>
            <button disabled={this.state.busy}>{this.t('saveProfile')}</button>
          </form>
        </section>
        <section aria-labelledby="profile-reviews">
          <h2 id="profile-reviews">{this.t('myReviews')}</h2>
          {!this.state.myReviews.length && <p className="muted">{this.t('noReviews')}</p>}
          {this.state.myReviews.map(({ movie, reviews }) => (
            <section className="reviewed-movie" key={movie.id}>
              <h3>{movie.title}</h3>
              {reviews.map((review) => this.renderReview(review))}
              <button onClick={() => this.openMovie(movie.id)}>{this.t('rateMovie')}</button>
            </section>
          ))}
          {this.state.myReviews.length >= 30 && (
            <button
              disabled={this.state.busy}
              onClick={() => {
                void this.loadMyReviews()
              }}
            >
              {this.t('more')}
            </button>
          )}
        </section>
        <section aria-labelledby="profile-favorites">
          <h2 id="profile-favorites">{this.t('favorites')}</h2>
          {!this.state.favorites.length && <p className="muted">{this.t('noFavorites')}</p>}
          <div className="movie-grid">
            {this.state.favorites.map((movie) => this.renderCard(movie))}
          </div>
          {this.state.favorites.length >= 30 && (
            <button
              disabled={this.state.busy}
              onClick={() => {
                void this.loadFavorites()
              }}
            >
              {this.t('more')}
            </button>
          )}
        </section>
        <section className="password-settings">
          <h2>{this.t('changePassword')}</h2>
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
        </section>
      </section>
    )
  }
  private renderAdmin(): ReactNode {
    if (!this.canManage) return this.renderWeek()
    return (
      <section>
        <h1>{this.t('admin')}</h1>
        <section aria-labelledby="group-settings">
          <h2 id="group-settings">{this.t('manageGroup')}</h2>
          <form
            key={`${this.state.group!.id}-${this.state.group!.name}`}
            onSubmit={this.renameGroup.bind(this)}
          >
            <label>
              {this.t('groupName')}
              <input name="name" defaultValue={this.state.group!.name} required maxLength={80} />
            </label>
            <button disabled={this.state.busy}>{this.t('renameGroup')}</button>
          </form>
          <h3>{this.t('groupMembers')}</h3>
          {this.state.groupMembers.map((member) => (
            <article className="account" key={member.id}>
              <strong>{member.name}</strong>
              <span>@{member.username}</span>
              {member.id === this.state.user?.id ? (
                <span className="muted">{this.t('groupCreator')}</span>
              ) : (
                <button
                  className="danger"
                  disabled={this.state.busy}
                  onClick={() => this.setState({ groupAction: { type: 'kick', member } })}
                >
                  {this.t('removeMember')}
                </button>
              )}
            </article>
          ))}
          <button
            className="danger"
            disabled={this.state.busy}
            onClick={() => this.setState({ groupAction: { type: 'delete' } })}
          >
            {this.t('deleteGroup')}
          </button>
          {this.state.groupAction && (
            <div className="notice" role="alert">
              <p>
                {this.state.groupAction.type === 'delete' ? (
                  this.t('deleteGroupWarning')
                ) : (
                  <>
                    {this.t('removeMemberWarning')} @{this.state.groupAction.member.username}
                  </>
                )}
              </p>
              <button
                className="danger"
                disabled={this.state.busy}
                onClick={this.confirmGroupAction.bind(this)}
              >
                {this.t(
                  this.state.groupAction.type === 'delete'
                    ? 'confirmDeleteGroup'
                    : 'confirmRemoveMember',
                )}
              </button>
              <button
                disabled={this.state.busy}
                onClick={() => this.setState({ groupAction: null })}
              >
                {this.t('cancel')}
              </button>
            </div>
          )}
        </section>
        <h2>{this.t('pending')}</h2>
        <div className="movie-grid">
          {this.state.pending.map((movie) => this.renderCard(movie))}
        </div>
        {this.state.user?.is_admin && <h2>{this.t('accounts')}</h2>}
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
        <strong className="review-author">
          <img className="review-avatar" src={review.avatar ?? '/art/creeper-avatar.png'} alt="" />
          {review.name}
        </strong>
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
  private renderWatchProviders(id: number): ReactNode {
    const providers = this.state.watchProviders[id]
    if (!providers || (!providers.flatrate.length && !providers.rent.length)) return null
    return (
      <section className="watch-providers" aria-label={this.t('availableAt')}>
        <h3>{this.t('availableAt')}</h3>
        {(['flatrate', 'rent'] as const).map(
          (kind) =>
            providers[kind].length > 0 && (
              <div key={kind}>
                <small className="muted">
                  {this.t(kind === 'flatrate' ? 'subscription' : 'rental')}
                </small>
                <ul>
                  {providers[kind].map((provider) => (
                    <li key={provider.provider_id}>
                      <img
                        src={`https://image.tmdb.org/t/p/w92${provider.logo_path}`}
                        alt={provider.provider_name}
                        title={provider.provider_name}
                        width={40}
                        height={40}
                        loading="lazy"
                      />
                    </li>
                  ))}
                </ul>
              </div>
            ),
        )}
        <small>
          <a href={providers.link} target="_blank" rel="noopener noreferrer">
            JustWatch
          </a>
        </small>
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
        <p className="muted">{this.t(movie.approval_status)}</p>
        <p>{movie.overview}</p>
        {movie.tmdb_id && this.renderWatchProviders(movie.tmdb_id)}
        <p>
          {this.t('watchedBy')}: {watched.map((w) => w.name).join(', ') || '—'}
        </p>
        {!seen && movie.approval_status === 'approved' && (
          <button disabled={this.state.busy} onClick={this.watched.bind(this)}>
            {this.t('watched')}
          </button>
        )}
        <button
          disabled={this.state.busy}
          onClick={() => this.favorite(movie, !detail.favorite)}
          aria-pressed={detail.favorite}
        >
          {this.t(detail.favorite ? 'removeFavorite' : 'addFavorite')}
        </button>
        <h3>{this.t('reviews')}</h3>
        {detail.reviewsLocked ? (
          <p className="muted">{this.t('reviewToSeeFriends')}</p>
        ) : reviews.length ? (
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
        {this.canManage && (
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
      <div className={this.state.inviteToken ? undefined : 'auth-layout'}>
        {!this.state.inviteToken && this.renderWelcome()}
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
        <header
          onPointerDown={(event) => {
            const menu = this.profileMenu.current
            if (!menu?.contains(event.target as Node)) menu?.removeAttribute('open')
          }}
        >
          <a className="brand" href="/">
            <img src="/art/mainflix-mark.webp" alt="" width="64" height="64" />
            MAIN<span>FLIX</span>
          </a>
          {this.state.user && this.state.group && (
            <nav
              aria-label="Mainflix"
              onFocus={(event) =>
                event.target.scrollIntoView({ block: 'nearest', inline: 'nearest' })
              }
            >
              {(
                [
                  'week',
                  'catalogue',
                  'history',
                  'reviews',
                  'about',
                  ...(this.canManage ? ['admin'] : []),
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
            <details
              className="profile-menu"
              ref={this.profileMenu}
              onKeyDown={(event) => {
                if (event.key === 'Escape') {
                  event.preventDefault()
                  event.currentTarget.removeAttribute('open')
                  event.currentTarget.querySelector('summary')?.focus()
                }
              }}
            >
              <summary
                aria-label={this.t('profileMenu')}
                aria-current={this.state.tab === 'profile' ? 'page' : undefined}
              >
                <img
                  src={this.state.user.avatar ?? '/art/creeper-avatar.png'}
                  alt=""
                  width="44"
                  height="44"
                />
              </summary>
              <div className="profile-menu-panel">
                <button onClick={() => this.navigate('profile')}>{this.t('goToProfile')}</button>
                <button disabled={this.state.busy} onClick={this.chooseGroups.bind(this)}>
                  {this.t('switchGroup')}
                </button>
                <button disabled={this.state.busy} onClick={() => this.invite()}>
                  {this.t('inviteToApp')}
                </button>
                <button onClick={this.logout.bind(this)} disabled={this.state.busy}>
                  {this.t('logout')}
                </button>
              </div>
            </details>
          )}
        </header>
        <main
          onPointerDown={() => this.profileMenu.current?.removeAttribute('open')}
          className={
            this.state.user && this.state.tab === 'week' && !this.state.resetToken
              ? 'week-page'
              : undefined
          }
        >
          {!this.state.detail &&
            !this.state.randomOpen &&
            !this.state.surveyRound &&
            this.renderErrorToast()}
          {this.state.message && (
            <p className="notice" role="status">
              {this.t(this.state.message)}
            </p>
          )}
          {this.state.loading ? (
            <p>{this.t('loading')}</p>
          ) : this.state.inviteToken && !this.state.resetToken ? (
            this.renderInvitation()
          ) : this.state.resetToken || !this.state.user ? (
            this.renderLogin()
          ) : !this.state.group ? (
            this.state.tab === 'profile' ? (
              this.renderProfile()
            ) : (
              this.renderGroups()
            )
          ) : (
            <>
              <section className="group-toolbar">
                <strong>{this.state.group.name}</strong>
                <button disabled={this.state.busy} onClick={this.chooseGroups.bind(this)}>
                  {this.t('switchGroup')}
                </button>
                {this.state.group.is_owner && (
                  <button
                    disabled={this.state.busy}
                    onClick={() => this.invite(this.state.group!.id)}
                  >
                    {this.t('inviteToGroup')}
                  </button>
                )}
                {!this.state.group.can_vote && !this.state.user.is_admin && (
                  <span>{this.t('votingNextWeek')}</span>
                )}
              </section>
              {this.renderInvitationLink()}
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
              ) : this.state.tab === 'profile' ? (
                this.renderProfile()
              ) : this.state.tab === 'about' ? (
                this.renderAbout()
              ) : (
                this.renderAdmin()
              )}
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
          {this.state.detail && this.renderErrorToast()}
          {this.renderDetail()}
        </dialog>
        {this.renderSurvey()}
      </>
    )
  }
}
