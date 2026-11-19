import { test } from 'node:test'
import assert from 'node:assert/strict'
import { renderToStaticMarkup } from 'react-dom/server'
import { Mainflix } from '../src/app.js'
import { I18n } from '../src/i18n.js'
import type { Container } from '../src/container.js'
import { ApiException } from '../src/api.js'

test('movie discovery exposes watched, nomination and favorites rather than manual imports', () => {
  Object.defineProperty(globalThis, 'location', { value: { hash: '' }, configurable: true })
  const container = { i18n: new I18n('en') }
  const app = new Mainflix({ container: container as Container })
  const movie = {
    tmdb_id: 42,
    title: 'Discovered movie',
    release_year: 2026,
    overview: 'A story.',
    poster_path: null,
  }
  app.state.group = { id: 1, name: 'Movie night', is_owner: false, can_vote: true }
  app.state.user = {
    id: 1,
    name: 'Viewer',
    username: 'viewer',
    email: null,
    avatar: null,
    is_admin: false,
  }
  app.state.remoteDetail = movie
  app.state.round = {
    week: '2026-11-16',
    status: 'collecting',
    winner: null,
    winner_id: null,
    drawn_by: null,
    drawn_at: null,
    ends_at: '2026-11-23T00:00:00Z',
    responses: [],
    members: [],
  }
  for (const [language, nominate, favorite, imported, missing] of [
    ['en', 'Nominate', 'Add to favorites', 'Add from TMDB', 'Submit a missing movie'],
    ['es', 'Nominar', 'Añadir a favoritas', 'Añadir desde TMDB', 'Proponer una película que falta'],
  ] as const) {
    container.i18n = new I18n(language)
    app.state.round.status = 'collecting'
    for (const node of [app['renderRemoteCard'](movie), app['renderDetail']()]) {
      const markup = renderToStaticMarkup(node)
      assert.ok(markup.includes(nominate))
      assert.ok(markup.includes(favorite))
      assert.ok(!markup.includes(imported))
    }
    const detail = renderToStaticMarkup(app['renderDetail']())
    assert.ok(detail.includes(language === 'en' ? 'I&#x27;ve watched it' : 'Ya la he visto'))
    app.state.round.status = 'ready'
    for (const node of [app['renderRemoteCard'](movie), app['renderDetail']()]) {
      const markup = renderToStaticMarkup(node)
      assert.ok(!markup.includes(`>${nominate}</button>`))
      assert.ok(!markup.includes(imported))
      assert.ok(markup.includes(favorite))
    }
    assert.ok(!renderToStaticMarkup(app['renderSearch']()).includes(missing))
    assert.ok(
      renderToStaticMarkup(app['renderDetail']()).includes(
        language === 'en' ? 'I&#x27;ve watched it' : 'Ya la he visto',
      ),
    )
  }
})

test('only app administrators can manage movies through the administration view', () => {
  Object.defineProperty(globalThis, 'location', { value: { hash: '' }, configurable: true })
  const app = new Mainflix({ container: { i18n: new I18n('en') } as Container })
  app.state.group = { id: 1, name: 'Movie night', is_owner: true, can_vote: true }
  app.state.user = {
    id: 1,
    name: 'Owner',
    username: 'owner',
    email: null,
    avatar: null,
    is_admin: false,
  }
  app.state.detail = {
    movie: {
      id: 1,
      group_id: 1,
      tmdb_id: null,
      title: 'Local movie',
      release_year: 2026,
      overview: '',
      poster_path: null,
      approval_status: 'approved',
      submitted_by: null,
      eligible: true,
      eligibility_changed_by: null,
      eligibility_changed_at: null,
      created_at: '2026-11-19T00:00:00Z',
    },
    favorite: false,
    reviewsLocked: false,
    reviews: [],
    watched: [],
  }
  for (const tab of ['week', 'catalogue', 'reviews', 'profile', 'admin'] as const) {
    app.state.tab = tab
    assert.doesNotMatch(
      renderToStaticMarkup(app['renderDetail']()),
      /Manage movie|Edit information|name="title"/,
    )
  }
  app.state.tab = 'admin'
  app.state.group.is_owner = false
  app.state.user.is_admin = true
  assert.match(renderToStaticMarkup(app['renderDetail']()), /Manage movie/)
  app.state.user.is_admin = false
  assert.doesNotMatch(renderToStaticMarkup(app['renderDetail']()), /Manage movie|name="title"/)
})

