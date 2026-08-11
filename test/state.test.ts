import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { afterEach, describe, expect, it } from 'vitest'

import { BridgeState } from '../src/state.js'

const directories: string[] = []

afterEach(() => {
  for (const directory of directories.splice(0)) {
    rmSync(directory, { recursive: true, force: true })
  }
})

function state(): BridgeState {
  const directory = mkdtempSync(join(tmpdir(), 'webvouch-bridge-state-'))
  directories.push(directory)
  return new BridgeState(directory)
}

describe('Review Bridge SQLite state', () => {
  it('persists bootstrap state and Slack message references', () => {
    const store = state()
    expect(store.isInitialized()).toBe(false)
    store.markInitialized()
    store.recordSkippedReview('review_skipped')
    store.recordPostedReview('review_posted', {
      channel: 'C0123456789',
      ts: '123.456',
    })
    expect(store.isInitialized()).toBe(true)
    expect(store.hasSeenReview('review_skipped')).toBe(true)
    expect(store.messageForReview('review_posted')).toEqual({
      channel: 'C0123456789',
      ts: '123.456',
    })
    store.close()
  })

  it('tracks restart-safe reply steps without storing the reply body', () => {
    const store = state()
    store.recordPostedReview('review_1', {
      channel: 'C0123456789',
      ts: '123.456',
    })
    const attempt = store.beginReplyAttempt({
      viewId: 'view_1',
      reviewId: 'review_1',
      idempotencyKey: 'slack-bridge:12345678',
    })
    expect(attempt.status).toBe('started')
    store.markReplyApiCompleted('view_1')
    store.markReplyCardUpdated('view_1')
    expect(store.incompleteReplyAttempts()[0]?.status).toBe('card_updated')
    store.markReplyCompleted('view_1')
    expect(store.incompleteReplyAttempts()).toEqual([])
    store.close()
  })
})
