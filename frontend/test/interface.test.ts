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
