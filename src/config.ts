import { isAbsolute, resolve } from 'node:path'

import type { RatingFilter } from './types.js'

export type LogLevel = 'debug' | 'info' | 'warn' | 'error'

export interface BridgeConfig {
  webVouchApiBaseUrl: string
  webVouchClientId: string
  webVouchClientSecret: string
  slackBotToken: string
  slackAppToken: string
  slackChannelId: string
  pollIntervalMs: number
  ratingFilter: RatingFilter
  stateDir: string
  healthPort: number
  logLevel: LogLevel
}

function required(environment: NodeJS.ProcessEnv, name: string): string {
  const value = environment[name]?.trim()
  if (!value) {
    throw new Error(`${name} is required.`)
  }
  return value
}

function integerInRange(
  raw: string | undefined,
  fallback: number,
  name: string,
  minimum: number,
  maximum: number,
): number {
  const value = raw === undefined ? fallback : Number(raw)
  if (!Number.isInteger(value) || value < minimum || value > maximum) {
    throw new Error(`${name} must be an integer from ${minimum} to ${maximum}.`)
  }
  return value
}

function webVouchBaseUrl(environment: NodeJS.ProcessEnv): string {
  const raw =
    environment.WEBVOUCH_API_BASE_URL?.trim() || 'https://api.webvouch.com/api'
  let url: URL
  try {
    url = new URL(raw)
  } catch {
    throw new Error('WEBVOUCH_API_BASE_URL must be an absolute URL.')
  }

  const localHostnames = new Set(['localhost', '127.0.0.1', '[::1]', '::1'])
  const insecureAllowed =
    environment.WEBVOUCH_ALLOW_INSECURE_HTTP?.trim().toLowerCase() === 'true'
  if (
    url.protocol !== 'https:' &&
    !localHostnames.has(url.hostname) &&
    !insecureAllowed
  ) {
    throw new Error(
      'WEBVOUCH_API_BASE_URL must use HTTPS. Set WEBVOUCH_ALLOW_INSECURE_HTTP=true only for an isolated local test server.',
    )
  }
  if (url.username || url.password || url.search || url.hash) {
    throw new Error(
      'WEBVOUCH_API_BASE_URL cannot contain credentials, a query, or a fragment.',
    )
  }
  return url.toString().replace(/\/$/, '')
}

export function loadConfig(
  environment: NodeJS.ProcessEnv = process.env,
): BridgeConfig {
  const slackBotToken = required(environment, 'SLACK_BOT_TOKEN')
  if (!slackBotToken.startsWith('xoxb-')) {
    throw new Error('SLACK_BOT_TOKEN must be a bot token beginning with xoxb-.')
  }
  const slackAppToken = required(environment, 'SLACK_APP_TOKEN')
  if (!slackAppToken.startsWith('xapp-')) {
    throw new Error('SLACK_APP_TOKEN must begin with xapp-.')
  }
  const slackChannelId = required(environment, 'SLACK_CHANNEL_ID')
  if (!/^[CG][A-Z0-9]+$/.test(slackChannelId)) {
    throw new Error('SLACK_CHANNEL_ID must be a Slack channel ID.')
  }

  const ratingFilter = (environment.RATING_FILTER?.trim().toLowerCase() ||
    'all') as RatingFilter
  if (!['all', 'positive', 'critical'].includes(ratingFilter)) {
    throw new Error('RATING_FILTER must be all, positive, or critical.')
  }

  const stateDirInput = environment.STATE_DIR?.trim() || '/data'
  const stateDir = isAbsolute(stateDirInput)
    ? stateDirInput
    : resolve(process.cwd(), stateDirInput)
  const logLevel = (environment.LOG_LEVEL?.trim().toLowerCase() ||
    'info') as LogLevel
  if (!['debug', 'info', 'warn', 'error'].includes(logLevel)) {
    throw new Error('LOG_LEVEL must be debug, info, warn, or error.')
  }

  return {
    webVouchApiBaseUrl: webVouchBaseUrl(environment),
    webVouchClientId: required(environment, 'WEBVOUCH_CLIENT_ID'),
    webVouchClientSecret: required(environment, 'WEBVOUCH_CLIENT_SECRET'),
    slackBotToken,
    slackAppToken,
    slackChannelId,
    pollIntervalMs:
      integerInRange(
        environment.POLL_INTERVAL_SECONDS,
        60,
        'POLL_INTERVAL_SECONDS',
        30,
        3_600,
      ) * 1_000,
    ratingFilter,
    stateDir,
    healthPort: integerInRange(
      environment.HEALTH_PORT,
      8080,
      'HEALTH_PORT',
      1,
      65_535,
    ),
    logLevel,
  }
}
