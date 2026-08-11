import { describe, expect, it } from 'vitest'

import {
  buildRepliedReviewBlocks,
  buildReplyModal,
  buildReplyThreadBlocks,
  buildReviewBlocks,
  REPLY_ACTION_ID,
} from '../src/slack-blocks.js'
import { review } from './fixtures.js'

describe('Slack Block Kit messages', () => {
  it('renders a review with an accessible emoji reply button', () => {
    const blocks = buildReviewBlocks(review('review_1'))
    expect(blocks).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          type: 'actions',
          elements: [
            expect.objectContaining({
              action_id: REPLY_ACTION_ID,
              accessibility_label: 'Reply publicly to this review in WebVouch',
              value: 'review_1',
              text: expect.objectContaining({
                text: '💬 Reply to review',
                emoji: true,
              }),
            }),
          ],
        }),
      ]),
    )
  })

  it('uses Slack’s 3,000-character modal limit', () => {
    const modal = buildReplyModal({ reviewId: 'review_1' })
    expect(modal.private_metadata).toBe('review_1')
    expect(modal.blocks).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          type: 'input',
          element: expect.objectContaining({ max_length: 3_000 }),
        }),
      ]),
    )
  })

  it('removes the button and shows the exact persisted reply in the thread', () => {
    const replied = review('review_1', {
      reply: {
        id: 'reply_1',
        body: 'Thank you for your feedback.',
        isEdited: false,
        createdAt: '2026-08-07T12:01:00.000Z',
        updatedAt: '2026-08-07T12:01:00.000Z',
      },
    })
    expect(
      buildRepliedReviewBlocks(replied).some(
        (block) => block.type === 'actions',
      ),
    ).toBe(false)
    expect(
      JSON.stringify(buildReplyThreadBlocks(replied.reply!.body)),
    ).toContain(replied.reply!.body)
  })
})
