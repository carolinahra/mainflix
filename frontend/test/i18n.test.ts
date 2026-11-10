import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { I18n } from '../src/i18n.js'

test('Spanish and English have matching nonempty translation keys', async () => {
  const english: Record<string, string> = JSON.parse(
    await readFile(new URL('../src/locales/en.json', import.meta.url), 'utf8'),
  )
  const spanish: Record<string, string> = JSON.parse(
    await readFile(new URL('../src/locales/es.json', import.meta.url), 'utf8'),
  )
  assert.deepEqual(Object.keys(spanish).sort(), Object.keys(english).sort())
  assert.ok(Object.values(english).every((value) => value.trim()))
  assert.ok(Object.values(spanish).every((value) => value.trim()))
})

test('API error codes render in the selected language, with a safe unknown-code fallback', () => {
  assert.equal(new I18n('en').error('ROUND_LOCKED'), 'Nominations have been locked.')
  assert.equal(new I18n('es').error('ROUND_LOCKED'), 'Las propuestas ya están cerradas.')
  assert.equal(
    new I18n('es').error('DATABASE_PASSWORD=secret'),
    'Algo ha fallado. Inténtalo de nuevo.',
  )
})
