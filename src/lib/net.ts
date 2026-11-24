import { recordDiagnostic } from './diagnostics'
import { AppFailure, makeFailure, shouldAutoRetry, toFailure, type OperationKind } from './failures'

const DEFAULT_TIMEOUT_MS = 15_000

function readConfiguredTimeout(): number {
  try {
    const env = (import.meta as ImportMeta & { env?: Record<string, string | undefined> }).env
    const parsed = Number(env?.VITE_REQUEST_TIMEOUT_MS)
    if (Number.isFinite(parsed) && parsed >= 200 && parsed <= 60_000) return parsed
  } catch {
    // import.meta.env is absent outside Vite.
  }
  return DEFAULT_TIMEOUT_MS
}

/** Per-request deadline. Production default is 15 seconds. */
export const REQUEST_TIMEOUT_MS = readConfiguredTimeout()

export function operationFromUrl(input: RequestInfo | URL): string {
  const href =
    typeof input === 'string' ? input : input instanceof URL ? input.href : input.url
  let path = ''
  let search = ''
  try {
    const url = new URL(href, 'http://localhost')
    path = url.pathname
    search = url.search
  } catch {
    path = href
  }
  if (path.includes('/token')) {
    if (search.includes('grant_type=refresh_token')) return 'auth.refresh'
    if (search.includes('grant_type=password')) return 'auth.signIn'
    return 'auth.token'
  }
  if (path.endsWith('/logout')) return 'auth.signOut'
  if (path.includes('/rest/v1/stations')) return 'stations.query'
  if (path.includes('/auth/v1/')) return 'auth.request'
  if (path.includes('/api/admin/create-user')) return 'admin.createUser'
  return 'http.request'
}

export function mergeSignals(signals: AbortSignal[]): AbortSignal {
  return linkSignals(signals).signal
}

function linkSignals(signals: AbortSignal[]): { signal: AbortSignal; dispose: () => void } {
  const controller = new AbortController()
  const removals: Array<() => void> = []
  const abort = () => {
    if (controller.signal.aborted) return
    const reason = signals.find((signal) => signal.aborted)?.reason
    controller.abort(reason)
  }
  for (const signal of signals) {
    if (signal.aborted) {
      abort()
      break
    }
    signal.addEventListener('abort', abort, { once: true })
    removals.push(() => signal.removeEventListener('abort', abort))
  }
  return {
    signal: controller.signal,
    dispose() {
      for (const remove of removals) remove()
    },
  }
}

export function delay(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal.aborted) {
      reject(new DOMException('aborted', 'AbortError'))
      return
    }
    const timer = setTimeout(() => {
      signal.removeEventListener('abort', onAbort)
      resolve()
    }, ms)
    const onAbort = () => {
      clearTimeout(timer)
      reject(new DOMException('aborted', 'AbortError'))
    }
    signal.addEventListener('abort', onAbort, { once: true })
  })
}

const BODY_METHODS = ['arrayBuffer', 'blob', 'formData', 'json', 'text'] as const

/**
 * Fetch wrapper that aborts the underlying HTTP request when the deadline
 * passes. The deadline stays armed until the response body is consumed, so a
 * stall after the headers still cancels the download.
 */
export async function fetchWithDeadline(
  input: RequestInfo | URL,
  init: RequestInit = {},
  options?: { operation?: string; timeoutMs?: number; kind?: OperationKind; fetchImpl?: typeof fetch },
): Promise<Response> {
  const operation = options?.operation ?? operationFromUrl(input)
  const timeoutMs = options?.timeoutMs ?? REQUEST_TIMEOUT_MS
  const kind = options?.kind ?? 'read'
  const fetchImpl = options?.fetchImpl ?? fetch
  const started = performance.now()
  const timeoutController = new AbortController()
  const timer = setTimeout(() => timeoutController.abort(), timeoutMs)
  const signals = [timeoutController.signal]
  if (init.signal) signals.push(init.signal)
  const linked = linkSignals(signals)

  let cleaned = false
  const cleanup = () => {
    if (cleaned) return
    cleaned = true
    clearTimeout(timer)
    linked.dispose()
  }

  try {
    const response = await fetchImpl(input, { ...init, signal: linked.signal })
    return guardResponseBody(response, {
      cleanup,
      signal: linked.signal,
      timeoutSignal: timeoutController.signal,
      callerSignal: init.signal,
      operation,
      kind,
      started,
    })
  } catch (error) {
    cleanup()
    if (error instanceof AppFailure) throw error
    const durationMs = Math.round(performance.now() - started)
    throw classifyTransportFailure(error, {
      operation,
      kind,
      durationMs,
      callerSignal: init.signal,
      timeoutSignal: timeoutController.signal,
    })
  }
}

