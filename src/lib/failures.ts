import { lastDiagnostic, recordDiagnostic, type DiagCategory } from './diagnostics'

export type ErrorCategory = Exclude<DiagCategory, 'ok'>
export type Outcome = 'failed' | 'unknown'
export type OperationKind = 'read' | 'write'

const RUSSIAN: Record<ErrorCategory, string> = {
  timeout: 'Превышено время ожидания. Проверьте соединение и повторите попытку.',
  network: 'Не удалось связаться с сервером. Проверьте соединение и повторите попытку.',
  offline: 'Похоже, устройство не в сети. Наличие сети не гарантирует доступ к серверу.',
  rate_limit: 'Слишком много запросов. Подождите немного и повторите попытку.',
  server: 'Сервер временно недоступен. Повторите попытку.',
  credentials: 'Неверный email или пароль',
  auth_expired: 'Сессия истекла. Войдите снова.',
  not_found: 'Станция не существует или неактивна.',
  incomplete: 'Список станций загружен не полностью. Повторите попытку.',
  unknown: 'Не удалось выполнить запрос. Повторите попытку.',
  aborted: 'Запрос отменён.',
  file: 'Не удалось прочитать файл.',
}

export const WRITE_UNKNOWN_MESSAGE =
  'Запрос отправлен, но ответ не получен. Результат неизвестен. Не повторяйте действие, пока не проверите, применилось ли оно.'

export const SESSION_RETRY_MESSAGE =
  'Не удалось восстановить сессию. Данные входа сохранены на устройстве. Повторите попытку.'

export const STATIONS_FAILED_MESSAGE = 'Не удалось загрузить станции. Повторите попытку.'
export const STATION_FAILED_MESSAGE = 'Не удалось загрузить станцию. Повторите попытку.'
export const SIGN_OUT_FAILED_MESSAGE = 'Не удалось выйти. Повторите попытку.'
export const CHUNK_FAILED_MESSAGE = 'Не удалось загрузить раздел. Повторите попытку.'

export class AppFailure extends Error {
  readonly category: ErrorCategory
  readonly outcome: Outcome
  readonly operation: string
  readonly userMessage: string
  readonly detail: string
  readonly timestamp: string
  readonly durationMs: number

  constructor(init: {
    category: ErrorCategory
    outcome: Outcome
    operation: string
    userMessage?: string
    durationMs?: number
    timestamp?: string
  }) {
    super(`${init.category}:${init.operation}`)
    this.name = 'AppFailure'
    this.category = init.category
    this.outcome = init.outcome
    this.operation = init.operation
    this.timestamp = init.timestamp ?? new Date().toISOString()
    this.durationMs = init.durationMs ?? 0
    this.userMessage = init.userMessage ?? messageFor(init.category, init.outcome)
    this.detail = `Код: ${this.category} · ${this.operation} · ${this.durationMs} мс · ${this.timestamp}`
  }
}

export function messageFor(category: ErrorCategory, outcome: Outcome = 'failed'): string {
  if (outcome === 'unknown') return WRITE_UNKNOWN_MESSAGE
  return RUSSIAN[category]
}

export function isAbortError(error: unknown): boolean {
  return (
    (error instanceof DOMException && error.name === 'AbortError') ||
    (error instanceof AppFailure && error.category === 'aborted') ||
    (typeof error === 'object' &&
      error !== null &&
      'name' in error &&
      (error as { name?: string }).name === 'AbortError')
  )
}

export function makeFailure(
  category: ErrorCategory,
  operation: string,
  kind: OperationKind,
  durationMs = 0,
  userMessage?: string,
  outcome?: Outcome,
): AppFailure {
  const resolved: Outcome =
    outcome ??
    (kind === 'write' && (category === 'timeout' || category === 'network' || category === 'offline')
      ? 'unknown'
      : 'failed')
  const failure = new AppFailure({
    category,
    outcome: resolved,
    operation,
    durationMs,
    userMessage: userMessage ?? messageFor(category, resolved),
  })
  recordDiagnostic({
    operation,
    timestamp: failure.timestamp,
    durationMs,
    category,
  })
  return failure
}

function durationFor(operation: string, fallback = 0): number {
  return lastDiagnostic(operation)?.durationMs ?? fallback
}

function categoryFromStatus(status: number): ErrorCategory {
  if (status === 401 || status === 403) return 'auth_expired'
  if (status === 404) return 'not_found'
  if (status === 408) return 'timeout'
  if (status === 429) return 'rate_limit'
  if (status >= 500) return 'server'
  return 'unknown'
}

