import { test } from 'node:test'
import assert from 'node:assert/strict'
import { renderToStaticMarkup } from 'react-dom/server'
import { Mainflix } from '../src/app.js'
import { I18n } from '../src/i18n.js'
import type { Container } from '../src/container.js'

test('weekly party progress counts actual responses including skips without inventing missing members', () => {
  Object.defineProperty(globalThis, 'location', { value: { hash: '' }, configurable: true })
  const app = new Mainflix({ container: { i18n: new I18n('en') } as Container })
  app.state = {
    ...app.state,
    loading: false,
    user: { id: 1, name: 'Leo', email: 'leo@example.com', username: 'leo', is_admin: false },
    round: {
      week: '2026-11-09',
      winner_id: null,
      drawn_by: null,
      drawn_at: null,
      ends_at: '2026-11-16T00:00:00Z',
      winner: null,
      status: 'collecting',
      members: [
        { id: 1, name: 'Leo' },
        { id: 2, name: 'Alex' },
      ],
      responses: [{ user_id: 1, name: 'Leo', movie_id: null, title: null }],
    },
  }
  const markup = renderToStaticMarkup(app.render())
  assert.match(markup, /Your next movie night/)
  assert.match(markup, /<progress[^>]*value="1"[^>]*max="2"/)
  assert.match(markup, /Skipping/)
  assert.match(markup, /Not nominated yet/)
  assert.doesNotMatch(markup, /Jamie|Sam/)
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

test('movie roulette keeps weighted nominations, skips abstentions and points to the saved winner', () => {
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
    user: { id: 1, name: 'Leo', email: 'leo@example.com', username: 'leo', is_admin: false },
    round: {
      week: '2026-11-09',
      winner_id: 2,
      drawn_by: 1,
      drawn_at: '2026-11-09T12:00:00Z',
      ends_at: '2026-11-16T00:00:00Z',
      winner,
      status: 'selected',
      members: [1, 2, 3, 4].map((id) => ({ id, name: `Friend ${id}` })),
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
  assert.equal(wheel.match(/<title>Arrival<\/title>/g)?.length, 2)
  assert.match(wheel, /<title>Inception<\/title>/)
  assert.equal(wheel.match(/class="roulette-divider"/g)?.length, 3)
  assert.doesNotMatch(wheel, /Skipping|Friend 4/)
  // Three entries: Arrival's first sector is centered at 180°, which ends at the top.
  assert.match(wheel, /transform:rotate\(1980deg\)/)
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
  assert.match(solo, /transform:rotate\(1980deg\)/)
  assert.doesNotMatch(solo, /NaN|Infinity/)
})
