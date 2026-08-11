import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { afterEach, describe, expect, it, vi } from 'vitest'

import type { BridgeConfig } from '../src/config.js'
import type { Logger } from '../src/logger.js'
import {
  REPLY_ACTION_ID,
  REPLY_MODAL_CALLBACK_ID,
} from '../src/slack-blocks.js'
import { SlackBridge } from '../src/slack.js'
import { BridgeState } from '../src/state.js'
import type { WebVouchApi } from '../src/types.js'
import { review } from './fixtures.js'

type Listener = (arguments_: Record<string, any>) => Promise<void>

interface FakeSlackApp {
  actions: Map<string, Listener>
  views: Map<string, Listener>
  client: {
    auth: { test: ReturnType<typeof vi.fn> }
    chat: {
      postMessage: ReturnType<typeof vi.fn>
      update: ReturnType<typeof vi.fn>
      postEphemeral: ReturnType<typeof vi.fn>
    }
    views: { open: ReturnType<typeof vi.fn> }
  }
}

const slackMock = vi.hoisted(() => ({
  instance: undefined as FakeSlackApp | undefined,
}))

vi.mock('@slack/bolt', () => ({
  App: class {
    readonly actions = new Map<string, Listener>()
    readonly views = new Map<string, Listener>()
    readonly client = {
      auth: {
        test: vi.fn().mockResolvedValue({
          ok: true,
          user_id: 'U_BOT',
          team_id: 'T_TEST',
        }),
      },
      chat: {
        postMessage: vi.fn().mockImplementation(async (input) => ({
          ok: true,
          channel: input.channel,
          ts: input.thread_ts ? 'thread.1' : 'message.1',
        })),
        update: vi.fn().mockResolvedValue({ ok: true }),
        postEphemeral: vi.fn().mockResolvedValue({ ok: true }),
      },
      views: { open: vi.fn().mockResolvedValue({ ok: true }) },
    }

    constructor() {
      slackMock.instance = this
    }

    action(actionId: string, listener: Listener) {
      this.actions.set(actionId, listener)
    }

    view(constraints: { callback_id: string }, listener: Listener) {
      this.views.set(constraints.callback_id, listener)
    }

    error() {}
    async start() {}
    async stop() {}
  },
}))

const directories: string[] = []
const logger: Logger = {
  debug: vi.fn(),
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
}
const config: BridgeConfig = {
  webVouchApiBaseUrl: 'https://api.example.test/api',
  webVouchClientId: 'client',
  webVouchClientSecret: 'secret',
  slackBotToken: 'xoxb-test',
  slackAppToken: 'xapp-test',
  slackChannelId: 'C0123456789',
  pollIntervalMs: 60_000,
  ratingFilter: 'all',
  stateDir: '/data',
  healthPort: 8080,
  logLevel: 'info',
}

afterEach(() => {
  slackMock.instance = undefined
  vi.clearAllMocks()
  for (const directory of directories.splice(0)) {
    rmSync(directory, { recursive: true, force: true })
  }
})

function createState() {
  const directory = mkdtempSync(join(tmpdir(), 'webvouch-bridge-slack-'))
  directories.push(directory)
  return new BridgeState(directory)
}

describe('Slack notification and reply flow', () => {
  it('posts the review, opens the emoji-button modal, and threads the public reply', async () => {
    const state = createState()
    const repliedReview = review('review_1', {
      reply: {
        id: 'reply_1',
        body: 'Thank you for your feedback.',
        isEdited: false,
        createdAt: '2026-08-07T12:01:00.000Z',
        updatedAt: '2026-08-07T12:01:00.000Z',
      },
    })
    const api: WebVouchApi = {
      getAccount: vi.fn(),
      listReviews: vi.fn(),
      getReview: vi.fn().mockResolvedValue(repliedReview),
      createReply: vi.fn().mockResolvedValue(repliedReview),
    }
    const bridge = new SlackBridge({ config, api, state, logger })
    const fake = slackMock.instance!

    await expect(bridge.publishReview(review('review_1'))).resolves.toEqual({
      channel: config.slackChannelId,
      ts: 'message.1',
    })
    state.recordPostedReview('review_1', {
      channel: config.slackChannelId,
      ts: 'message.1',
    })

    const actionAck = vi.fn()
    await fake.actions.get(REPLY_ACTION_ID)!({
      ack: actionAck,
      client: fake.client,
      body: {
        trigger_id: 'trigger_1',
        actions: [{ value: 'review_1' }],
        channel: { id: config.slackChannelId },
        message: { ts: 'message.1' },
      },
    })
    expect(actionAck).toHaveBeenCalledOnce()
    expect(fake.client.views.open).toHaveBeenCalledWith(
      expect.objectContaining({
        trigger_id: 'trigger_1',
        view: expect.objectContaining({ private_metadata: 'review_1' }),
      }),
    )

    const viewAck = vi.fn()
    await fake.views.get(REPLY_MODAL_CALLBACK_ID)!({
      ack: viewAck,
      client: fake.client,
      body: {
        user: { id: 'U_REPLIER' },
        view: {
          id: 'V_REPLY_1',
          private_metadata: 'review_1',
          state: {
            values: { reply: { body: { value: repliedReview.reply!.body } } },
          },
        },
      },
    })
    expect(viewAck).toHaveBeenCalledOnce()
    await bridge.stop()

    expect(api.createReply).toHaveBeenCalledWith(
      expect.objectContaining({
        reviewId: 'review_1',
        body: repliedReview.reply!.body,
        idempotencyKey: expect.stringMatching(/^slack-bridge:/),
      }),
    )
    expect(fake.client.chat.update).toHaveBeenCalledWith(
      expect.objectContaining({
        channel: config.slackChannelId,
        ts: 'message.1',
      }),
    )
    expect(fake.client.chat.postMessage).toHaveBeenLastCalledWith(
      expect.objectContaining({
        channel: config.slackChannelId,
        thread_ts: 'message.1',
        text: `Public reply: ${repliedReview.reply!.body}`,
      }),
    )
    expect(state.incompleteReplyAttempts()).toEqual([])
    state.close()
  })
})
