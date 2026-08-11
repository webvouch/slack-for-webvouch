import { mkdirSync } from 'node:fs'
import { join } from 'node:path'
import { DatabaseSync } from 'node:sqlite'

import type { SlackMessageReference } from './types.js'

export type ReplyAttemptStatus =
  | 'started'
  | 'api_completed'
  | 'card_updated'
  | 'completed'
  | 'failed'

export interface ReplyAttempt {
  viewId: string
  reviewId: string
  idempotencyKey: string
  status: ReplyAttemptStatus
}

interface CountRow {
  count: number
}

interface MessageRow {
  slack_channel: string
  slack_ts: string
}

interface ReplyAttemptRow {
  view_id: string
  review_id: string
  idempotency_key: string
  status: ReplyAttemptStatus
}

export class BridgeState {
  private readonly database: DatabaseSync

  constructor(stateDirectory: string) {
    mkdirSync(stateDirectory, { recursive: true, mode: 0o700 })
    this.database = new DatabaseSync(join(stateDirectory, 'bridge.sqlite'))
    this.database.exec('PRAGMA journal_mode = WAL;')
    this.database.exec('PRAGMA synchronous = FULL;')
    this.database.exec('PRAGMA foreign_keys = ON;')
    this.database.exec(`
      CREATE TABLE IF NOT EXISTS bridge_metadata (
        key TEXT PRIMARY KEY,
        value TEXT NOT NULL,
        updated_at TEXT NOT NULL
      ) STRICT;

      CREATE TABLE IF NOT EXISTS seen_reviews (
        review_id TEXT PRIMARY KEY,
        seen_at TEXT NOT NULL,
        posted INTEGER NOT NULL CHECK (posted IN (0, 1)),
        slack_channel TEXT,
        slack_ts TEXT,
        CHECK (
          (posted = 0 AND slack_channel IS NULL AND slack_ts IS NULL)
          OR
          (posted = 1 AND slack_channel IS NOT NULL AND slack_ts IS NOT NULL)
        )
      ) STRICT;

      CREATE TABLE IF NOT EXISTS reply_attempts (
        view_id TEXT PRIMARY KEY,
        review_id TEXT NOT NULL,
        idempotency_key TEXT NOT NULL UNIQUE,
        status TEXT NOT NULL CHECK (
          status IN (
            'started', 'api_completed', 'card_updated', 'completed', 'failed'
          )
        ),
        last_error TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        FOREIGN KEY (review_id) REFERENCES seen_reviews(review_id)
      ) STRICT;

      CREATE INDEX IF NOT EXISTS reply_attempts_status_idx
        ON reply_attempts(status, updated_at);
    `)
  }

  close(): void {
    this.database.close()
  }

  isInitialized(): boolean {
    const row = this.database
      .prepare(
        "SELECT COUNT(*) AS count FROM bridge_metadata WHERE key = 'initialized'",
      )
      .get() as unknown as CountRow
    return row.count === 1
  }

  markInitialized(): void {
    const now = new Date().toISOString()
    this.database
      .prepare(
        `INSERT INTO bridge_metadata (key, value, updated_at)
         VALUES ('initialized', 'true', ?)
         ON CONFLICT(key) DO UPDATE SET value = excluded.value,
           updated_at = excluded.updated_at`,
      )
      .run(now)
  }

  hasSeenReview(reviewId: string): boolean {
    const row = this.database
      .prepare('SELECT COUNT(*) AS count FROM seen_reviews WHERE review_id = ?')
      .get(reviewId) as unknown as CountRow
    return row.count === 1
  }

  recordSkippedReview(reviewId: string): void {
    this.database
      .prepare(
        `INSERT OR IGNORE INTO seen_reviews
          (review_id, seen_at, posted, slack_channel, slack_ts)
         VALUES (?, ?, 0, NULL, NULL)`,
      )
      .run(reviewId, new Date().toISOString())
  }

  recordPostedReview(reviewId: string, reference: SlackMessageReference): void {
    this.database
      .prepare(
        `INSERT OR REPLACE INTO seen_reviews
          (review_id, seen_at, posted, slack_channel, slack_ts)
         VALUES (?, ?, 1, ?, ?)`,
      )
      .run(reviewId, new Date().toISOString(), reference.channel, reference.ts)
  }

  messageForReview(reviewId: string): SlackMessageReference | undefined {
    const row = this.database
      .prepare(
        `SELECT slack_channel, slack_ts FROM seen_reviews
         WHERE review_id = ? AND posted = 1`,
      )
      .get(reviewId) as unknown as MessageRow | undefined
    return row ? { channel: row.slack_channel, ts: row.slack_ts } : undefined
  }

  beginReplyAttempt(input: {
    viewId: string
    reviewId: string
    idempotencyKey: string
  }): ReplyAttempt {
    const now = new Date().toISOString()
    this.database
      .prepare(
        `INSERT OR IGNORE INTO reply_attempts
          (view_id, review_id, idempotency_key, status, created_at, updated_at)
         VALUES (?, ?, ?, 'started', ?, ?)`,
      )
      .run(input.viewId, input.reviewId, input.idempotencyKey, now, now)
    const attempt = this.replyAttempt(input.viewId)
    if (!attempt) throw new Error('Reply attempt could not be persisted.')
    if (attempt.reviewId !== input.reviewId) {
      throw new Error('Slack view ID is already bound to another review.')
    }
    return attempt
  }

  replyAttempt(viewId: string): ReplyAttempt | undefined {
    const row = this.database
      .prepare(
        `SELECT view_id, review_id, idempotency_key, status
         FROM reply_attempts WHERE view_id = ?`,
      )
      .get(viewId) as unknown as ReplyAttemptRow | undefined
    return row ? this.mapReplyAttempt(row) : undefined
  }

  incompleteReplyAttempts(): ReplyAttempt[] {
    const rows = this.database
      .prepare(
        `SELECT view_id, review_id, idempotency_key, status
         FROM reply_attempts
         WHERE status IN ('started', 'api_completed', 'card_updated')
         ORDER BY created_at ASC`,
      )
      .all() as unknown as ReplyAttemptRow[]
    return rows.map((row) => this.mapReplyAttempt(row))
  }

  markReplyApiCompleted(viewId: string): void {
    this.updateReplyStatus(viewId, 'api_completed')
  }

  markReplyCardUpdated(viewId: string): void {
    this.updateReplyStatus(viewId, 'card_updated')
  }

  markReplyCompleted(viewId: string): void {
    this.updateReplyStatus(viewId, 'completed')
  }

  markReplyFailed(viewId: string, error: string): void {
    this.database
      .prepare(
        `UPDATE reply_attempts
         SET status = 'failed', last_error = ?, updated_at = ?
         WHERE view_id = ?`,
      )
      .run(error.slice(0, 500), new Date().toISOString(), viewId)
  }

  private updateReplyStatus(viewId: string, status: ReplyAttemptStatus): void {
    this.database
      .prepare(
        `UPDATE reply_attempts
         SET status = ?, last_error = NULL, updated_at = ?
         WHERE view_id = ?`,
      )
      .run(status, new Date().toISOString(), viewId)
  }

  private mapReplyAttempt(row: ReplyAttemptRow): ReplyAttempt {
    return {
      viewId: row.view_id,
      reviewId: row.review_id,
      idempotencyKey: row.idempotency_key,
      status: row.status,
    }
  }
}
