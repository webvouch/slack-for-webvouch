import { describe, expect, it, vi } from 'vitest'

import { WebVouchClient } from '../src/webvouch-client.js'
import { review } from './fixtures.js'

function json(body: unknown, init: ResponseInit = {}): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { 'content-type': 'application/json' },
    ...init,
  })
}

describe('WebVouch Customer API client', () => {
  it('exchanges encoded Basic credentials once and reuses the Bearer token', async () => {
    const fetchImplementation = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(
        json({
          access_token: 'access-token',
          token_type: 'Bearer',
          expires_in: 604_800,
          scope: 'reviews:read reviews:reply',
        }),
      )
      .mockResolvedValueOnce(json({ data: [], page: { nextCursor: null } }))
      .mockResolvedValueOnce(json({ data: [], page: { nextCursor: null } }))
    const client = new WebVouchClient({
      apiBaseUrl: 'https://api.example.test/api',
      clientId: 'client id',
      clientSecret: 'secret:value',
      fetchImplementation,
      now: () => 0,
    })

    await client.listReviews()
    await client.listReviews('cursor_2')

    const tokenHeaders = new Headers(
      fetchImplementation.mock.calls[0]?.[1]?.headers,
    )
    expect(
      Buffer.from(
        tokenHeaders.get('authorization')!.replace('Basic ', ''),
        'base64',
      ).toString('utf8'),
    ).toBe('client%20id:secret%3Avalue')
    expect(fetchImplementation).toHaveBeenCalledTimes(3)
    expect(fetchImplementation.mock.calls[2]?.[0]).toContain('cursor=cursor_2')
    const resourceHeaders = new Headers(
      fetchImplementation.mock.calls[1]?.[1]?.headers,
    )
    expect(resourceHeaders.get('authorization')).toBe('Bearer access-token')
  })

  it('sends reply content with a stable idempotency key', async () => {
    const replied = review('review_1', {
      reply: {
        id: 'reply_1',
        body: 'Thank you.',
        isEdited: false,
        createdAt: '2026-08-07T12:01:00.000Z',
        updatedAt: '2026-08-07T12:01:00.000Z',
      },
    })
    const fetchImplementation = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(
        json({
          access_token: 'access-token',
          token_type: 'Bearer',
          expires_in: 604_800,
          scope: 'reviews:read reviews:reply',
        }),
      )
      .mockResolvedValueOnce(json(replied))
    const client = new WebVouchClient({
      apiBaseUrl: 'https://api.example.test/api',
      clientId: 'client',
      clientSecret: 'secret',
      fetchImplementation,
    })

    await expect(
      client.createReply({
        reviewId: 'review_1',
        body: 'Thank you.',
        idempotencyKey: 'slack-bridge:12345678',
      }),
    ).resolves.toEqual(replied)
    const request = fetchImplementation.mock.calls[1]
    const headers = new Headers(request?.[1]?.headers)
    expect(headers.get('idempotency-key')).toBe('slack-bridge:12345678')
    expect(request?.[1]?.body).toBe(JSON.stringify({ body: 'Thank you.' }))
  })

  it('renews once after a 401 response', async () => {
    const token = (value: string) =>
      json({
        access_token: value,
        token_type: 'Bearer',
        expires_in: 604_800,
        scope: 'reviews:read reviews:reply',
      })
    const fetchImplementation = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(token('first'))
      .mockResolvedValueOnce(
        json({ error: { message: 'Expired' } }, { status: 401 }),
      )
      .mockResolvedValueOnce(token('second'))
      .mockResolvedValueOnce(json({ data: [], page: { nextCursor: null } }))
    const client = new WebVouchClient({
      apiBaseUrl: 'https://api.example.test/api',
      clientId: 'client',
      clientSecret: 'secret',
      fetchImplementation,
    })

    await expect(client.listReviews()).resolves.toMatchObject({ data: [] })
    expect(fetchImplementation).toHaveBeenCalledTimes(4)
  })
})
