import { test } from 'node:test'
import assert from 'node:assert/strict'
import { Api, ApiException } from '../src/api.js'

test('group switches prevent stale movie data or authorization errors from reaching the UI', async () => {
  const original = globalThis.fetch
  let complete: (response: Response) => void = () => {}
  let headers: HeadersInit | undefined
  globalThis.fetch = async (_url, options) => {
    headers = options?.headers
    return new Promise<Response>((resolve) => {
      complete = resolve
    })
  }
  try {
    const api = new Api()
    api.groupId = 2
    const pending = api.request('/movies')
    assert.equal(new Headers(headers).get('X-Mainflix-Group'), '2')
    api.groupId = 3
    complete(new Response(JSON.stringify({ local: ['old group'] }), { status: 200 }))
    await assert.rejects(
      pending,
      (error: unknown) => error instanceof ApiException && error.code === 'STALE_REQUEST',
    )
    const expired = api.request('/rounds/current')
    api.groupId = null
    complete(new Response(JSON.stringify({ code: 'AUTHENTICATION_REQUIRED' }), { status: 401 }))
    await assert.rejects(
      expired,
      (error: unknown) => error instanceof ApiException && error.code === 'STALE_REQUEST',
    )
  } finally {
    globalThis.fetch = original
  }
})

test('transport failures from a previous group are discarded too', async () => {
  const original = globalThis.fetch
  let rejectFetch: (reason: Error) => void = () => {}
  globalThis.fetch = async () =>
    new Promise<Response>((_resolve, reject) => {
      rejectFetch = reject
    })
  try {
    const api = new Api()
    api.groupId = 2
    const pending = api.request('/rounds/current')
    api.groupId = 3
    rejectFetch(new TypeError('Failed to fetch'))
    await assert.rejects(
      pending,
      (error: unknown) => error instanceof ApiException && error.code === 'STALE_REQUEST',
    )
  } finally {
    globalThis.fetch = original
  }
})
