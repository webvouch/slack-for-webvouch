export type RatingFilter = 'all' | 'positive' | 'critical'

export interface WebVouchReview {
  id: string
  author: {
    name: string
    initial: string
    location: string | null
    reviewCount: number
  }
  rating: 1 | 2 | 3 | 4 | 5
  title: string | null
  body: string
  source: string
  externalUrl: string | null
  isVerified: boolean
  isEdited: boolean
  helpfulCount: number
  createdAt: string
  updatedAt: string
  businessArchivedAt: string | null
  reportedAt: string | null
  reportReason: string | null
  reply: {
    id: string
    body: string
    isEdited: boolean
    createdAt: string
    updatedAt: string
  } | null
  attachments: Array<{
    id: string
    url: string
    width: number
    height: number
  }>
  shareUrl: string | null
}

export interface ReviewPage {
  data: WebVouchReview[]
  page: { nextCursor: string | null }
}

export interface SlackMessageReference {
  channel: string
  ts: string
}

export interface WebVouchAccount {
  organization: { id: string; name: string; slug: string }
  company: { id: string; name: string; slug: string }
  accessToken: { scopes: string[]; expiresAt: string }
}

export interface WebVouchApi {
  getAccount(): Promise<WebVouchAccount>
  listReviews(cursor?: string): Promise<ReviewPage>
  getReview(reviewId: string): Promise<WebVouchReview>
  createReply(input: {
    reviewId: string
    body: string
    idempotencyKey: string
  }): Promise<WebVouchReview>
}

export interface ReviewPublisher {
  publishReview(review: WebVouchReview): Promise<SlackMessageReference>
}
