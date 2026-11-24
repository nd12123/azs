import { expect, test } from '@playwright/test'
import { collectPages, IncompleteResultError } from '../src/lib/pages'
import { isDefiniteWriteRejection, makeFailure, settleWriteFailure, shouldAutoRetry, toFailure, WRITE_UNKNOWN_MESSAGE } from '../src/lib/failures'
import { decideCreateUser, isTrustedAdmin } from '../src/lib/createUserPolicy'
import { fetchWithDeadline, readJsonResponse, REQUEST_TIMEOUT_MS } from '../src/lib/net'

test('production deadline defaults to 15 seconds outside Vite', () => {
  expect(REQUEST_TIMEOUT_MS).toBe(15_000)
})

test('fetch deadline aborts the underlying request', async () => {
  let aborted = false
  const fetchImpl: typeof fetch = (_input, init) =>
    new Promise((_resolve, reject) => {
      init?.signal?.addEventListener('abort', () => {
        aborted = true
        reject(new DOMException('The operation was aborted', 'AbortError'))
      })
    })

  await expect(
    fetchWithDeadline('https://azs-test.supabase.co/rest/v1/stations', {}, {
      timeoutMs: 40,
      fetchImpl,
      operation: 'stations.list',
      kind: 'read',
    }),
  ).rejects.toMatchObject({ category: 'timeout', outcome: 'failed' })
  expect(aborted).toBe(true)
})

test('deadline stays active until the body finishes and then clears its timer', async () => {
  let cancelled = false
  const fetchImpl: typeof fetch = (_input, init) => {
    const stream = new ReadableStream({
      start(controller) {
        init?.signal?.addEventListener('abort', () => {
          cancelled = true
          try {
            controller.error(new DOMException('aborted', 'AbortError'))
          } catch {
            // The body may already have been cancelled.
          }
        })
      },
      cancel() {
        cancelled = true
      },
    })
    return Promise.resolve(new Response(stream, {
      status: 200,
      headers: { 'content-type': 'application/json' },
    }))
  }

  const started = performance.now()
  const response = await fetchWithDeadline('https://azs-test.supabase.co/auth/v1/token?grant_type=refresh_token', {}, {
    timeoutMs: 80,
    fetchImpl,
    operation: 'auth.refresh',
    kind: 'read',
  })
  expect(performance.now() - started).toBeLessThan(40)

  const timeoutsBefore = activeTimeouts()
  await expect(response.json()).rejects.toMatchObject({ category: 'timeout', outcome: 'failed' })
  expect(cancelled).toBe(true)
  expect(performance.now() - started).toBeGreaterThanOrEqual(70)
  await new Promise((resolve) => setTimeout(resolve, 30))
  expect(activeTimeouts()).toBeLessThanOrEqual(timeoutsBefore)

  const writeResponse = await fetchWithDeadline('https://azs-test.supabase.co/rest/v1/stations', {}, {
    timeoutMs: 40,
    fetchImpl,
    operation: 'import.upsert',
    kind: 'write',
  })
  const writeFailure = await writeResponse.json().then(() => null, (error: unknown) => error)
  expect(writeFailure).toMatchObject({ category: 'timeout', outcome: 'unknown' })
  expect(shouldAutoRetry(writeFailure as ReturnType<typeof makeFailure>, 0)).toBe(false)

  const quick = await fetchWithDeadline('https://azs-test.supabase.co/rest/v1/stations', {}, {
    timeoutMs: 500,
    fetchImpl: async () => new Response('[]', { status: 200, headers: { 'content-type': 'application/json' } }),
    operation: 'stations.list',
    kind: 'read',
  })
  const pendingTimer = activeTimeouts()
  await quick.json()
  expect(activeTimeouts()).toBeLessThan(pendingTimer)
})

test('a body that stops after partial JSON stays an unknown write', async () => {
  const fetchImpl: typeof fetch = async () => {
    const stream = new ReadableStream({
      start(controller) {
        controller.enqueue(new TextEncoder().encode('{"user":'))
        controller.error(new TypeError('connection reset'))
      },
    })
    return new Response(stream, {
      status: 200,
      headers: { 'content-type': 'application/json' },
    })
  }

  const response = await fetchWithDeadline('/api/admin/create-user', { method: 'POST' }, {
    timeoutMs: 1000,
    fetchImpl,
    operation: 'admin.createUser',
    kind: 'write',
  })
  const interrupted = await response.json().then(() => null, (error: unknown) => error)
  expect(interrupted).toMatchObject({ category: 'network', outcome: 'unknown' })
  expect(interrupted).toMatchObject({ userMessage: WRITE_UNKNOWN_MESSAGE })
  expect(shouldAutoRetry(interrupted as ReturnType<typeof makeFailure>, 0)).toBe(false)

  const truncated = new Response('{"user":', {
    status: 200,
    headers: { 'content-type': 'application/json' },
  })
  await expect(readJsonResponse(truncated, 'admin.createUser', 'write')).rejects.toMatchObject({
    category: 'unknown',
    outcome: 'unknown',
    userMessage: WRITE_UNKNOWN_MESSAGE,
  })
})