function classifyTransportFailure(
  error: unknown,
  ctx: {
    operation: string
    kind: OperationKind
    durationMs: number
    callerSignal?: AbortSignal | null
    timeoutSignal: AbortSignal
  },
): AppFailure {
  if (error instanceof AppFailure) return error
  if (ctx.timeoutSignal.aborted) return makeFailure('timeout', ctx.operation, ctx.kind, ctx.durationMs)
  if (ctx.callerSignal?.aborted || isAbortLike(error)) {
    return makeFailure('aborted', ctx.operation, ctx.kind, ctx.durationMs)
  }
  const offline = typeof navigator !== 'undefined' && navigator.onLine === false
  return makeFailure(offline ? 'offline' : 'network', ctx.operation, ctx.kind, ctx.durationMs)
}

function isAbortLike(error: unknown): boolean {
  return (
    (error instanceof DOMException && error.name === 'AbortError') ||
    (typeof error === 'object' && error !== null && 'name' in error && (error as { name?: string }).name === 'AbortError')
  )
}

function guardResponseBody(
  response: Response,
  ctx: {
    cleanup: () => void
    signal: AbortSignal
    timeoutSignal: AbortSignal
    callerSignal?: AbortSignal | null
    operation: string
    kind: OperationKind
    started: number
  },
): Response {
  let finished = false
  const stopDownload = () => {
    void response.body?.cancel().catch(() => undefined)
    ctx.cleanup()
  }
  ctx.signal.addEventListener('abort', stopDownload, { once: true })

  const finish = (failed: boolean) => {
    if (finished) return
    finished = true
    ctx.signal.removeEventListener('abort', stopDownload)
    ctx.cleanup()
    if (!failed) {
      const durationMs = Math.round(performance.now() - ctx.started)
      recordDiagnostic({
        operation: ctx.operation,
        timestamp: new Date().toISOString(),
        durationMs,
        category: response.ok ? 'ok' : statusCategory(response.status),
      })
    }
  }

  const read = async (original: () => Promise<unknown>) => {
    try {
      const value = await original()
      finish(false)
      return value
    } catch (error) {
      finish(true)
      const durationMs = Math.round(performance.now() - ctx.started)
      if (ctx.timeoutSignal.aborted) throw makeFailure('timeout', ctx.operation, ctx.kind, durationMs)
      if (ctx.callerSignal?.aborted || isAbortLike(error)) {
        throw makeFailure('aborted', ctx.operation, ctx.kind, durationMs)
      }
      if (error instanceof SyntaxError) throw error
      const offline = typeof navigator !== 'undefined' && navigator.onLine === false
      throw makeFailure(offline ? 'offline' : 'network', ctx.operation, ctx.kind, durationMs)
    }
  }

  // Own properties keep status/ok on the real Response. A Proxy would make
  // those getters see the wrapper and fail their brand check.
  for (const method of BODY_METHODS) {
    const original = response[method].bind(response)
    Object.defineProperty(response, method, {
      configurable: true,
      value: () => read(original),
    })
  }
  return response
}

function statusCategory(status: number): 'rate_limit' | 'server' | 'auth_expired' | 'unknown' | 'not_found' | 'timeout' {
  if (status === 401 || status === 403) return 'auth_expired'
  if (status === 404) return 'not_found'
  if (status === 408) return 'timeout'
  if (status === 429) return 'rate_limit'
  if (status >= 500) return 'server'
  return 'unknown'
}

/** Installed as the Supabase client's fetch so SDK calls are actually aborted. */
export function deadlineFetch(base: typeof fetch = fetch): typeof fetch {
  return (input, init) => fetchWithDeadline(input, init, { fetchImpl: base })
}

export async function withReadRetries<T>(
  operation: string,
  parent: AbortSignal,
  run: (signal: AbortSignal) => Promise<T>,
): Promise<T> {
  let last: AppFailure | null = null
  for (let attempt = 0; attempt <= 2; attempt += 1) {
    if (parent.aborted) throw makeFailure('aborted', operation, 'read')
    const controller = new AbortController()
    const onParentAbort = () => controller.abort()
    parent.addEventListener('abort', onParentAbort, { once: true })
    try {
      return await run(controller.signal)
    } catch (error) {
      const failure = toFailure(error, operation, 'read')
      if (failure.category === 'aborted') throw failure
      last = failure
      if (!shouldAutoRetry(failure, attempt)) throw failure
      await delay(attempt === 0 ? 400 : 1200, parent)
    } finally {
      parent.removeEventListener('abort', onParentAbort)
    }
  }
  throw last ?? makeFailure('unknown', operation, 'read')
}

export async function readJsonResponse(response: Response, operation: string, kind: OperationKind): Promise<unknown> {
  const type = response.headers.get('content-type') ?? ''
  const writeOutcome = kind === 'write' ? 'unknown' as const : undefined
  if (!type.toLowerCase().includes('application/json')) {
    throw makeFailure(response.ok ? 'unknown' : statusCategory(response.status), operation, kind, 0, undefined, writeOutcome)
  }
  try {
    return await response.json()
  } catch (error) {
    if (error instanceof AppFailure) throw error
    if (error instanceof SyntaxError) {
      throw makeFailure('unknown', operation, kind, 0, undefined, writeOutcome ?? 'failed')
    }
    throw toFailure(error, operation, kind)
  }
}
