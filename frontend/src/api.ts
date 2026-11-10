export class ApiException extends Error {
  constructor(
    readonly code: string,
    readonly status: number,
  ) {
    super(code)
  }
}
export class Api {
  async request<T>(
    path: string,
    method: string = 'GET',
    body?: unknown,
    signal?: AbortSignal,
  ): Promise<T> {
    let response: Response
    try {
      response = await fetch(`/api${path}`, {
        method,
        credentials: 'same-origin',
        headers: body === undefined ? {} : { 'Content-Type': 'application/json' },
        body: body === undefined ? undefined : JSON.stringify(body),
        signal,
      })
    } catch (error: unknown) {
      if (error instanceof DOMException && error.name === 'AbortError') throw error
      throw new ApiException('networkError', 0)
    }
    if (!response.ok) {
      let code: string = 'INTERNAL_ERROR'
      try {
        const payload: unknown = await response.json()
        if (
          typeof payload === 'object' &&
          payload !== null &&
          'code' in payload &&
          typeof payload.code === 'string'
        )
          code = payload.code
      } catch {
        /* An upstream error can be HTML instead of JSON. */
      }
      throw new ApiException(code, response.status)
    }
    return response.status === 204 ? (undefined as T) : ((await response.json()) as T)
  }
}
