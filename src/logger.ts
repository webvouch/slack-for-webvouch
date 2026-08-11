import type { LogLevel } from './config.js'

const LEVELS: Record<LogLevel, number> = {
  debug: 10,
  info: 20,
  warn: 30,
  error: 40,
}

export interface Logger {
  debug(message: string, context?: Record<string, unknown>): void
  info(message: string, context?: Record<string, unknown>): void
  warn(message: string, context?: Record<string, unknown>): void
  error(message: string, context?: Record<string, unknown>): void
}

function safeContext(
  context: Record<string, unknown> | undefined,
): Record<string, unknown> {
  if (!context) return {}
  return Object.fromEntries(
    Object.entries(context).map(([key, value]) => [
      key,
      value instanceof Error
        ? { name: value.name, message: value.message }
        : value,
    ]),
  )
}

export function createLogger(minimumLevel: LogLevel): Logger {
  const write = (
    level: LogLevel,
    message: string,
    context?: Record<string, unknown>,
  ) => {
    if (LEVELS[level] < LEVELS[minimumLevel]) return
    const line = JSON.stringify({
      time: new Date().toISOString(),
      level,
      message,
      ...safeContext(context),
    })
    if (level === 'error') process.stderr.write(`${line}\n`)
    else process.stdout.write(`${line}\n`)
  }

  return {
    debug: (message, context) => write('debug', message, context),
    info: (message, context) => write('info', message, context),
    warn: (message, context) => write('warn', message, context),
    error: (message, context) => write('error', message, context),
  }
}
