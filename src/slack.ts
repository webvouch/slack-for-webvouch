import { createHash } from 'node:crypto'

import {
  App,
  type BlockAction,
  type ViewSubmitAction,
  type webApi,
} from '@slack/bolt'

import type { BridgeConfig } from './config.js'
import type { Logger } from './logger.js'
import {
  buildRepliedReviewBlocks,
  buildReplyModal,
  buildReplyThreadBlocks,
  buildReviewBlocks,
  REPLY_ACTION_ID,
  REPLY_BLOCK_ID,
  REPLY_INPUT_ACTION_ID,
  REPLY_MODAL_CALLBACK_ID,
  reviewFallbackText,
} from './slack-blocks.js'
import { BridgeState, type ReplyAttempt } from './state.js'
import type {
  ReviewPublisher,
  SlackMessageReference,
  WebVouchApi,
  WebVouchReview,
} from './types.js'
import { WebVouchApiError } from './webvouch-client.js'

function idempotencyKey(viewId: string, reviewId: string): string {
  const digest = createHash('sha256')
    .update(`${viewId}:${reviewId}`)
    .digest('hex')
    .slice(0, 48)
  return `slack-bridge:${digest}`
}

function actionValue(body: BlockAction): string | undefined {
  const value = (body.actions[0] as { value?: unknown } | undefined)?.value
  return typeof value === 'string' && value.length > 0 ? value : undefined
}

function replyBody(body: ViewSubmitAction): string | undefined {
  const value =
    body.view.state.values[REPLY_BLOCK_ID]?.[REPLY_INPUT_ACTION_ID]?.value
  return typeof value === 'string' ? value.trim() : undefined
}

function safeFailureMessage(error: unknown): string {
  if (error instanceof WebVouchApiError && error.status === 409) {
    return 'This review already has a public reply. Refresh WebVouch before trying again.'
  }
  if (error instanceof WebVouchApiError && error.status === 403) {
    return 'WebVouch refused this reply. Check the API client scope and account plan.'
  }
  return 'The public reply could not be published. Check the Review Bridge logs and try again.'
}

export class SlackBridge implements ReviewPublisher {
  private readonly app: App
  private readonly pendingTasks = new Set<Promise<void>>()

  constructor(
    private readonly dependencies: {
      config: BridgeConfig
      api: WebVouchApi
      state: BridgeState
      logger: Logger
    },
  ) {
    this.app = new App({
      token: dependencies.config.slackBotToken,
      appToken: dependencies.config.slackAppToken,
      socketMode: true,
    })
    this.registerListeners()
    this.app.error(async (error) => {
      this.dependencies.logger.error('Slack Bolt listener failed.', { error })
    })
  }

  async start(): Promise<void> {
    await this.app.start()
    const authentication = await this.app.client.auth.test()
    if (
      !authentication.ok ||
      !authentication.user_id ||
      !authentication.team_id
    ) {
      throw new Error(
        'Slack bot authentication did not return a team and user.',
      )
    }
    this.dependencies.logger.info('Slack Socket Mode connected.', {
      teamId: authentication.team_id,
      botUserId: authentication.user_id,
      channelId: this.dependencies.config.slackChannelId,
    })
  }

  async stop(): Promise<void> {
    await Promise.allSettled([...this.pendingTasks])
    await this.app.stop()
  }

  async publishReview(review: WebVouchReview): Promise<SlackMessageReference> {
    const result = await this.app.client.chat.postMessage({
      channel: this.dependencies.config.slackChannelId,
      text: reviewFallbackText(review),
      blocks: buildReviewBlocks(review),
      unfurl_links: false,
      unfurl_media: false,
    })
    if (typeof result.channel !== 'string' || typeof result.ts !== 'string') {
      throw new Error('Slack did not return a message channel and timestamp.')
    }
    return { channel: result.channel, ts: result.ts }
  }

  async recoverIncompleteReplies(): Promise<void> {
    for (const attempt of this.dependencies.state.incompleteReplyAttempts()) {
      try {
        const review = await this.dependencies.api.getReview(attempt.reviewId)
        if (!review.reply) {
          this.dependencies.state.markReplyFailed(
            attempt.viewId,
            'No WebVouch reply exists for this interrupted attempt.',
          )
          continue
        }
        if (attempt.status === 'started') {
          this.dependencies.state.markReplyApiCompleted(attempt.viewId)
        }
        await this.finishSlackReply(
          this.dependencies.state.replyAttempt(attempt.viewId) ?? attempt,
          review,
        )
      } catch (error) {
        this.dependencies.logger.error('Reply recovery failed.', {
          error,
          reviewId: attempt.reviewId,
          viewId: attempt.viewId,
        })
      }
    }
  }

