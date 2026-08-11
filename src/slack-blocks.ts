import type { KnownBlock, ModalView } from '@slack/types'

import type { WebVouchReview } from './types.js'

export const REPLY_ACTION_ID = 'webvouch_bridge_reply'
export const REPLY_MODAL_CALLBACK_ID = 'webvouch_bridge_reply_modal'
export const REPLY_BLOCK_ID = 'reply'
export const REPLY_INPUT_ACTION_ID = 'body'

function truncate(value: string, maximum: number): string {
  const normalized = value.replace(
    /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g,
    '',
  )
  return normalized.length <= maximum
    ? normalized
    : `${normalized.slice(0, Math.max(0, maximum - 1))}…`
}

function reviewText(review: WebVouchReview): string {
  const stars = `${'★'.repeat(review.rating)}${'☆'.repeat(5 - review.rating)}`
  return truncate(
    `${stars}\n${review.title ? `${review.title}\n` : ''}${review.body}\n— ${review.author.name}`,
    2_900,
  )
}

export function reviewFallbackText(review: WebVouchReview): string {
  return truncate(
    `New ${review.rating}-star WebVouch review from ${review.author.name}: ${review.title ?? review.body}`,
    250,
  )
}

export function buildReviewBlocks(review: WebVouchReview): KnownBlock[] {
  const created = Math.floor(new Date(review.createdAt).getTime() / 1_000)
  return [
    {
      type: 'header',
      text: {
        type: 'plain_text',
        text: `New ${review.rating}-star WebVouch review`,
        emoji: true,
      },
    },
    {
      type: 'section',
      text: { type: 'plain_text', text: reviewText(review), emoji: true },
    },
    {
      type: 'context',
      elements: [
        {
          type: 'mrkdwn',
          text: Number.isFinite(created)
            ? `Received <!date^${created}^{date_short_pretty} at {time}|${review.createdAt}> · ${review.isVerified ? 'Verified' : 'Unverified'}`
            : `${review.isVerified ? 'Verified' : 'Unverified'} review`,
        },
      ],
    },
    {
      type: 'actions',
      block_id: 'webvouch_bridge_review_actions',
      elements: [
        {
          type: 'button',
          action_id: REPLY_ACTION_ID,
          text: {
            type: 'plain_text',
            text: '💬 Reply to review',
            emoji: true,
          },
          accessibility_label: 'Reply publicly to this review in WebVouch',
          value: review.id,
          style: 'primary',
        },
      ],
    },
  ]
}

export function buildRepliedReviewBlocks(review: WebVouchReview): KnownBlock[] {
  return [
    ...buildReviewBlocks(review).filter((block) => block.type !== 'actions'),
    {
      type: 'context',
      elements: [
        {
          type: 'plain_text',
          text: 'Public reply posted on WebVouch. View it in this message’s thread.',
          emoji: true,
        },
      ],
    },
  ]
}

export function buildReplyThreadBlocks(replyBody: string): KnownBlock[] {
  return [
    {
      type: 'section',
      text: {
        type: 'plain_text',
        text: truncate(`Public reply\n${replyBody}`, 2_900),
        emoji: true,
      },
    },
    {
      type: 'context',
      elements: [
        {
          type: 'plain_text',
          text: 'Published on WebVouch from Slack.',
          emoji: true,
        },
      ],
    },
  ]
}

export function buildReplyModal(input: { reviewId: string }): ModalView {
  return {
    type: 'modal',
    callback_id: REPLY_MODAL_CALLBACK_ID,
    private_metadata: input.reviewId,
    title: { type: 'plain_text', text: 'Reply to review', emoji: true },
    submit: { type: 'plain_text', text: 'Post reply', emoji: true },
    close: { type: 'plain_text', text: 'Cancel', emoji: true },
    blocks: [
      {
        type: 'input',
        block_id: REPLY_BLOCK_ID,
        label: {
          type: 'plain_text',
          text: 'Public reply',
          emoji: true,
        },
        element: {
          type: 'plain_text_input',
          action_id: REPLY_INPUT_ACTION_ID,
          multiline: true,
          min_length: 1,
          max_length: 3_000,
        },
      },
    ],
  }
}
