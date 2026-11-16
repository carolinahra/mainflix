import { test } from 'node:test'
import assert from 'node:assert/strict'
import { renderToStaticMarkup } from 'react-dom/server'
import { Mainflix } from '../src/app.js'
import { I18n } from '../src/i18n.js'
import type { Container } from '../src/container.js'

test('profile navigation uses an avatar dropdown and the creeper is the default picture', () => {
  Object.defineProperty(globalThis, 'location', { value: { hash: '' }, configurable: true })
  const app = new Mainflix({ container: { i18n: new I18n('en') } as Container })
  app.state = {
    ...app.state,
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

test('random nomination offers filters and confirmation only while a player can nominate', () => {
  Object.defineProperty(globalThis, 'location', { value: { hash: '' }, configurable: true })
  const app = new Mainflix({ container: { i18n: new I18n('en') } as Container })
  app.state = {
    ...app.state,
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
  app.state = { ...app.state, user: { ...app.state.user!, is_admin: true } }
  assert.doesNotMatch(renderToStaticMarkup(app.render()), /Accept and nominate|>Random movie</)
})

test('discovery features requested films and puts favorite genres before other browsing rows', () => {
  Object.defineProperty(globalThis, 'location', { value: { hash: '' }, configurable: true })
  const app = new Mainflix({ container: { i18n: new I18n('es') } as Container })
  app.state = {
    ...app.state,
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
  const markup = renderToStaticMarkup(app.render())
  assert.match(markup, /La bola negra/)
  assert.match(markup, /Ruega por nosotras/)
  assert.ok(markup.indexOf('Comedia romántica') < markup.indexOf('Terror'))
  assert.ok(markup.indexOf('Terror') < markup.indexOf('>Comedia<'))
  assert.match(markup, /Populares en España/)
  assert.doesNotMatch(markup, /Vuestras imprescindibles|Estrenos en España|popularidad global/)
  assert.equal((markup.match(/id="browse-popular"/g) ?? []).length, 1)
  assert.equal((markup.match(/<h3>La bola negra<\/h3>/g) ?? []).length, 1)
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
    search: {
      ...app.state.search,
      local: [
        {
          id: 1,
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
    spinning: true,
    round: {
      ...app.state.round!,
      responses: [{ user_id: 2, name: 'Friend 2', movie_id: 2, title: 'Arrival' }],
    },
  }
  const solo = renderToStaticMarkup(app.render())
  assert.equal(solo.match(/<title>Arrival<\/title>/g)?.length, 8)
  assert.equal(solo.match(/class="roulette-divider"/g)?.length, 8)
  assert.match(solo, /transform:rotate\(2137.5deg\)/)
  assert.doesNotMatch(solo, /undefined|NaN|Infinity/)
  app.state = {
    ...app.state,
    round: {
      ...app.state.round!,
      winner: { ...winner, title: 'The Grand Budapest Hotel' },
      responses: [{ user_id: 2, name: 'Friend 2', movie_id: 2, title: 'The Grand Budapest Hotel' }],
    },
  }
  const longTitle = renderToStaticMarkup(app.render())
  assert.equal(longTitle.match(/<title>The Grand Budapest Hotel<\/title>/g)?.length, 8)
  assert.equal(longTitle.match(/textLength="100"/g)?.length, 8)
})
