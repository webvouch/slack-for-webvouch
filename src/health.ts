import { createServer, type Server } from 'node:http'

import type { Logger } from './logger.js'

interface HealthSnapshot {
  slackAuthenticated: boolean
  webVouchAuthenticated: boolean
  lastPollSucceededAt: number | undefined
  lastPollError: string | undefined
}

export class HealthState {
  private readonly startedAt = Date.now()
  private readonly snapshot: HealthSnapshot = {
    slackAuthenticated: false,
    webVouchAuthenticated: false,
    lastPollSucceededAt: undefined,
    lastPollError: undefined,
  }

  constructor(private readonly maximumPollAgeMs: number) {}

  markSlackAuthenticated(): void {
    this.snapshot.slackAuthenticated = true
  }

  markWebVouchAuthenticated(): void {
    this.snapshot.webVouchAuthenticated = true
  }

  markPollSucceeded(): void {
    this.snapshot.lastPollSucceededAt = Date.now()
    this.snapshot.lastPollError = undefined
  }

  markPollFailed(error: unknown): void {
    this.snapshot.lastPollError =
      error instanceof Error ? error.message : 'Review poll failed.'
  }

  liveness() {
    return {
      status: 'ok',
      uptimeSeconds: Math.floor((Date.now() - this.startedAt) / 1_000),
    }
  }

  readiness() {
    const pollFresh =
      this.snapshot.lastPollSucceededAt !== undefined &&
      Date.now() - this.snapshot.lastPollSucceededAt <= this.maximumPollAgeMs
    const ready =
      this.snapshot.slackAuthenticated &&
      this.snapshot.webVouchAuthenticated &&
      pollFresh
    return {
      ready,
      slackAuthenticated: this.snapshot.slackAuthenticated,
      webVouchAuthenticated: this.snapshot.webVouchAuthenticated,
      pollFresh,
      lastPollSucceededAt: this.snapshot.lastPollSucceededAt
        ? new Date(this.snapshot.lastPollSucceededAt).toISOString()
        : null,
      lastPollError: this.snapshot.lastPollError ?? null,
    }
  }
}

export async function startHealthServer(input: {
  port: number
  state: HealthState
  logger: Logger
}): Promise<Server> {
  const server = createServer((request, response) => {
    response.setHeader('content-type', 'application/json; charset=utf-8')
    response.setHeader('cache-control', 'no-store')
    if (request.method !== 'GET') {
      response.statusCode = 405
      response.end(JSON.stringify({ error: 'Method not allowed.' }))
      return
    }
    if (request.url === '/healthz') {
      response.statusCode = 200
      response.end(JSON.stringify(input.state.liveness()))
      return
    }
    if (request.url === '/readyz') {
      const readiness = input.state.readiness()
      response.statusCode = readiness.ready ? 200 : 503
      response.end(JSON.stringify(readiness))
      return
    }
    response.statusCode = 404
    response.end(JSON.stringify({ error: 'Not found.' }))
  })

  await new Promise<void>((resolve, reject) => {
    server.once('error', reject)
    server.listen(input.port, '0.0.0.0', () => {
      server.off('error', reject)
      resolve()
    })
  })
  input.logger.info('Health server listening.', { port: input.port })
  return server
}

export async function closeHealthServer(server: Server): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    server.close((error) => (error ? reject(error) : resolve()))
  })
}
