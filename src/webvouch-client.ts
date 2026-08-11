import type {
  ReviewPage,
  WebVouchAccount,
  WebVouchApi,
  WebVouchReview,
} from './types.js'

interface TokenResponse {
  access_token: string
  token_type: 'Bearer'
  expires_in: number
  scope: string
}

interface CustomerApiErrorBody {
  error?: { code?: string; message?: string }
  error_description?: string
}

export class WebVouchApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly code: string | undefined,
    readonly retryAfterSeconds: number | undefined,
  ) {
    super(message)
    this.name = 'WebVouchApiError'
  }
}

export interface WebVouchClientOptions {
  apiBaseUrl: string
  clientId: string
  clientSecret: string
  fetchImplementation?: typeof fetch
  now?: () => number
  timeoutMs?: number
}

function encodedBasicCredentials(clientId: string, clientSecret: string) {
  return Buffer.from(
    `${encodeURIComponent(clientId)}:${encodeURIComponent(clientSecret)}`,
    'utf8',
  ).toString('base64')
}

async function responseBody(response: Response): Promise<unknown> {
  const text = await response.text()
  if (!text) return null
  try {
    return JSON.parse(text) as unknown
  } catch {
    return null
  }
}

function apiError(response: Response, body: unknown): WebVouchApiError {
  const parsed = (body ?? {}) as CustomerApiErrorBody
  const message =
    parsed.error?.message ??
    parsed.error_description ??
    `WebVouch Customer API returned HTTP ${response.status}.`
  const retryAfter = Number(response.headers.get('retry-after'))
  return new WebVouchApiError(
    message,
    response.status,
    parsed.error?.code,
    Number.isFinite(retryAfter) ? retryAfter : undefined,
  )
}

export class WebVouchClient implements WebVouchApi {
  private readonly fetchImplementation: typeof fetch
  private readonly now: () => number
  private readonly timeoutMs: number
  private token: { value: string; refreshAt: number } | undefined

  constructor(private readonly options: WebVouchClientOptions) {
    this.fetchImplementation = options.fetchImplementation ?? fetch
    this.now = options.now ?? Date.now
    this.timeoutMs = options.timeoutMs ?? 15_000
  }

  async getAccount(): Promise<WebVouchAccount> {
    return this.request<WebVouchAccount>('/public/v1/account')
  }

  async listReviews(cursor?: string): Promise<ReviewPage> {
    const query = new URLSearchParams({
      collection: 'awaiting_reply',
      limit: '100',
      sort: 'newest',
    })
    if (cursor) query.set('cursor', cursor)
    return this.request<ReviewPage>(`/public/v1/reviews?${query.toString()}`)
  }

  async getReview(reviewId: string): Promise<WebVouchReview> {
    return this.request<WebVouchReview>(
      `/public/v1/reviews/${encodeURIComponent(reviewId)}`,
    )
  }

  async createReply(input: {
    reviewId: string
    body: string
    idempotencyKey: string
  }): Promise<WebVouchReview> {
    return this.request<WebVouchReview>(
      `/public/v1/reviews/${encodeURIComponent(input.reviewId)}/reply`,
      {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'idempotency-key': input.idempotencyKey,
        },
        body: JSON.stringify({ body: input.body }),
      },
    )
  }

  private async accessToken(): Promise<string> {
    if (this.token && this.token.refreshAt > this.now()) return this.token.value

    const form = new URLSearchParams({
      grant_type: 'client_credentials',
      scope: 'reviews:read reviews:reply',
    })
    const response = await this.fetchImplementation(
      `${this.options.apiBaseUrl}/public/v1/oauth/token`,
      {
        method: 'POST',
        headers: {
          authorization: `Basic ${encodedBasicCredentials(
            this.options.clientId,
            this.options.clientSecret,
          )}`,
          'content-type': 'application/x-www-form-urlencoded',
        },
        body: form,
        signal: AbortSignal.timeout(this.timeoutMs),
      },
    )
    const body = await responseBody(response)
    if (!response.ok) throw apiError(response, body)

    const token = body as Partial<TokenResponse>
    if (
      typeof token.access_token !== 'string' ||
      token.token_type !== 'Bearer' ||
      typeof token.expires_in !== 'number'
    ) {
      throw new Error('WebVouch token response was malformed.')
    }
    const refreshBufferSeconds = Math.min(86_400, token.expires_in / 2)
    this.token = {
      value: token.access_token,
      refreshAt: this.now() + (token.expires_in - refreshBufferSeconds) * 1_000,
    }
    return this.token.value
  }

  private async request<T>(
    path: string,
    init: RequestInit = {},
    mayRefresh = true,
  ): Promise<T> {
    const token = await this.accessToken()
    const headers = new Headers(init.headers)
    headers.set('authorization', `Bearer ${token}`)
    headers.set('accept', 'application/json')
    const response = await this.fetchImplementation(
      `${this.options.apiBaseUrl}${path}`,
      {
        ...init,
        headers,
        signal: AbortSignal.timeout(this.timeoutMs),
      },
    )
    const body = await responseBody(response)
    if (response.status === 401 && mayRefresh) {
      this.token = undefined
      return this.request<T>(path, init, false)
    }
    if (!response.ok) throw apiError(response, body)
    return body as T
  }
}
