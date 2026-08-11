import type { Server } from 'node:http'

import { loadConfig } from './config.js'
import { closeHealthServer, HealthState, startHealthServer } from './health.js'
import { createLogger } from './logger.js'
import { ReviewPoller } from './poller.js'
import { SlackBridge } from './slack.js'
import { BridgeState } from './state.js'
import { WebVouchClient } from './webvouch-client.js'

async function main(): Promise<void> {
  const config = loadConfig()
  const logger = createLogger(config.logLevel)

  if (process.argv.includes('--check-config')) {
    logger.info('Review Bridge configuration is valid.', {
      apiBaseUrl: config.webVouchApiBaseUrl,
      slackChannelId: config.slackChannelId,
      ratingFilter: config.ratingFilter,
      pollIntervalSeconds: config.pollIntervalMs / 1_000,
      stateDir: config.stateDir,
    })
    return
  }

  const health = new HealthState(Math.max(config.pollIntervalMs * 3, 180_000))
  let healthServer: Server | undefined
  let state: BridgeState | undefined
  let slack: SlackBridge | undefined
  let poller: ReviewPoller | undefined
  let shuttingDown = false

  const shutdown = async (signal: string) => {
    if (shuttingDown) return
    shuttingDown = true
    logger.info('Stopping Review Bridge.', { signal })
    poller?.stop()
    if (slack) await slack.stop()
    if (healthServer) await closeHealthServer(healthServer)
    state?.close()
    logger.info('Review Bridge stopped.')
  }

  try {
    healthServer = await startHealthServer({
      port: config.healthPort,
      state: health,
      logger,
    })
    state = new BridgeState(config.stateDir)
    const api = new WebVouchClient({
      apiBaseUrl: config.webVouchApiBaseUrl,
      clientId: config.webVouchClientId,
      clientSecret: config.webVouchClientSecret,
    })
    slack = new SlackBridge({ config, api, state, logger })
    await slack.start()
    health.markSlackAuthenticated()

    const account = await api.getAccount()
    const scopes = new Set(account.accessToken.scopes)
    if (!scopes.has('reviews:read') || !scopes.has('reviews:reply')) {
      throw new Error(
        'The WebVouch access token must include reviews:read and reviews:reply.',
      )
    }
    health.markWebVouchAuthenticated()
    logger.info('WebVouch Customer API authenticated.', {
      organizationId: account.organization.id,
      companyId: account.company.id,
    })

    await slack.recoverIncompleteReplies()
    poller = new ReviewPoller({
      api,
      state,
      publisher: slack,
      ratingFilter: config.ratingFilter,
      intervalMs: config.pollIntervalMs,
      logger,
      onSuccess: () => health.markPollSucceeded(),
      onFailure: (error) => health.markPollFailed(error),
    })
    await poller.start()

    process.once('SIGTERM', () => {
      void shutdown('SIGTERM').then(() => process.exit(0))
    })
    process.once('SIGINT', () => {
      void shutdown('SIGINT').then(() => process.exit(0))
    })
  } catch (error) {
    logger.error('Review Bridge could not start.', { error })
    await shutdown('startup_failure')
    throw error
  }
}

void main().catch(() => {
  process.exitCode = 1
})