test('timeout tags survive the auth and postgrest wrappers', () => {
  const refresh = toFailure(
    { name: 'AuthRetryableFetchError', message: 'timeout:auth.refresh', status: 0 },
    'auth.getSession',
    'read',
  )
  expect(refresh.category).toBe('timeout')
  expect(refresh.outcome).toBe('failed')
  expect(refresh.userMessage).toMatch(/повторите/i)

  const upsert = toFailure(
    { message: 'AppFailure: timeout:stations.query', status: 0 },
    'import.upsert',
    'write',
  )
  expect(upsert.category).toBe('timeout')
  expect(upsert.outcome).toBe('unknown')
  expect(shouldAutoRetry(upsert, 0)).toBe(false)

  const truncated = toFailure(
    { message: 'Unexpected end of JSON input', status: 0 },
    'admin.createUser',
    'write',
  )
  expect(truncated.category).toBe('unknown')
  expect(truncated.outcome).toBe('unknown')
  expect(truncated.userMessage).toBe(WRITE_UNKNOWN_MESSAGE)
})

test('only a rejected database statement may be retried row by row', () => {
  expect(isDefiniteWriteRejection(409, '23505')).toBe(true)
  expect(isDefiniteWriteRejection(400, '22P02')).toBe(true)
  expect(isDefiniteWriteRejection(503, '23505')).toBe(false)
  expect(isDefiniteWriteRejection(502, undefined)).toBe(false)
  expect(isDefiniteWriteRejection(500, '57014')).toBe(false)

  const gateway = settleWriteFailure(makeFailure('server', 'import.upsert', 'write'), 503)
  expect(gateway.category).toBe('server')
  expect(gateway.outcome).toBe('unknown')
  expect(shouldAutoRetry(gateway, 0)).toBe(false)
})

function activeTimeouts(): number {
  return process.getActiveResourcesInfo().filter((name) => name === 'Timeout').length
}

test('a timed-out write is unknown and is not auto-retried', () => {
  const failure = makeFailure('timeout', 'admin.createUser', 'write', 1000)
  expect(failure.outcome).toBe('unknown')
  expect(shouldAutoRetry(failure, 0)).toBe(false)
  expect(shouldAutoRetry(makeFailure('server', 'stations.list', 'read'), 0)).toBe(true)
  expect(shouldAutoRetry(makeFailure('server', 'stations.list', 'read'), 2)).toBe(false)
  expect(shouldAutoRetry(makeFailure('timeout', 'stations.list', 'read'), 0)).toBe(false)
})

test('pagination keeps going past 3000 rows and refuses a truncated directory', async () => {
  const pageSize = 1000
  const rows = await collectPages(async (from) => {
    const remaining = 3500 - from
    const count = Math.max(0, Math.min(pageSize, remaining))
    return Array.from({ length: count }, (_, index) => from + index)
  }, new AbortController().signal, pageSize, 50)
  expect(rows).toHaveLength(3500)
  expect(rows[3000]).toBe(3000)

  await expect(
    collectPages(async () => Array.from({ length: pageSize }, () => 1), new AbortController().signal, pageSize, 2),
  ).rejects.toBeInstanceOf(IncompleteResultError)

  let calls = 0
  await expect(
    collectPages(async () => {
      calls += 1
      if (calls === 3) throw new Error('boom')
      return Array.from({ length: pageSize }, () => 1)
    }, new AbortController().signal, pageSize, 10),
  ).rejects.toThrow('boom')
  expect(calls).toBe(3)
})

test('create-user policy trusts only app_metadata and does not echo secrets', () => {
  expect(isTrustedAdmin({ app_metadata: { role: 'admin' }, user_metadata: { role: 'user' } })).toBe(true)
  expect(isTrustedAdmin({ app_metadata: { role: 'user' }, user_metadata: { role: 'admin' } })).toBe(false)
  expect(isTrustedAdmin({ user_metadata: { role: 'admin' } })).toBe(false)

  const bad = decideCreateUser({ email: 'not-an-email', password: 'secret-value', role: 'admin' })
  expect(bad.ok).toBe(false)
  if (!bad.ok) expect(bad.error).not.toContain('secret-value')

  const good = decideCreateUser({ email: 'a@b.co', password: 'secret-value', role: 'owner' })
  expect(good).toEqual({ ok: false, error: 'Invalid role' })
})
