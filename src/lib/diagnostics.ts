export type DiagCategory =
  | 'ok'
  | 'timeout'
  | 'network'
  | 'offline'
  | 'rate_limit'
  | 'server'
  | 'credentials'
  | 'auth_expired'
  | 'not_found'
  | 'incomplete'
  | 'unknown'
  | 'aborted'
  | 'file'

export interface DiagnosticEvent {
  operation: string
  timestamp: string
  durationMs: number
  category: DiagCategory
}

const buffer: DiagnosticEvent[] = []
const MAX_EVENTS = 30

/** Sanitized in-memory log. Never pass tokens, passwords, or row data. */
export function recordDiagnostic(event: DiagnosticEvent) {
  buffer.push(event)
  if (buffer.length > MAX_EVENTS) buffer.shift()
  if (event.category !== 'ok' && event.category !== 'aborted') {
    console.warn(
      `[azs] ${event.operation} ${event.category} ${event.durationMs}ms ${event.timestamp}`,
    )
  }
}

export function recentDiagnostics(): readonly DiagnosticEvent[] {
  return buffer
}

export function lastDiagnostic(operation: string): DiagnosticEvent | undefined {
  for (let i = buffer.length - 1; i >= 0; i -= 1) {
    if (buffer[i].operation === operation) return buffer[i]
  }
  return undefined
}