  private registerListeners(): void {
    this.app.action<BlockAction>(
      REPLY_ACTION_ID,
      async ({ body, ack, client }) => {
        await ack()
        const reviewId = actionValue(body)
        const channelId = body.channel?.id
        const messageTs = body.message?.ts
        if (!reviewId || !channelId || !messageTs) {
          this.dependencies.logger.warn(
            'Rejected incomplete Slack reply action.',
          )
          return
        }
        const reference = this.dependencies.state.messageForReview(reviewId)
        if (
          channelId !== this.dependencies.config.slackChannelId ||
          !reference ||
          reference.channel !== channelId ||
          reference.ts !== messageTs
        ) {
          this.dependencies.logger.warn(
            'Rejected Slack action outside its review card.',
            {
              reviewId,
              channelId,
            },
          )
          return
        }
        try {
          await client.views.open({
            trigger_id: body.trigger_id,
            view: buildReplyModal({ reviewId }),
          })
        } catch (error) {
          this.dependencies.logger.error(
            'Slack reply modal could not be opened.',
            {
              error,
              reviewId,
            },
          )
        }
      },
    )

    this.app.view<ViewSubmitAction>(
      { callback_id: REPLY_MODAL_CALLBACK_ID, type: 'view_submission' },
      async ({ body, ack, client }) => {
        const reviewId = body.view.private_metadata?.trim()
        const submittedBody = replyBody(body)
        if (!reviewId || !submittedBody || submittedBody.length > 3_000) {
          await ack({
            response_action: 'errors',
            errors: {
              [REPLY_BLOCK_ID]:
                'Enter a public reply between 1 and 3,000 characters.',
            },
          })
          return
        }
        if (!this.dependencies.state.messageForReview(reviewId)) {
          await ack({
            response_action: 'errors',
            errors: {
              [REPLY_BLOCK_ID]:
                'This review card is no longer managed by this bridge.',
            },
          })
          return
        }

        await ack()
        this.track(
          this.processReply({
            viewId: body.view.id,
            reviewId,
            body: submittedBody,
            userId: body.user.id,
            client,
          }),
        )
      },
    )
  }

  private track(task: Promise<void>): void {
    this.pendingTasks.add(task)
    void task.finally(() => this.pendingTasks.delete(task))
  }

  private async processReply(input: {
    viewId: string
    reviewId: string
    body: string
    userId: string
    client: webApi.WebClient
  }): Promise<void> {
    const attempt = this.dependencies.state.beginReplyAttempt({
      viewId: input.viewId,
      reviewId: input.reviewId,
      idempotencyKey: idempotencyKey(input.viewId, input.reviewId),
    })
    if (attempt.status === 'completed') return

    try {
      let review: WebVouchReview
      if (attempt.status === 'started') {
        review = await this.createReplyWithRetry(attempt, input.body)
        this.dependencies.state.markReplyApiCompleted(attempt.viewId)
      } else {
        review = await this.dependencies.api.getReview(attempt.reviewId)
      }
      if (!review.reply) {
        throw new Error(
          'WebVouch accepted the request without returning a reply.',
        )
      }
      await this.finishSlackReply(
        this.dependencies.state.replyAttempt(attempt.viewId) ?? attempt,
        review,
      )
      this.dependencies.logger.info('Public review reply completed.', {
        reviewId: input.reviewId,
        slackUserId: input.userId,
      })
    } catch (error) {
      this.dependencies.state.markReplyFailed(
        attempt.viewId,
        error instanceof Error ? error.message : 'Unknown reply failure.',
      )
      this.dependencies.logger.error('Public review reply failed.', {
        error,
        reviewId: input.reviewId,
        slackUserId: input.userId,
      })
      await this.postEphemeralFailure(
        input.client,
        input.reviewId,
        input.userId,
        safeFailureMessage(error),
      )
    }
  }

  private async createReplyWithRetry(
    attempt: ReplyAttempt,
    body: string,
  ): Promise<WebVouchReview> {
    let lastError: unknown
    for (let execution = 1; execution <= 3; execution += 1) {
      try {
        return await this.dependencies.api.createReply({
          reviewId: attempt.reviewId,
          body,
          idempotencyKey: attempt.idempotencyKey,
        })
      } catch (error) {
        lastError = error
        const retryable =
          error instanceof WebVouchApiError &&
          (error.status === 429 || error.status >= 500)
        if (!retryable || execution === 3) throw error
        const delayMs = Math.min(
          30_000,
          Math.max(
            (error.retryAfterSeconds ?? 0) * 1_000,
            500 * 2 ** (execution - 1),
          ),
        )
        await new Promise((resolve) => setTimeout(resolve, delayMs))
      }
    }
    throw lastError
  }

  private async finishSlackReply(
    attempt: ReplyAttempt,
    review: WebVouchReview,
  ): Promise<void> {
    if (!review.reply) throw new Error('Review does not contain a reply.')
    const reference = this.dependencies.state.messageForReview(review.id)
    if (!reference) throw new Error('Slack message reference is missing.')

    if (attempt.status === 'started' || attempt.status === 'api_completed') {
      await this.app.client.chat.update({
        channel: reference.channel,
        ts: reference.ts,
        text: `${reviewFallbackText(review)} Public reply posted.`,
        blocks: buildRepliedReviewBlocks(review),
      })
      this.dependencies.state.markReplyCardUpdated(attempt.viewId)
      attempt = this.dependencies.state.replyAttempt(attempt.viewId) ?? attempt
    }

    if (attempt.status === 'card_updated') {
      await this.app.client.chat.postMessage({
        channel: reference.channel,
        thread_ts: reference.ts,
        text: `Public reply: ${review.reply.body}`,
        blocks: buildReplyThreadBlocks(review.reply.body),
        unfurl_links: false,
        unfurl_media: false,
      })
      this.dependencies.state.markReplyCompleted(attempt.viewId)
    }
  }

  private async postEphemeralFailure(
    client: webApi.WebClient,
    reviewId: string,
    userId: string,
    message: string,
  ): Promise<void> {
    const reference = this.dependencies.state.messageForReview(reviewId)
    if (!reference) return
    try {
      await client.chat.postEphemeral({
        channel: reference.channel,
        user: userId,
        thread_ts: reference.ts,
        text: message,
      })
    } catch (error) {
      this.dependencies.logger.error(
        'Slack failure notice could not be posted.',
        {
          error,
          reviewId,
        },
      )
    }
  }
}
