import { describe, expect, it } from 'vitest'

import { loadConfig } from '../src/config.js'

const validEnvironment: NodeJS.ProcessEnv = {
  WEBVOUCH_CLIENT_ID: 'wv_client_test',
  WEBVOUCH_CLIENT_SECRET: 'secret',
  SLACK_BOT_TOKEN: 'xoxb-test',
  SLACK_APP_TOKEN: 'xapp-test',
  SLACK_CHANNEL_ID: 'C0123456789',
}

describe('Review Bridge configuration', () => {
  it('uses secure production defaults', () => {
    const config = loadConfig(validEnvironment)
    expect(config).toMatchObject({
      webVouchApiBaseUrl: 'https://api.webvouch.com/api',
      pollIntervalMs: 60_000,
      ratingFilter: 'all',
      stateDir: '/data',
      healthPort: 8080,
      logLevel: 'info',
    })
  })

  it('rejects malformed Slack tokens and an insecure remote API URL', () => {
    expect(() =>
      loadConfig({ ...validEnvironment, SLACK_BOT_TOKEN: 'xoxp-wrong' }),
    ).toThrow(/xoxb-/)
    expect(() =>
      loadConfig({
        ...validEnvironment,
        WEBVOUCH_API_BASE_URL: 'http://api.example.test/api',
      }),
    ).toThrow(/must use HTTPS/)
  })

  it('accepts localhost HTTP for an isolated development API', () => {
    expect(
      loadConfig({
        ...validEnvironment,
        WEBVOUCH_API_BASE_URL: 'http://127.0.0.1:4000/api/',
      }).webVouchApiBaseUrl,
    ).toBe('http://127.0.0.1:4000/api')
  })
})