function parseTaggedMessage(message: string): { category: ErrorCategory; operation: string } | null {
  const match = /(?:^|AppFailure:\s*)(timeout|network|offline|aborted|rate_limit|server|credentials|auth_expired|not_found|incomplete|unknown|file):([a-zA-Z0-9._-]+)/.exec(
    message,
  )
  if (!match) return null
  return { category: match[1] as ErrorCategory, operation: match[2] }
}

export function toFailure(error: unknown, operation: string, kind: OperationKind = 'read'): AppFailure {
  if (error instanceof AppFailure) return error
  if (isAbortError(error)) return makeFailure('aborted', operation, kind)

  const record = asRecord(error)
  const message = typeof record?.message === 'string' ? record.message : ''
  const tagged = parseTaggedMessage(message)
  if (tagged) {
    return makeFailure(tagged.category, tagged.operation || operation, kind, durationFor(tagged.operation || operation))
  }

  const status = typeof record?.status === 'number' ? record.status : undefined
  const code = typeof record?.code === 'string' ? record.code : ''
  const name = typeof record?.name === 'string' ? record.name : ''

  if (code === 'PGRST116' || /0 rows/i.test(message)) {
    const details = typeof record?.details === 'string' ? record.details : ''
    if (/contain \d+|multiple/i.test(`${message} ${details}`)) {
      return makeFailure('unknown', operation, kind)
    }
    return makeFailure('not_found', operation, kind)
  }
  if (
    code === 'invalid_credentials' ||
    code === 'invalid_grant' ||
    /invalid login credentials/i.test(message)
  ) {
    return makeFailure('credentials', operation, kind, durationFor(operation))
  }
  if (
    code === 'refresh_token_not_found' ||
    code === 'session_not_found' ||
    code === 'bad_jwt' ||
    /invalid refresh token|session expired/i.test(message)
  ) {
    return makeFailure('auth_expired', operation, kind, durationFor(operation))
  }
  if (name === 'AuthRetryableFetchError' || /failed to fetch|networkerror|load failed/i.test(message)) {
    if (status === 429) return makeFailure('rate_limit', operation, kind, durationFor(operation))
    if (typeof status === 'number' && status >= 500) {
      return makeFailure('server', operation, kind, durationFor(operation))
    }
    const offline = typeof navigator !== 'undefined' && navigator.onLine === false
    return makeFailure(offline ? 'offline' : 'network', operation, kind, durationFor(operation))
  }
  if (name === 'IncompleteResultError' || message === 'incomplete') {
    return makeFailure('incomplete', operation, kind)
  }
  if (typeof status === 'number' && status >= 400) {
    if (operation === 'auth.signIn' && status === 400) {
      return makeFailure('credentials', operation, kind, durationFor(operation))
    }
    return makeFailure(categoryFromStatus(status), operation, kind, durationFor(operation))
  }
  if (kind === 'write') {
    return makeFailure('unknown', operation, kind, durationFor(operation), undefined, 'unknown')
  }
  return makeFailure('unknown', operation, kind, durationFor(operation))
}

/**
 * Postgres rejected the statement. Class 22 is bad data and class 23 is an
 * integrity failure. PostgREST reports those with a 4xx status, so the
 * transaction did not commit. Gateway and 5xx responses do not prove that.
 */
export function isDefiniteWriteRejection(status: number | undefined, code: string | null | undefined): boolean {
  if (typeof status !== 'number' || status < 400 || status >= 500 || status === 408) return false
  return /^(22|23)[0-9A-Z]{3}$/.test(code ?? '')
}

/** Keeps the category, but an ambiguous write must not be presented as a definite failure. */
export function settleWriteFailure(failure: AppFailure, status: number | undefined): AppFailure {
  if (failure.category === 'aborted' || failure.outcome === 'unknown') return failure
  const ambiguous =
    failure.category === 'timeout' ||
    failure.category === 'network' ||
    failure.category === 'offline' ||
    failure.category === 'server' ||
    typeof status !== 'number' ||
    status === 0 ||
    status >= 500
  if (!ambiguous) return failure
  return new AppFailure({
    category: failure.category,
    outcome: 'unknown',
    operation: failure.operation,
    durationMs: failure.durationMs,
  })
}

export function shouldAutoRetry(failure: AppFailure, attempt: number): boolean {
  if (attempt >= 2) return false
  if (failure.outcome === 'unknown') return false
  return failure.category === 'network' || failure.category === 'server' || failure.category === 'rate_limit'
}

function asRecord(error: unknown): Record<string, unknown> | null {
  if (typeof error !== 'object' || error === null) return null
  return error as Record<string, unknown>
}
