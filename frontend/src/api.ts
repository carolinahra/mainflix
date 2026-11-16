export class ApiException extends Error {
  constructor(
    readonly code: string,
    readonly status: number,
  ) {
    super(code)
  }
}
export class Api {
  private selectedGroup: number | null = null
  private revision = 0
  get groupId(): number | null {
    return this.selectedGroup
  }
  set groupId(value: number | null) {
    this.selectedGroup = value
    this.revision++
  }

  async request<T>(
    path: string,
    method: string = 'GET',
    body?: unknown,
    signal?: AbortSignal,
  ): Promise<T> {
    const revision = this.revision
    let response: Response
    try {
      response = await fetch(`/api${path}`, {
        method,
        credentials: 'same-origin',
        headers: {
          ...(body === undefined ? {} : { 'Content-Type': 'application/json' }),
          ...(this.groupId === null ? {} : { 'X-Mainflix-Group': String(this.groupId) }),
        },
        body: body === undefined ? undefined : JSON.stringify(body),
        signal,
      })
    } catch (error: unknown) {
      if (revision !== this.revision) throw new ApiException('STALE_REQUEST', 0)
      if (error instanceof DOMException && error.name === 'AbortError') throw error
      throw new ApiException('networkError', 0)
    }
    if (revision !== this.revision) throw new ApiException('STALE_REQUEST', 0)
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
      if (revision !== this.revision) throw new ApiException('STALE_REQUEST', 0)
      throw new ApiException(code, response.status)
    }
    const result = response.status === 204 ? (undefined as T) : ((await response.json()) as T)
    if (revision !== this.revision) throw new ApiException('STALE_REQUEST', 0)
    return result
  }
}