test('cinema details show one editable review and preserve artwork through owner changes', async (context) => {
  Object.defineProperty(globalThis, 'location', { value: { hash: '' }, configurable: true })
  const container = { i18n: new I18n('en') }
  const app = new Mainflix({ container: container as Container })
  app.state.detail = {
    movie: {
      id: 1,
      group_id: 1,
      tmdb_id: 42,
      title: 'Interstellar',
      release_year: 2014,
      overview: 'A journey home.',
      poster_path: '/poster.jpg',
      backdrop_path: '/landscape.jpg',
      approval_status: 'approved',
      submitted_by: null,
      eligible: true,
      eligibility_changed_by: null,
      eligibility_changed_at: null,
      created_at: '2026-11-19T00:00:00Z',
    },
    favorite: false,
    reviewsLocked: false,
    watched: [{ user_id: 1, name: 'Viewer', watched_at: '2026-11-19T00:00:00Z' }],
    reviews: [
      {
        user_id: 1,
        movie_id: 1,
        name: 'Viewer',
        avatar: null,
        rating: 4.5,
        text: 'My single saved review.',
        created_at: '2026-11-19T00:00:00Z',
        updated_at: '2026-11-19T00:00:00Z',
      },
    ],
  }
  app.state.user = {
    id: 1,
    name: 'Viewer',
    username: 'viewer',
    email: null,
    avatar: null,
    is_admin: false,
  }
  for (const [language, edit, editing] of [
    ['en', 'Edit review', 'Editing your review'],
    ['es', 'Editar reseña', 'Editando tu reseña'],
  ] as const) {
    container.i18n = new I18n(language)
    app.state.editingReview = false
    let markup = renderToStaticMarkup(app['renderDetail']())
    assert.equal(markup.split('My single saved review.').length - 1, 1)
    assert.doesNotMatch(markup, /<textarea/)
    assert.ok(markup.includes(edit))
    assert.match(markup, /w1280\/landscape.jpg/)
    app.state.editingReview = true
    markup = renderToStaticMarkup(app['renderDetail']())
    assert.equal(markup.split('My single saved review.').length - 1, 1)
    assert.match(markup, /class="[^"]*own-review[^"]*editing/)
    assert.ok(markup.includes(editing))
    assert.match(markup, /<textarea[^>]*>My single saved review\.<\/textarea>/)
    assert.match(markup, /aria-label="4.5\/5"[^>]*checked/)
  }
  const { backdrop_path, ...saved } = app.state.detail!.movie
  Object.assign(container, { api: { request: async () => ({ ...saved, title: 'Edited title' }) } })
  let pending!: Promise<void>
  context.mock.method(app, 'perform', (work: () => Promise<void>) => {
    pending = work()
    return pending
  })
  context.mock.method(app, 'setState', (update: object | ((state: typeof app.state) => object)) => {
    app.state = { ...app.state, ...(typeof update === 'function' ? update(app.state) : update) }
  })
  context.mock.method(app, 'refreshRound', async () => {})
  context.mock.method(app, 'search', async () => {})
  context.mock.method(app, 'loadDiscovery', () => {})
  app['updateMovie'](1, { title: 'Edited title' })
  await pending
  assert.equal(app.state.detail!.movie.backdrop_path, '/landscape.jpg')
})

test('group management is creator-only and confirms destructive actions', () => {
  Object.defineProperty(globalThis, 'location', { value: { hash: '' }, configurable: true })
  const container = { i18n: new I18n('en') }
  const app = new Mainflix({ container: container as Container })
  app.state = {
    ...app.state,
    loading: false,
    tab: 'admin',
    user: {
      id: 1,
      username: 'creator',
      name: 'Creator',
      email: null,
      avatar: null,
      is_admin: false,
    },
    group: { id: 1, name: 'Movie nights', is_owner: true, can_vote: true },
    groupMembers: [
      { id: 1, username: 'creator', name: 'Creator', avatar: null },
      { id: 2, username: 'guest', name: 'Guest', avatar: null },
    ],
  }
  for (const [language, rename, remove, deletion] of [
    ['en', 'Rename group', 'Remove member', 'Delete group'],
    ['es', 'Renombrar grupo', 'Expulsar miembro', 'Eliminar grupo'],
  ] as const) {
    container.i18n = new I18n(language)
    let markup = renderToStaticMarkup(app.render())
    assert.ok(markup.includes(rename))
    assert.equal(markup.split(`>${remove}</button>`).length - 1, 1)
    assert.ok(markup.includes(deletion))
    assert.doesNotMatch(markup, /role="alert"/)
    app.state.groupAction = { type: 'delete' }
    markup = renderToStaticMarkup(app.render())
    assert.match(markup, /role="alert"/)
    assert.ok(markup.includes(language === 'es' ? 'permanentemente' : 'permanently'))
    app.state.groupAction = { type: 'kick', member: app.state.groupMembers[1]! }
    assert.ok(renderToStaticMarkup(app.render()).includes('@guest'))
    app.state.groupAction = null
  }
  app.state.group!.is_owner = false
  const markup = renderToStaticMarkup(app.render())
  assert.doesNotMatch(markup, /Renombrar grupo|Expulsar miembro|Eliminar grupo/)
})

test('a removed member loses cached group data when polling reports forbidden access', async (context) => {
  Object.defineProperty(globalThis, 'location', { value: { hash: '' }, configurable: true })
  const app = new Mainflix({
    container: {
      i18n: new I18n('en'),
      api: {
        groupId: 1,
        request: async (path: string) => {
          if (path === '/rounds/current') throw new ApiException('FORBIDDEN', 403)
          assert.equal(path, '/groups')
          return []
        },
      },
    } as unknown as Container,
  })
  app.state = {
    ...app.state,
    user: { id: 1, name: 'Viewer', username: 'viewer', email: null, avatar: null, is_admin: false },
    group: { id: 1, name: 'Old group', is_owner: false, can_vote: true },
  }
  context.mock.method(
    app,
    'setState',
    (update: object | ((state: typeof app.state) => object), callback?: () => void) => {
      app.state = { ...app.state, ...(typeof update === 'function' ? update(app.state) : update) }
      callback?.()
    },
  )
  await app['refreshRound']()
  assert.equal(app.state.group, null)
  assert.equal(app.state.round, null)
  assert.equal(app.state.user?.id, 1)
  assert.deepEqual(app.state.groupMembers, [])
})

test('availability appears only in the movie dialog with subscription, rental and JustWatch details', () => {
  Object.defineProperty(globalThis, 'location', { value: { hash: '' }, configurable: true })
  const container = { i18n: new I18n('en') }
  const app = new Mainflix({ container: container as Container })
  const movie = {
    id: 1,
    group_id: 1,
    title: 'Weekly movie',
    tmdb_id: 1,
    release_year: 2026,
    overview: '',
    poster_path: null,
    approval_status: 'approved' as const,
    submitted_by: null,
    eligible: true,
    eligibility_changed_by: null,
    eligibility_changed_at: null,
    created_at: '2026-11-09T12:00:00Z',
  }
  app.state = {
    ...app.state,
    loading: false,
    group: { id: 1, name: 'Mainflix', is_owner: false, can_vote: true },
    user: { id: 1, name: 'Demo', email: null, username: 'demo', is_admin: false, avatar: null },
    round: {
      week: '2026-11-09',
      status: 'selected',
      winner: movie,
      winner_id: 1,
      drawn_by: 1,
      drawn_at: '2026-11-09T12:00:00Z',
      ends_at: '2026-11-16T00:00:00Z',
      responses: [],
      members: [],
    },
    detail: { movie, reviews: [], watched: [], favorite: false, reviewsLocked: false },
    browse: {
      christmas: {
        local: [],
        remote: [
          {
            tmdb_id: 771,
            title: 'Home Alone',
            release_year: 1990,
            overview: '',
            poster_path: null,
          },
        ],
        remoteError: null,
        page: 1,
        totalPages: 2,
      },
    },
    watchProviders: {
      1: {
        link: 'https://www.themoviedb.org/movie/1/watch?locale=ES',
        flatrate: [{ provider_id: 8, provider_name: 'Netflix', logo_path: '/netflix.jpg' }],
        rent: [{ provider_id: 10, provider_name: 'Amazon Video', logo_path: '/amazon.jpg' }],
      },
    },
  }
  for (const [language, heading, subscription, rent] of [
    ['en', 'Available at', 'Subscription', 'Rent'],
    ['es', 'Disponible en', 'Suscripción', 'Alquiler'],
  ] as const) {
    container.i18n = new I18n(language)
    const markup = renderToStaticMarkup(app.render())
    assert.equal(markup.split(`<h3>${heading}</h3>`).length - 1, 1)
    const main = markup.slice(markup.indexOf('<main'), markup.indexOf('</main>'))
    assert.ok(!main.includes(heading))
    assert.doesNotMatch(markup, /Catalogue ID|ID del catálogo|· #1/)
    assert.match(markup, /id="browse-christmas"/)
    assert.ok(markup.includes(language === 'es' ? 'Películas de Navidad' : 'Christmas movies'))
    assert.ok(markup.includes('Home Alone'))
    assert.equal((markup.match(/alt="Netflix"/g) ?? []).length, 1)
    assert.equal((markup.match(/alt="Amazon Video"/g) ?? []).length, 1)
    assert.match(markup, /src="https:\/\/image.tmdb.org\/t\/p\/w92\/netflix.jpg"/)
    assert.ok(markup.indexOf(subscription) < markup.indexOf('alt="Netflix"'))
    assert.ok(markup.indexOf('alt="Netflix"') < markup.indexOf(rent))
    assert.ok(markup.indexOf(rent) < markup.indexOf('alt="Amazon Video"'))
    assert.match(
      markup,
      /href="https:\/\/www.themoviedb.org\/movie\/1\/watch\?locale=ES"[^>]*>JustWatch</,
    )
  }
  app.state.watchProviders[1] = { ...app.state.watchProviders[1]!, flatrate: [], rent: [] }
  assert.doesNotMatch(renderToStaticMarkup(app.render()), /Disponible en|JustWatch/)
  app.state.watchProviders[1] = null
  assert.doesNotMatch(renderToStaticMarkup(app.render()), /Disponible en|JustWatch/)
})

test('unimported TMDB catalogue cards offer title and poster details without inline availability', () => {
  Object.defineProperty(globalThis, 'location', { value: { hash: '' }, configurable: true })
  const app = new Mainflix({ container: { i18n: new I18n('en') } as Container })
  app.state = {
    ...app.state,
    loading: false,
    tab: 'catalogue',
    user: { id: 1, name: 'Viewer', username: 'viewer', email: null, avatar: null, is_admin: false },
    group: { id: 1, name: 'Group', is_owner: false, can_vote: true },
    search: {
      local: [],
      remote: [
        {
          tmdb_id: 42,
          title: 'Unimported film',
          release_year: 2026,
          overview: '',
          poster_path: null,
        },
      ],
      remoteError: null,
    },
    watchProviders: {
      42: {
        link: 'https://www.themoviedb.org/movie/42/watch?locale=ES',
        flatrate: [{ provider_id: 8, provider_name: 'Netflix', logo_path: '/netflix.jpg' }],
        rent: [],
      },
    },
  }
  const markup = renderToStaticMarkup(app.render())
  assert.match(markup, /Unimported film/)
  assert.match(markup, /<button class="text-button"[^>]*>Unimported film<\/button>/)
  assert.match(markup, /<button class="poster-button" aria-label="Movie details: Unimported film"/)
  assert.doesNotMatch(markup, /Available at|alt="Netflix"/)
})

test('opening a movie requests its description in the selected interface language', async (context) => {
  Object.defineProperty(globalThis, 'location', { value: { hash: '' }, configurable: true })
  const app = new Mainflix({
    container: {
      i18n: new I18n('es'),
      api: {
        request: async (path: string) => {
          assert.equal(path, '/movies/1?language=es')
          return { movie: { id: 1, overview: 'Una descripción en español.' } }
        },
      },
    } as unknown as Container,
  })
  let pending!: Promise<void>
  context.mock.method(app, 'perform', (work: () => Promise<void>) => {
    pending = work()
    return pending
  })
  context.mock.method(app, 'setState', (update: object) => {
    app.state = { ...app.state, ...update }
  })
  app['openMovie'](1)
  await pending
  assert.equal(app.state.detail?.movie.overview, 'Una descripción en español.')
})

test('availability loads once per movie and delayed results cannot cross group changes', async (context) => {
  Object.defineProperty(globalThis, 'location', { value: { hash: '' }, configurable: true })
  const providers = {
    link: 'https://www.themoviedb.org/movie/1/watch?locale=ES',
    flatrate: [{ provider_id: 8, provider_name: 'Netflix', logo_path: '/netflix.jpg' }],
    rent: [],
  }
  const app = new Mainflix({
    container: {
      i18n: new I18n('en'),
      api: {
        request: async (path: string) => {
          assert.equal(path, '/movies/providers/1')
          return providers
        },
      },
    } as unknown as Container,
  })
  app.state.group = { id: 1, name: 'Mainflix', is_owner: false, can_vote: true }
  context.mock.method(app, 'setState', (update: object | ((state: typeof app.state) => object)) => {
    app.state = { ...app.state, ...(typeof update === 'function' ? update(app.state) : update) }
  })
  await app['loadWatchProviders'](1)
  assert.deepEqual(app.state.watchProviders[1], providers)
  context.mock.method(app.props.container.api, 'request', async () => {
    assert.fail('cached movie should not fetch providers again')
  })
  await app['loadWatchProviders'](1)
  let deliver!: (value: typeof providers) => void
  context.mock.method(
    app.props.container.api,
    'request',
    () =>
      new Promise((resolve) => {
        deliver = resolve
      }),
  )
  const pending = app['loadWatchProviders'](2)
  app.state = { ...app.state, group: { ...app.state.group!, id: 2 }, watchProviders: {} }
  deliver(providers)
  await pending
  assert.deepEqual(app.state.watchProviders, {})
})

test('profile navigation uses an avatar dropdown and the creeper is the default picture', () => {
  Object.defineProperty(globalThis, 'location', { value: { hash: '' }, configurable: true })
  const app = new Mainflix({ container: { i18n: new I18n('en') } as Container })
  app.state = {
    ...app.state,
    group: { id: 1, name: 'Mainflix', is_owner: false, can_vote: true },
    loading: false,
    tab: 'profile',
    user: { id: 1, name: 'Demo', email: null, username: 'demo', is_admin: false, avatar: null },
  }
  const markup = renderToStaticMarkup(app.render())
  const header = markup.slice(markup.indexOf('<header'), markup.indexOf('</header>'))
  assert.match(header, /<details[^>]*class="profile-menu"/)
  assert.match(header, /<summary[^>]*aria-label="Profile menu"/)
  assert.match(header, /src="\/art\/creeper-avatar.png"/)
  assert.match(header, /Go to my profile/)
  assert.doesNotMatch(header, />My profile</)
  assert.match(markup, /<img[^>]*src="\/art\/creeper-avatar.png"[^>]*alt="Profile photo"/)
  app.state.user!.avatar = 'data:image/webp;base64,test'
  assert.match(renderToStaticMarkup(app.render()), /src="data:image\/webp;base64,test"/)
})

test('locked weekly reviews show a translated prompt in the movie dialog and Reviews tab', () => {
  Object.defineProperty(globalThis, 'location', { value: { hash: '' }, configurable: true })
  const container = { i18n: new I18n('en') }
  const app = new Mainflix({ container: container as Container })
  const movie = {
    id: 1,
    group_id: 1,
    title: 'Weekly movie',
    tmdb_id: null,
    release_year: 2026,
    overview: '',
    poster_path: null,
    approval_status: 'approved' as const,
    submitted_by: null,
    eligible: false,
    eligibility_changed_by: null,
    eligibility_changed_at: null,
    created_at: '2026-11-09T12:00:00Z',
  }
  app.state = {
    ...app.state,
    loading: false,
    tab: 'reviews',
    group: { id: 1, name: 'Mainflix', is_owner: false, can_vote: true },
    user: { id: 1, name: 'Demo', email: null, username: 'demo', is_admin: false, avatar: null },
    reviewed: [{ movie, reviews: [], reviewsLocked: true }],
    detail: { movie, reviews: [], watched: [], favorite: false, reviewsLocked: true },
  }
  for (const [language, prompt] of [
    ['en', 'Review this movie to see your friends’ reviews.'],
    ['es', 'Reseña esta película para ver las reseñas de tus amigos.'],
  ] as const) {
    container.i18n = new I18n(language)
    const markup = renderToStaticMarkup(app.render())
    assert.equal(markup.split(prompt).length - 1, 2)
    assert.doesNotMatch(markup, /No reviews yet|Todavía no hay reseñas/)
  }
  app.state = {
    ...app.state,
    reviewed: [{ movie, reviews: [], reviewsLocked: false }],
    detail: { ...app.state.detail!, reviewsLocked: false },
  }
  assert.doesNotMatch(renderToStaticMarkup(app.render()), /Reseña esta película para ver/)
})

test('random nomination offers filters and confirmation only while a player can nominate', () => {
  Object.defineProperty(globalThis, 'location', { value: { hash: '' }, configurable: true })
  const app = new Mainflix({ container: { i18n: new I18n('en') } as Container })
  app.state = {
    ...app.state,
    group: { id: 1, name: 'Mainflix', is_owner: false, can_vote: true },
    loading: false,
    user: { id: 1, name: 'Demo', email: null, username: 'demo', is_admin: false, avatar: null },
    round: {
      week: '2026-11-09',
      status: 'collecting',
      winner: null,
      winner_id: null,
      drawn_by: null,
      drawn_at: null,
      ends_at: '2026-11-16T00:00:00Z',
      responses: [],
      members: [],
    },
  }
  assert.match(renderToStaticMarkup(app.render()), />Random movie</)
  app.state.search.remote = [
    {
      tmdb_id: 2,
      title: 'TMDB choice',
      release_year: 2020,
      overview: '',
      poster_path: null,
    },
  ]
  assert.match(renderToStaticMarkup(app.render()), />Nominate</)
  app.state = {
    ...app.state,
    group: { id: 1, name: 'Mainflix', is_owner: false, can_vote: true },
    randomOpen: true,
    randomMovie: {
      tmdb_id: 1,
      title: 'Random pick',
      release_year: 2014,
      overview: 'A synopsis',
      poster_path: null,
    },
  }
  const markup = renderToStaticMarkup(app.render())
  assert.match(markup, /<dialog[^>]*aria-labelledby="random-title"/)
  assert.match(markup, /From year/)
  assert.match(markup, /To year/)
  assert.match(markup, /Random pick/)
  assert.match(markup, /Accept and nominate/)
  assert.match(markup, /Try again/)
  assert.match(markup, /Cancel/)
  app.state = {
    ...app.state,
    user: { ...app.state.user!, is_admin: true },
    group: { id: 1, name: 'Mainflix', is_owner: true, can_vote: false },
  }
  assert.doesNotMatch(renderToStaticMarkup(app.render()), /Accept and nominate|>Random movie</)
})

test('discovery features requested films and puts favorite genres before other browsing rows', () => {
  Object.defineProperty(globalThis, 'location', { value: { hash: '' }, configurable: true })
  const app = new Mainflix({ container: { i18n: new I18n('es') } as Container })
  app.state = {
    ...app.state,
    group: { id: 1, name: 'Mainflix', is_owner: false, can_vote: true },
    loading: false,
    tab: 'catalogue',
    user: { id: 1, name: 'Demo', email: null, username: 'demo', is_admin: false, avatar: null },
    browse: {
      featured: {
        local: [],
        remote: [
          {
            tmdb_id: 1422041,
            title: 'La bola negra',
            release_year: 2026,
            overview: '',
            poster_path: null,
          },
          {
            tmdb_id: 1522071,
            title: 'Ruega por nosotras',
            release_year: 2026,
            overview: '',
            poster_path: null,
          },
        ],
        remoteError: null,
        page: 1,
        totalPages: 1,
      },
      comedy: { local: [], remote: [], remoteError: null, page: 1, totalPages: 1 },
      popular: {
        local: [],
        remote: [
          {
            tmdb_id: 1422041,
            title: 'La bola negra',
            release_year: 2026,
            overview: '',
            poster_path: null,
          },
        ],
        remoteError: null,
        page: 1,
        totalPages: 2,
      },
    },
  }
  const markup = [
    app['renderBrowseRow']('popular'),
    app['renderSearch'](),
    app['renderDiscovery'](),
  ]
    .map((section) => renderToStaticMarkup(section))
    .join('')
  assert.match(markup, /La bola negra/)
  assert.match(markup, /Ruega por nosotras/)
  assert.ok(markup.indexOf('Comedia romántica') < markup.indexOf('Terror'))
  assert.ok(markup.indexOf('Terror') < markup.indexOf('>Comedia<'))
  assert.match(markup, /Populares en España/)
  assert.doesNotMatch(markup, /Vuestras imprescindibles|Estrenos en España|popularidad global/)
  assert.equal((markup.match(/id="browse-popular"/g) ?? []).length, 1)
  assert.equal((markup.match(/<h3><button[^>]*>La bola negra<\/button><\/h3>/g) ?? []).length, 1)
  assert.ok(markup.indexOf('La bola negra') < markup.indexOf('id="movie-catalogue"'))
  assert.match(markup, /Explorar por género/)
  assert.match(markup, /id="browse-barbie">Barbie/)
  assert.match(markup, /id="browse-animation">Animación/)
})

test('movie search explains missing TMDB configuration separately from an outage', () => {
  Object.defineProperty(globalThis, 'location', { value: { hash: '' }, configurable: true })
  const container = { i18n: new I18n('en') }
  const app = new Mainflix({ container: container as Container })
  app.state = {
    ...app.state,
    group: { id: 1, name: 'Mainflix', is_owner: false, can_vote: true },
    loading: false,
    tab: 'catalogue',
    user: { id: 1, name: 'Demo', email: null, username: 'demo', is_admin: false, avatar: null },
    search: { local: [], remote: [], remoteError: 'TMDB_NOT_CONFIGURED' },
  }
  for (const language of ['en', 'es'] as const) {
    const localized = new I18n(language)
    container.i18n = localized
    assert.ok(renderToStaticMarkup(app.render()).includes(localized.t('TMDB_NOT_CONFIGURED')))
    app.state.search.remoteError = 'TMDB_UNAVAILABLE'
    assert.ok(renderToStaticMarkup(app.render()).includes(localized.t('tmdbWarning')))
    app.state.search.remoteError = 'TMDB_NOT_CONFIGURED'
  }
})

test('weekly party progress counts actual responses including skips without inventing missing members', () => {
  Object.defineProperty(globalThis, 'location', { value: { hash: '' }, configurable: true })
  const app = new Mainflix({ container: { i18n: new I18n('en') } as Container })
  app.state = {
    ...app.state,
    group: { id: 1, name: 'Mainflix', is_owner: false, can_vote: true },
    loading: false,
    user: {
      id: 1,
      name: 'Leo',
      email: 'leo@example.com',
      username: 'leo',
      is_admin: false,
      avatar: null,
    },
    round: {
      week: '2026-11-09',
      winner_id: null,
      drawn_by: null,
      drawn_at: null,
      ends_at: '2026-11-16T00:00:00Z',
      winner: null,
      status: 'collecting',
      members: [
        { id: 1, name: 'Leo', username: 'leo_user' },
        { id: 2, name: 'Alex', username: 'alex_user' },
      ],
      responses: [{ user_id: 1, name: 'Leo', movie_id: null, title: null }],
    },
  }
  const markup = renderToStaticMarkup(app.render())
  assert.match(markup, /Your next movie night/)
  assert.match(markup, /id="browse-animation">Animation/)
  assert.match(markup, /id="browse-barbie">Barbie/)
  assert.match(markup, /<progress[^>]*value="1"[^>]*max="2"/)
  assert.match(markup, /Skipping/)
  assert.match(markup, /Not nominated yet/)
  assert.match(markup, /<strong>leo_user<\/strong>/)
  assert.match(markup, /<strong>alex_user<\/strong>/)
  assert.doesNotMatch(markup, /<strong>Leo<\/strong>|<strong>Alex<\/strong>/)
  assert.doesNotMatch(markup, /Jamie|Sam/)
  assert.match(markup, />Skip this week</)
  app.state = {
    ...app.state,
    user: { ...app.state.user!, is_admin: true },
    group: { id: 1, name: 'Mainflix', is_owner: true, can_vote: false },
    search: {
      ...app.state.search,
      local: [
        {
          id: 1,
          group_id: 1,
          title: 'Approved film',
          tmdb_id: null,
          release_year: 2020,
          overview: '',
          poster_path: null,
          approval_status: 'approved',
          submitted_by: null,
          eligible: true,
          eligibility_changed_by: null,
          eligibility_changed_at: null,
          created_at: '2026-11-09T12:00:00Z',
        },
      ],
    },
  }
  const adminMarkup = renderToStaticMarkup(app.render())
  assert.doesNotMatch(adminMarkup, />Skip this week<|>Nominate</)
  app.state = { ...app.state, round: { ...app.state.round!, status: 'ready' } }
  assert.match(renderToStaticMarkup(app.render()), /Draw this week/)
})

test('signed out users see the localized cinematic welcome and accessible sign in form', () => {
  Object.defineProperty(globalThis, 'location', { value: { hash: '' }, configurable: true })
  const app = new Mainflix({ container: { i18n: new I18n('es') } as Container })
  app.state = { ...app.state, loading: false }
  const markup = renderToStaticMarkup(app.render())
  assert.match(markup, /Tu próxima noche de cine/)
  assert.match(markup, /autoComplete="username"/)
  assert.match(markup, /Usuario o correo electrónico/)
  assert.match(markup, /<input(?=[^>]*name="identifier")(?=[^>]*type="text")/)
  assert.match(markup, /Entrar/)
  assert.doesNotMatch(markup, /<progress/)
})

test('eight-wedge roulette repeats nominations, skips abstentions and points to the saved winner', () => {
  Object.defineProperty(globalThis, 'location', { value: { hash: '' }, configurable: true })
  const app = new Mainflix({ container: { i18n: new I18n('en') } as Container })
  const winner = {
    id: 2,
    group_id: 1,
    title: 'Arrival',
    tmdb_id: null,
    release_year: 2016,
    overview: '',
    poster_path: null,
    approval_status: 'approved' as const,
    submitted_by: null,
    eligible: false,
    eligibility_changed_by: null,
    eligibility_changed_at: null,
    created_at: '2026-11-09T12:00:00Z',
  }
  app.state = {
    ...app.state,
    group: { id: 1, name: 'Mainflix', is_owner: false, can_vote: true },
    loading: false,
    spinning: true,
    user: {
      id: 1,
      name: 'Leo',
      email: 'leo@example.com',
      username: 'leo',
      is_admin: false,
      avatar: null,
    },
    round: {
      week: '2026-11-09',
      winner_id: 2,
      drawn_by: 1,
      drawn_at: '2026-11-09T12:00:00Z',
      ends_at: '2026-11-16T00:00:00Z',
      winner,
      status: 'selected',
      members: [1, 2, 3, 4].map((id) => ({ id, name: `Friend ${id}`, username: `friend${id}` })),
      responses: [
        { user_id: 1, name: 'Friend 1', movie_id: 1, title: 'Inception' },
        { user_id: 2, name: 'Friend 2', movie_id: 2, title: 'Arrival' },
        { user_id: 3, name: 'Friend 3', movie_id: 2, title: 'Arrival' },
        { user_id: 4, name: 'Friend 4', movie_id: null, title: null },
      ],
      nominations: [
        { movieId: 1, title: 'Inception', count: 1 },
        { movieId: 2, title: 'Arrival', count: 2 },
      ],
    },
  }
  const markup = renderToStaticMarkup(app.render())
  const wheel = markup.match(/<svg class="roulette-wheel"[\s\S]*?<\/svg>/)?.[0]
  assert.ok(wheel, 'Nominated titles must appear on a spinning wheel')
  assert.equal(wheel.match(/<title>Arrival<\/title>/g)?.length, 5)
  assert.equal(wheel.match(/<title>Inception<\/title>/g)?.length, 3)
  assert.equal(wheel.match(/class="roulette-divider"/g)?.length, 8)
  assert.doesNotMatch(wheel, /Skipping|Friend 4/)
  // Arrival's first 45° wedge is centered at 67.5°, which ends at the top.
  assert.match(wheel, /transform:rotate\(2092.5deg\)/)
  assert.doesNotMatch(markup, /class="winner"/)
  app.state = { ...app.state, spinning: false }
  assert.match(renderToStaticMarkup(app.render()), /Replay roulette/)

  app.state = {
    ...app.state,
    group: { id: 1, name: 'Mainflix', is_owner: false, can_vote: true },
    spinning: true,
    round: {
      ...app.state.round!,
      responses: [{ user_id: 2, name: 'Friend 2', movie_id: 2, title: 'Arrival' }],
      nominations: [{ movieId: 2, title: 'Arrival', count: 1 }],
    },
  }
  const solo = renderToStaticMarkup(app.render())
  assert.equal(solo.match(/<title>Arrival<\/title>/g)?.length, 8)
  assert.equal(solo.match(/class="roulette-divider"/g)?.length, 8)
  assert.match(solo, /transform:rotate\(2137.5deg\)/)
  assert.doesNotMatch(solo, /undefined|NaN|Infinity/)
  app.state = {
    ...app.state,
    group: { id: 1, name: 'Mainflix', is_owner: false, can_vote: true },
    round: {
      ...app.state.round!,
      winner: { ...winner, title: 'The Grand Budapest Hotel' },
      responses: [{ user_id: 2, name: 'Friend 2', movie_id: 2, title: 'The Grand Budapest Hotel' }],
      nominations: [{ movieId: 2, title: 'The Grand Budapest Hotel', count: 1 }],
    },
  }
  const longTitle = renderToStaticMarkup(app.render())
  assert.equal(longTitle.match(/<title>The Grand Budapest Hotel<\/title>/g)?.length, 8)
  assert.equal(longTitle.match(/textLength="100"/g)?.length, 8)
})

test('signed-in accounts choose named groups and can invite someone without joining a group', () => {
  Object.defineProperty(globalThis, 'location', { value: { hash: '' }, configurable: true })
  const app = new Mainflix({ container: { i18n: new I18n('en') } as Container })
  app.state = {
    ...app.state,
    loading: false,
    user: { id: 1, name: 'Owner', email: null, username: 'owner', is_admin: false, avatar: null },
    groups: [{ id: 2, name: 'Family', is_owner: true, can_vote: true }],
    group: null,
  }
  const markup = renderToStaticMarkup(app.render())
  assert.match(markup, /Choose your group/)
  assert.match(markup, />Family</)
  assert.match(markup, /Create new group/)
  assert.match(markup, /Invite to Mainflix/)
  assert.doesNotMatch(markup, />Skip this week</)
})

test('invitation signup identifies the named group and offers existing-account login', () => {
  Object.defineProperty(globalThis, 'location', {
    value: { hash: '#invite=token' },
    configurable: true,
  })
  const app = new Mainflix({ container: { i18n: new I18n('en') } as Container })
  app.state = {
    ...app.state,
    loading: false,
    invitation: { groupName: 'Family', expiresAt: '2026-11-23T12:00:00Z' },
  }
  const markup = renderToStaticMarkup(app.render())
  assert.match(markup, /Family/)
  assert.match(markup, /Create account/)
  assert.match(markup, /I already have an account/)
  assert.match(markup, /autoComplete="new-password"/)
  app.state = { ...app.state, invitation: { groupName: null, expiresAt: '2026-11-23T12:00:00Z' } }
  assert.match(renderToStaticMarkup(app.render()), /does not join the inviter/)
})

test('personal favorites from another group do not offer nomination in the current group', () => {
  Object.defineProperty(globalThis, 'location', { value: { hash: '' }, configurable: true })
  const app = new Mainflix({ container: { i18n: new I18n('en') } as Container })
  app.state = {
    ...app.state,
    loading: false,
    tab: 'profile',
    user: { id: 1, name: 'Owner', username: 'owner', email: null, is_admin: false, avatar: null },
    group: { id: 2, name: 'Family', is_owner: true, can_vote: true },
    round: {
      week: '2026-11-16',
      status: 'collecting',
      winner: null,
      winner_id: null,
      drawn_by: null,
      drawn_at: null,
      ends_at: '2026-11-23T00:00:00Z',
      responses: [],
      members: [],
    },
    favorites: [
      {
        id: 1,
        group_id: 3,
        title: 'Friends movie',
        tmdb_id: null,
        release_year: null,
        overview: '',
        poster_path: null,
        approval_status: 'approved',
        submitted_by: 1,
        eligible: true,
        eligibility_changed_by: null,
        eligibility_changed_at: null,
        created_at: '2026-11-16T12:00:00Z',
      },
    ],
  }
  assert.doesNotMatch(renderToStaticMarkup(app.render()), />Nominate</)
  app.state = { ...app.state, group: null }
  const markup = renderToStaticMarkup(app.render())
  assert.match(markup, /Go to my profile/)
  assert.match(markup, /My profile/)
})

test('catalogue hearts recognize saved movies outside the first page of favorites', () => {
  Object.defineProperty(globalThis, 'location', { value: { hash: '' }, configurable: true })
  const app = new Mainflix({ container: { i18n: new I18n('en') } as Container })
  const movie = {
    id: 31,
    group_id: 1,
    tmdb_id: null,
    title: 'Older favorite',
    release_year: 2020,
    overview: '',
    poster_path: null,
    approval_status: 'approved' as const,
    submitted_by: null,
    eligible: true,
    eligibility_changed_by: null,
    eligibility_changed_at: null,
    created_at: '2026-11-09T12:00:00Z',
  }
  app.state = {
    ...app.state,
    loading: false,
    tab: 'catalogue',
    user: { id: 1, name: 'Viewer', username: 'viewer', email: null, is_admin: false, avatar: null },
    group: { id: 1, name: 'Group', is_owner: false, can_vote: true },
    search: { local: [movie], remote: [], remoteError: null, favorites: [31] },
    favorites: [],
  }
  const markup = renderToStaticMarkup(app.render())
  assert.match(
    markup,
    /class="movie-favorite"[^>]*aria-label="Remove from favorites"[^>]*aria-pressed="true"/,
  )
})

test('exception toasts expire after five seconds and a new exception restarts the timer', async (context) => {
  const { ApiException } = await import('../src/api.js')
  Object.defineProperty(globalThis, 'location', { value: { hash: '' }, configurable: true })
  const app = new Mainflix({ container: { i18n: new I18n('en') } as Container })
  app.state = { ...app.state, loading: false }
  context.mock.method(app, 'setState', (update: object) => {
    app.state = { ...app.state, ...update }
  })
  context.mock.timers.enable({ apis: ['setTimeout'] })
  await app['perform'](async () => {
    throw new ApiException('INVALID_CREDENTIALS', 401)
  })
  let markup = renderToStaticMarkup(app.render())
  assert.match(markup, /class="notice error error-toast"[^>]*role="alert"/)
  assert.equal((markup.match(/role="alert"/g) ?? []).length, 1)
  context.mock.timers.tick(4999)
  assert.equal(app.state.error, 'INVALID_CREDENTIALS')
  await app['perform'](async () => {
    throw new ApiException('VALIDATION_ERROR', 400)
  })
  context.mock.timers.tick(1)
  assert.equal(app.state.error, 'VALIDATION_ERROR')
  context.mock.timers.tick(4999)
  assert.equal(app.state.error, null)
  markup = renderToStaticMarkup(app.render())
  assert.doesNotMatch(markup, /role="alert"/)
})

test('group creation starts with a labeled plus circle and reveals the form only after clicking', () => {
  Object.defineProperty(globalThis, 'location', { value: { hash: '' }, configurable: true })
  const app = new Mainflix({ container: { i18n: new I18n('en') } as Container })
  app.state = {
    ...app.state,
    loading: false,
    user: { id: 1, name: 'Owner', username: 'owner', email: null, is_admin: false, avatar: null },
    groups: [{ id: 1, name: 'maincra', is_owner: true, can_vote: true }],
  }
  let markup = renderToStaticMarkup(app.render())
  assert.match(markup, /class="create-group-circle"/)
  assert.match(markup, /title="Create new group"/)
  assert.doesNotMatch(markup, /name="name"/)
  app.state = { ...app.state, creatingGroup: true }
  markup = renderToStaticMarkup(app.render())
  assert.match(markup, /id="create-group-form"/)
  assert.match(markup, /Group name/)
  assert.match(markup, />Create group</)
})

test('survey uses multiple names, Send, percentages and explicit Next navigation', async (context) => {
  Object.defineProperty(globalThis, 'location', { value: { hash: '' }, configurable: true })
  const participants = [1, 2, 3].map((id) => ({
    id,
    username: `friend${id}`,
    name: `Friend ${id}`,
    avatar: null,
    completed: false,
  }))
  const round = {
    week: '2026-11-09',
    survey_enabled: true,
    status: 'selected' as const,
    winner_id: 1,
    winner: null,
    drawn_at: '2026-11-09T12:00:00Z',
    drawn_by: 1,
    ends_at: '2026-11-16T00:00:00Z',
    responses: [],
    members: participants,
    revealed: false,
    nominations: [
      { movieId: 1, title: 'Arrival', count: 2 },
      { movieId: 2, title: 'Dune', count: 1 },
    ],
    survey: {
      eligible: true,
      completed: false,
      participants,
      questions: [
        {
          movieId: 1,
          title: 'Arrival',
          answered: false,
          userIds: null,
          options: null,
          answerCount: null,
        },
        {
          movieId: 2,
          title: 'Dune',
          answered: false,
          userIds: null,
          options: null,
          answerCount: null,
        },
      ],
    },
  }
  const response = {
    ...round,
    survey: {
      ...round.survey,
      questions: [
        {
          ...round.survey.questions[0]!,
          answered: true,
          userIds: [1, 2],
          answerCount: 2,
          options: [
            { userId: 1, percentage: 50, votes: 1 },
            { userId: 2, percentage: 100, votes: 2 },
            { userId: 3, percentage: 0, votes: 0 },
          ],
        },
        round.survey.questions[1]!,
      ],
    },
  }
  const app = new Mainflix({
    container: {
      i18n: new I18n('en'),
      api: { request: async () => response },
    } as unknown as Container,
  })
  app.state = {
    ...app.state,
    loading: false,
    tab: 'week',
    user: {
      id: 1,
      name: 'Friend 1',
      username: 'friend1',
      email: null,
      avatar: null,
      is_admin: false,
    },
    group: { id: 1, name: 'Friends', is_owner: false, can_vote: true },
    round,
    surveyRound: round,
    surveyIndex: 0,
  }
  context.mock.method(app, 'setState', (update: object | ((state: typeof app.state) => object)) => {
    app.state = { ...app.state, ...(typeof update === 'function' ? update(app.state) : update) }
  })
  let markup = renderToStaticMarkup(app.render())
  assert.match(markup, /aria-labelledby="survey-title"/)
  assert.equal((markup.match(/type="checkbox"/g) ?? []).length, 3)
  assert.match(markup, />Send</)
  assert.doesNotMatch(markup, />Next</)
  await app['saveSurvey']({ movieId: 1, userIds: [1, 2] })
  assert.equal(app.state.surveyIndex, 0)
  markup = renderToStaticMarkup(app.render())
  assert.match(markup, /50%/)
  assert.match(markup, /100%/)
  assert.match(markup, />Next</)
  app['nextSurvey']()
  assert.equal(app.state.surveyIndex, 1)
  markup = renderToStaticMarkup(app.render())
  assert.match(markup, /<h3[^>]*>Dune<\/h3>/)
  assert.match(markup, />Send</)

  await context.test('a delayed Send response cannot reopen a closed survey', async (child) => {
    app.state = { ...app.state, tab: 'profile', round: response, surveyRound: response }
    let deliver!: (value: typeof response) => void
    child.mock.method(
      app.props.container.api,
      'request',
      () =>
        new Promise((resolve) => {
          deliver = resolve
        }),
    )
    const pending = app['saveSurvey']({ movieId: 2, userIds: [1] })
    app['closeSurvey']()
    deliver(response)
    await pending
    assert.equal(app.state.surveyRound, null)
  })
  await context.test(
    'a poll cannot overwrite an answer submitted while it was pending',
    async (child) => {
      app.state = { ...app.state, tab: 'profile', round, surveyRound: round }
      let deliver!: (value: typeof round) => void
      child.mock.method(
        app.props.container.api,
        'request',
        () =>
          new Promise((resolve) => {
            deliver = resolve
          }),
      )
      const pending = app['refreshRound']()
      app.state = { ...app.state, round: response, surveyRound: response }
      deliver(round)
      await pending
      assert.equal(app.state.round, response)
      assert.equal(app.state.surveyRound, response)
    },
  )
  await context.test(
    'a delayed historical refresh cannot restore a closed survey',
    async (child) => {
      const previous = { ...response, week: '2026-11-02' }
      app.state = { ...app.state, tab: 'profile', round: response, surveyRound: previous }
      let deliver!: (value: typeof response) => void
      child.mock.method(app.props.container.api, 'request', async (path: string) => {
        if (path === '/rounds/current') return response
        return new Promise((resolve) => {
          deliver = resolve
        })
      })
      const pending = app['refreshRound']()
      await Promise.resolve()
      await Promise.resolve()
      app['closeSurvey']()
      deliver(previous)
      await pending
      assert.equal(app.state.surveyRound, null)
    },
  )
  await context.test('completed survey results reopen at the first question', () => {
    const completed = {
      ...response,
      survey: {
        ...response.survey,
        completed: true,
        questions: response.survey.questions.map((question) => ({ ...question, answered: true })),
      },
    }
    app['openSurvey'](completed)
    assert.equal(app.state.surveyIndex, 0)
  })
  await context.test(
    'Finish shows all results without question controls while nominations stay hidden',
    async (child) => {
      const finished = {
        ...response,
        survey: {
          ...response.survey,
          completed: true,
          questions: [
            response.survey.questions[0]!,
            {
              ...response.survey.questions[1]!,
              answered: true,
              userIds: [3],
              answerCount: 1,
              options: [
                { userId: 1, percentage: 0, votes: 0 },
                { userId: 2, percentage: 0, votes: 0 },
                { userId: 3, percentage: 100, votes: 1 },
              ],
            },
          ],
        },
      }
      child.mock.method(app.props.container.api, 'request', async () => finished)
      app.state = { ...app.state, surveyRound: response, surveyIndex: 1 }
      await app['saveSurvey']({ finish: true })
      let results = renderToStaticMarkup(app['renderSurvey']())
      assert.match(results, /Survey results/)
      assert.match(results, /Arrival/)
      assert.match(results, /Dune/)
      assert.match(results, /50%/)
      assert.match(results, /100%/)
      assert.match(results, /Waiting for everyone else/)
      assert.doesNotMatch(
        results,
        /type="checkbox"|>Send<|>Next<|>Finish<|Who do you think nominated/,
      )
      assert.doesNotMatch(results, /Nominated this movie/)
      app.state = {
        ...app.state,
        surveyRound: {
          ...finished,
          revealed: true,
          responses: [
            { user_id: 1, name: 'Friend 1', movie_id: 1, title: 'Arrival' },
            { user_id: 2, name: 'Friend 2', movie_id: 1, title: 'Arrival' },
            { user_id: 3, name: 'Friend 3', movie_id: 2, title: 'Dune' },
          ],
        },
      }
      results = renderToStaticMarkup(app['renderSurvey']())
      assert.equal((results.match(/Nominated this movie/g) ?? []).length, 3)
      assert.doesNotMatch(results, /Waiting for everyone else/)
      assert.doesNotMatch(results, /type="checkbox"|>Send<|>Next<|>Finish</)
    },
  )
})

test('About Mainflix explains the group, anonymous nomination, survey and review flow in both languages', () => {
  Object.defineProperty(globalThis, 'location', { value: { hash: '' }, configurable: true })
  const container = { i18n: new I18n('en') }
  const app = new Mainflix({ container: container as Container })
  app.state = {
    ...app.state,
    loading: false,
    tab: 'about',
    group: { id: 1, name: 'Friends', is_owner: false, can_vote: true },
    user: { id: 1, name: 'Demo', email: null, username: 'demo', is_admin: false, avatar: null },
  }
  let markup = renderToStaticMarkup(app.render())
  assert.match(markup, /About Mainflix/)
  assert.match(markup, /anonymous/)
  assert.match(markup, /more chances/)
  assert.match(markup, /Next/)
  assert.match(markup, /review.*unlock/)
  container.i18n = new I18n('es')
  markup = renderToStaticMarkup(app.render())
  assert.match(markup, /Acerca de Mainflix/)
  assert.match(markup, /anónim/)
})
