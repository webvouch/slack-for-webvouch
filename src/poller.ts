import type { Logger } from './logger.js'
import { BridgeState } from './state.js'
import type {
  RatingFilter,
  ReviewPublisher,
  WebVouchApi,
  WebVouchReview,
} from './types.js'

export interface PollResult {
  bootstrapped: boolean
  discovered: number
  posted: number
  filtered: number
}

function matchesFilter(review: WebVouchReview, filter: RatingFilter): boolean {
  if (filter === 'positive') return review.rating >= 4
  if (filter === 'critical') return review.rating <= 2
  return true
}

export class ReviewPoller {
  private timer: NodeJS.Timeout | undefined
  private stopped = false
  private polling = false

  constructor(
    private readonly dependencies: {
      api: WebVouchApi
      state: BridgeState
      publisher: ReviewPublisher
      ratingFilter: RatingFilter
      intervalMs: number
      logger: Logger
      onSuccess?: (result: PollResult) => void
      onFailure?: (error: unknown) => void
    },
  ) {}

  async poll(): Promise<PollResult> {
    if (this.polling) {
      return { bootstrapped: false, discovered: 0, posted: 0, filtered: 0 }
    }
    this.polling = true
    try {
      const result = this.dependencies.state.isInitialized()
        ? await this.pollNewReviews()
        : await this.bootstrap()
      this.dependencies.onSuccess?.(result)
      return result
    } catch (error) {
      this.dependencies.onFailure?.(error)
      throw error
    } finally {
      this.polling = false
    }
  }

  async start(): Promise<void> {
    this.stopped = false
    const run = async () => {
      try {
        const result = await this.poll()
        this.dependencies.logger.info('Review poll completed.', { ...result })
      } catch (error) {
        this.dependencies.logger.error('Review poll failed.', { error })
      } finally {
        if (!this.stopped) {
          this.timer = setTimeout(run, this.dependencies.intervalMs)
          this.timer.unref()
        }
      }
    }
    await run()
  }

  stop(): void {
    this.stopped = true
    if (this.timer) clearTimeout(this.timer)
    this.timer = undefined
  }

  private async bootstrap(): Promise<PollResult> {
    let cursor: string | undefined
    let discovered = 0
    do {
      const page = await this.dependencies.api.listReviews(cursor)
      for (const review of page.data) {
        this.dependencies.state.recordSkippedReview(review.id)
        discovered += 1
      }
      cursor = page.page.nextCursor ?? undefined
    } while (cursor)
    this.dependencies.state.markInitialized()
    return { bootstrapped: true, discovered, posted: 0, filtered: discovered }
  }

  private async pollNewReviews(): Promise<PollResult> {
    const unseen: WebVouchReview[] = []
    let cursor: string | undefined
    let reachedSeenReview = false

    do {
      const page = await this.dependencies.api.listReviews(cursor)
      for (const review of page.data) {
        if (this.dependencies.state.hasSeenReview(review.id)) {
          reachedSeenReview = true
          break
        }
        unseen.push(review)
      }
      cursor = page.page.nextCursor ?? undefined
    } while (cursor && !reachedSeenReview)

    let posted = 0
    let filtered = 0
    for (const review of unseen.reverse()) {
      if (!matchesFilter(review, this.dependencies.ratingFilter)) {
        this.dependencies.state.recordSkippedReview(review.id)
        filtered += 1
        continue
      }
      const reference = await this.dependencies.publisher.publishReview(review)
      this.dependencies.state.recordPostedReview(review.id, reference)
      posted += 1
    }

    return {
      bootstrapped: false,
      discovered: unseen.length,
      posted,
      filtered,
    }
  }
}
