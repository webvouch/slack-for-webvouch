import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { afterEach, describe, expect, it, vi } from 'vitest'

import type { Logger } from '../src/logger.js'
import { ReviewPoller } from '../src/poller.js'
import { BridgeState } from '../src/state.js'
import type { ReviewPublisher, WebVouchApi } from '../src/types.js'
import { review } from './fixtures.js'

const directories: string[] = []
const logger: Logger = {
  debug: vi.fn(),
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
}

afterEach(() => {
  vi.restoreAllMocks()
  for (const directory of directories.splice(0)) {
    rmSync(directory, { recursive: true, force: true })
  }
})

function createState() {
  const directory = mkdtempSync(join(tmpdir(), 'webvouch-bridge-poller-'))
  directories.push(directory)
  return new BridgeState(directory)
}

function unusedApi(): WebVouchApi {
  return {
    getAccount: vi.fn(),
    listReviews: vi.fn(),
    getReview: vi.fn(),
    createReply: vi.fn(),
  }
}

describe('review polling', () => {
  it('establishes a no-backfill baseline across all pages', async () => {
    const state = createState()
    const api = unusedApi()
    vi.mocked(api.listReviews)
      .mockResolvedValueOnce({
        data: [review('existing_2')],
        page: { nextCursor: 'page_2' },
      })
      .mockResolvedValueOnce({
        data: [review('existing_1')],
        page: { nextCursor: null },
      })
    const publisher: ReviewPublisher = { publishReview: vi.fn() }
    const poller = new ReviewPoller({
      api,
      state,
      publisher,
      ratingFilter: 'all',
      intervalMs: 60_000,
      logger,
    })

    await expect(poller.poll()).resolves.toEqual({
      bootstrapped: true,
      discovered: 2,
      posted: 0,
      filtered: 2,
    })
    expect(state.hasSeenReview('existing_1')).toBe(true)
    expect(state.hasSeenReview('existing_2')).toBe(true)
    expect(publisher.publishReview).not.toHaveBeenCalled()
    state.close()
  })

  it('posts unseen reviews oldest-first and stops at the known boundary', async () => {
    const state = createState()
    state.markInitialized()
    state.recordSkippedReview('known')
    const api = unusedApi()
    vi.mocked(api.listReviews).mockResolvedValue({
      data: [review('newest'), review('older'), review('known')],
      page: { nextCursor: 'unused' },
    })
    const publishReview = vi
      .fn()
      .mockResolvedValueOnce({ channel: 'C1', ts: '1' })
      .mockResolvedValueOnce({ channel: 'C1', ts: '2' })
    const poller = new ReviewPoller({
      api,
      state,
      publisher: { publishReview },
      ratingFilter: 'all',
      intervalMs: 60_000,
      logger,
    })

    await expect(poller.poll()).resolves.toMatchObject({
      discovered: 2,
      posted: 2,
    })
    expect(publishReview.mock.calls.map(([value]) => value.id)).toEqual([
      'older',
      'newest',
    ])
    expect(api.listReviews).toHaveBeenCalledTimes(1)
    state.close()
  })

  it('marks nonmatching ratings seen so filter changes do not backfill them', async () => {
    const state = createState()
    state.markInitialized()
    const api = unusedApi()
    vi.mocked(api.listReviews).mockResolvedValue({
      data: [review('critical', { rating: 1 })],
      page: { nextCursor: null },
    })
    const publisher: ReviewPublisher = { publishReview: vi.fn() }
    const poller = new ReviewPoller({
      api,
      state,
      publisher,
      ratingFilter: 'positive',
      intervalMs: 60_000,
      logger,
    })

    await expect(poller.poll()).resolves.toMatchObject({
      filtered: 1,
      posted: 0,
    })
    expect(state.hasSeenReview('critical')).toBe(true)
    expect(publisher.publishReview).not.toHaveBeenCalled()
    state.close()
  })
})
