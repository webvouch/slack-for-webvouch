import type { WebVouchReview } from '../src/types.js'

export function review(
  id: string,
  overrides: Partial<WebVouchReview> = {},
): WebVouchReview {
  return {
    id,
    author: {
      name: 'Ada Customer',
      initial: 'A',
      location: 'Warsaw',
      reviewCount: 1,
    },
    rating: 5,
    title: 'Excellent service',
    body: 'The order arrived quickly.',
    source: 'webvouch',
    externalUrl: null,
    isVerified: true,
    isEdited: false,
    helpfulCount: 0,
    createdAt: '2026-08-07T12:00:00.000Z',
    updatedAt: '2026-08-07T12:00:00.000Z',
    businessArchivedAt: null,
    reportedAt: null,
    reportReason: null,
    reply: null,
    attachments: [],
    shareUrl: 'https://webvouch.com/reviews/example',
    ...overrides,
  }
}
