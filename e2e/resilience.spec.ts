import { expect, test, type Page, type Route } from '@playwright/test'
import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import * as XLSX from 'xlsx'

const SUPABASE = 'https://azs-test.supabase.co/**'
const cors = {
  'access-control-allow-origin': '*',
  'access-control-allow-headers': '*',
  'access-control-allow-methods': 'GET,POST,PATCH,PUT,DELETE,OPTIONS',
}

function session(role: 'user' | 'admin', expiresInSeconds: number) {
  return {
    access_token: 'test-access-token',
    refresh_token: 'test-refresh-token',
    expires_in: 3600,
    expires_at: Math.floor(Date.now() / 1000) + expiresInSeconds,
    token_type: 'bearer',
    user: {
      id: 'user-1',
      aud: 'authenticated',
      role: 'authenticated',
      email: 'reader@example.com',
      app_metadata: { role },
      user_metadata: { role: 'admin' },
      created_at: '2026-01-01T00:00:00.000Z',
    },
  }
}

async function fulfillJson(route: Route, status: number, body: unknown) {
  await route.fulfill({
    status,
    contentType: 'application/json',
    headers: cors,
    body: JSON.stringify(body),
  })
}

async function seedSession(page: Page, role: 'user' | 'admin', expiresInSeconds: number) {
  const value = JSON.stringify(session(role, expiresInSeconds))
  await page.addInitScript((raw) => {
    localStorage.setItem('sb-azs-test-auth-token', raw)
  }, value)
}

function station(no: string, address = 'Адрес') {
  return {
    id: no,
    station_no: no,
    npo: 'НПО',
    address,
    region: 'Центр',
    location_type: 'город',
    station_phone: '1',
    station_email: 'a@b.c',
    manager_name: 'Иван',
    manager_phone: '2',
    territory_manager_name: 'Петр',
    territory_manager_phone: '3',
    regional_manager_name: 'Анна',
    regional_manager_phone: '4',
    price_category: 'A',
    menu: 'menu',
    sales_day_1: 1,
    sales_day_2: 2,
    sales_day_3: 3,
    luk_cafe: false,
    is_active: true,
    created_at: '2026-01-01T00:00:00.000Z',
    updated_at: '2026-01-01T00:00:00.000Z',
  }
}

test('loads the directory and a station from mocked data', async ({ page }) => {
  await seedSession(page, 'user', 3600)
  await page.route(SUPABASE, async (route) => {
    if (route.request().method() === 'OPTIONS') {
      await route.fulfill({ status: 204, headers: cors })
      return
    }
    const url = route.request().url()
    if (url.includes('station_no=eq.')) {
      expect(url).toContain('manager_phone')
      await fulfillJson(route, 200, [station('01001', 'Тверская')])
      return
    }
    if (url.includes('/rest/v1/stations')) {
      expect(decodeURIComponent(url)).toContain('select=id,station_no')
      expect(decodeURIComponent(url)).not.toContain('manager_phone')
      await fulfillJson(route, 200, [station('01001'), station('01002', 'Вторая')])
      return
    }
    await fulfillJson(route, 404, {})
  })

  await page.setViewportSize({ width: 1280, height: 800 })
  await page.goto('/')
  await expect(page.getByText('Найдено станций: 2')).toBeVisible()
  await page.getByRole('searchbox').fill('01002')
  await expect(page.getByText('Найдено станций: 1')).toBeVisible()
  await expect(page.getByRole('searchbox')).toHaveValue('01002')
  await expect(page.getByRole('link', { name: /01001/ })).toHaveCount(0)

  await page.setViewportSize({ width: 390, height: 844 })
  await expect(page.getByRole('button', { name: 'Меню навигации' })).toBeVisible()
  await expect(page.getByRole('searchbox')).toHaveValue('01002')
  await page.getByRole('searchbox').fill('')

  await page.getByRole('link', { name: /01001/ }).click()
  await expect(page.getByRole('heading', { name: '01001' })).toBeVisible()
  await expect(page.getByText('Тверская')).toBeVisible()
})

test('shows a retry after a stalled read and does not auto-repeat the timed-out request', async ({ page }) => {
  await seedSession(page, 'user', 3600)
  let stalled = 0
  let allow = false
  await page.route(SUPABASE, async (route) => {
    if (route.request().method() === 'OPTIONS') {
      await route.fulfill({ status: 204, headers: cors })
      return
    }
    if (!route.request().url().includes('/rest/v1/stations')) {
      await fulfillJson(route, 404, {})
      return
    }
    if (!allow) {
      stalled += 1
      await new Promise((resolve) => setTimeout(resolve, 4000))
      try {
        await fulfillJson(route, 200, [station('99999')])
      } catch {
        // The deadline aborted this request.
      }
      return
    }
    await fulfillJson(route, 200, [station('01001')])
  })

  await page.goto('/')
  await expect(page.getByRole('alert')).toContainText('Превышено время ожидания')
  expect(stalled).toBe(1)
  allow = true
  await page.getByRole('button', { name: 'Повторить' }).click()
  await expect(page.getByText('Найдено станций: 1')).toBeVisible()
  expect(stalled).toBe(1)
})

test('retries a failed fetch manually and surfaces 429 and 503', async ({ page }) => {
  await seedSession(page, 'user', 3600)
  let mode: 'fail' | 'rate' | 'down' | 'ok' = 'fail'
  let reads = 0
  await page.route(SUPABASE, async (route) => {
    if (route.request().method() === 'OPTIONS') {
      await route.fulfill({ status: 204, headers: cors })
      return
    }
    if (!route.request().url().includes('/rest/v1/stations')) {
      await fulfillJson(route, 404, {})
      return
    }
    reads += 1
    if (mode === 'fail') {
      await route.abort('failed')
      return
    }
    if (mode === 'rate') {
      await fulfillJson(route, 429, { code: 'over_request_rate_limit', msg: 'slow down' })
      return
    }
    if (mode === 'down') {
      await fulfillJson(route, 503, { message: 'unavailable', code: '57014' })
      return
    }
    await fulfillJson(route, 200, [station('01001')])
  })

  await page.goto('/')
  await expect(page.getByRole('alert')).toContainText('Не удалось связаться с сервером')
  const failedReads = reads
  expect(failedReads).toBe(3)
  mode = 'ok'
  await page.getByRole('button', { name: 'Повторить' }).click()
  await expect(page.getByText('Найдено станций: 1')).toBeVisible()

  mode = 'rate'
  reads = 0
  await page.reload()
  await expect(page.getByRole('alert')).toContainText('Слишком много запросов')
  expect(reads).toBe(3)
  mode = 'ok'
  await page.getByRole('button', { name: 'Повторить' }).click()
  await expect(page.getByText('Найдено станций: 1')).toBeVisible()

  mode = 'down'
  reads = 0
  await page.reload()
  await expect(page.getByRole('alert')).toContainText('Сервер временно недоступен')
  expect(reads).toBe(3)
  mode = 'ok'
  await page.getByRole('button', { name: 'Повторить' }).click()
  await expect(page.getByText('Найдено станций: 1')).toBeVisible()
})

test('keeps a stored session after a timed-out refresh and retries it', async ({ page }) => {
  test.setTimeout(45_000)
  await seedSession(page, 'user', -120)
  let allowRefresh = false
  await page.route(SUPABASE, async (route) => {
    if (route.request().method() === 'OPTIONS') {
      await route.fulfill({ status: 204, headers: cors })
      return
    }
    const url = route.request().url()
    if (url.includes('grant_type=refresh_token')) {
      const until = Date.now() + 1500
      while (!allowRefresh && Date.now() < until) {
        await new Promise((resolve) => setTimeout(resolve, 25))
      }
      if (!allowRefresh) {
        try {
          await route.abort('timedout')
        } catch {
          // The request deadline already aborted it.
        }
        return
      }
      try {
        await fulfillJson(route, 200, session('user', 3600))
      } catch {
        // A request aborted at the deadline cannot be answered.
      }
      return
    }
    if (url.includes('/rest/v1/stations')) {
      await fulfillJson(route, 200, [station('01001')])
      return
    }
    await fulfillJson(route, 404, {})
  })

  await page.goto('/')
  await expect(page.getByRole('alert')).toContainText('Данные входа сохранены')
  await expect(page).not.toHaveURL(/\/login/)
  const stored = await page.evaluate(() => localStorage.getItem('sb-azs-test-auth-token'))
  expect(stored).toContain('test-refresh-token')
  await page.evaluate(() => {
    const button = [...document.querySelectorAll('button')].find((item) => item.textContent?.includes('Повторить'))
    button?.click()
  })
  allowRefresh = true
  await expect(page.getByText('Найдено станций: 1')).toBeVisible({ timeout: 20_000 })
})

test('retries after an auth refresh whose body never finishes', async ({ page }) => {
  test.setTimeout(45_000)
  await seedSession(page, 'user', -120)
  await page.addInitScript(() => {
    const original = window.fetch.bind(window)
    ;(window as unknown as { __stallRefreshBody?: boolean }).__stallRefreshBody = true
    window.fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
      const response = await original(input, init)
      const href = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url
      const stall = (window as unknown as { __stallRefreshBody?: boolean }).__stallRefreshBody
      if (stall && href.includes('grant_type=refresh_token')) {
        const stream = new ReadableStream({
          start(controller) {
            const fail = () => {
              try {
                controller.error(new DOMException('aborted', 'AbortError'))
              } catch {
                // The deadline already cancelled this body.
              }
            }
            if (init?.signal?.aborted) fail()
            else init?.signal?.addEventListener('abort', fail, { once: true })
          },
        })
        return new Response(stream, { status: response.status, headers: response.headers })
      }
      return response
    }
  })
  let refreshBodies = 0
  await page.route(SUPABASE, async (route) => {
    if (route.request().method() === 'OPTIONS') {
      await route.fulfill({ status: 204, headers: cors })
      return
    }
    const url = route.request().url()
    if (url.includes('grant_type=refresh_token')) {
      refreshBodies += 1
      await fulfillJson(route, 200, session('user', 3600))
      return
    }
    if (url.includes('/rest/v1/stations')) {
      await fulfillJson(route, 200, [station('01001')])
      return
    }
    await fulfillJson(route, 404, {})
  })

  await page.goto('/')
  await expect(page.getByRole('alert')).toContainText('Данные входа сохранены')
  expect(refreshBodies).toBeGreaterThanOrEqual(1)
  const stored = await page.evaluate(() => localStorage.getItem('sb-azs-test-auth-token'))
  expect(stored).toContain('test-refresh-token')
  await page.evaluate(() => {
    const button = [...document.querySelectorAll('button')].find((item) => item.textContent?.includes('Повторить'))
    button?.click()
    ;(window as unknown as { __stallRefreshBody?: boolean }).__stallRefreshBody = false
  })
  await expect(page.getByText('Найдено станций: 1')).toBeVisible({ timeout: 20_000 })
})

test('distinguishes invalid credentials from rate limiting and service errors', async ({ page }) => {
  let outcome = 'credentials'
  await page.route(SUPABASE, async (route) => {
    if (route.request().method() === 'OPTIONS') {
      await route.fulfill({ status: 204, headers: cors })
      return
    }
    const url = route.request().url()
    if (!url.includes('grant_type=password')) {
      await fulfillJson(route, 404, {})
      return
    }
    if (outcome === 'rate') {
      await fulfillJson(route, 429, { code: 'over_request_rate_limit', msg: 'slow down' })
      return
    }
    if (outcome === 'down') {
      await fulfillJson(route, 503, { code: 'unexpected_failure', msg: 'down' })
      return
    }
    await fulfillJson(route, 400, { code: 'invalid_credentials', msg: 'Invalid login credentials' })
  })

  await page.goto('/login')
  await page.getByLabel('Email').fill('reader@example.com')
  await page.getByLabel('Password').fill('wrong-password')
  await page.getByRole('button', { name: 'Sign In' }).click()
  await expect(page.getByRole('alert')).toContainText('Неверный email или пароль')
  await expect(page.getByRole('button', { name: 'Sign In' })).toBeEnabled()

  outcome = 'rate'
  await page.getByRole('button', { name: 'Sign In' }).click()
  await expect(page.getByRole('alert')).toContainText('Слишком много запросов')
  await expect(page.getByRole('button', { name: 'Sign In' })).toBeEnabled()

  outcome = 'down'
  await page.getByRole('button', { name: 'Sign In' }).click()
  await expect(page.getByRole('alert')).toContainText('Сервер временно недоступен')
  await expect(page.getByRole('button', { name: 'Sign In' })).toBeEnabled()
})

test('does not apply an obsolete station response after navigation', async ({ page }) => {
  await seedSession(page, 'user', 3600)
  await page.route(SUPABASE, async (route) => {
    if (route.request().method() === 'OPTIONS') {
      await route.fulfill({ status: 204, headers: cors })
      return
    }
    const url = route.request().url()
    if (url.includes('station_no=eq.01001')) {
      await new Promise((resolve) => setTimeout(resolve, 2500))
      try {
        await fulfillJson(route, 200, [station('01001', 'SLOW-ADDRESS')])
      } catch {
        // aborted when the profile unmounted
      }
      return
    }
    if (url.includes('station_no=eq.01002')) {
      await fulfillJson(route, 200, [station('01002', 'FAST-ADDRESS')])
      return
    }
    if (url.includes('/rest/v1/stations')) {
      await fulfillJson(route, 200, [])
      return
    }
    await fulfillJson(route, 404, {})
  })

  await page.goto('/station/01001')
  await page.goto('/station/01002')
  await expect(page.getByRole('heading', { name: '01002' })).toBeVisible()
  await expect(page.getByText('FAST-ADDRESS')).toBeVisible()
  await page.waitForTimeout(3000)
  await expect(page.getByRole('heading', { name: '01002' })).toBeVisible()
  await expect(page.getByText('SLOW-ADDRESS')).toHaveCount(0)
})

test('loads more than 3000 stations and does not show a partial directory', async ({ page }) => {
  await seedSession(page, 'user', 3600)
  let failThird = true
  await page.route(SUPABASE, async (route) => {
    if (route.request().method() === 'OPTIONS') {
      await route.fulfill({ status: 204, headers: cors })
      return
    }
    const url = new URL(route.request().url())
    if (!url.pathname.includes('/rest/v1/stations')) {
      await fulfillJson(route, 404, {})
      return
    }
    const offset = Number(url.searchParams.get('offset') ?? '0')
    if (failThird && offset === 2000) {
      await fulfillJson(route, 500, { message: 'db down', code: '57014' })
      return
    }
    const total = 3500
    const count = Math.max(0, Math.min(1000, total - offset))
    await fulfillJson(
      route,
      200,
      Array.from({ length: count }, (_, index) => station(String(offset + index).padStart(5, '0'))),
    )
  })

  await page.goto('/')
  await expect(page.getByRole('alert')).toBeVisible()
  await expect(page.getByText('Найдено станций:')).toHaveCount(0)

  failThird = false
  await page.getByRole('button', { name: 'Повторить' }).click()
  await expect(page.getByText('Найдено станций: 3500')).toBeVisible()
})

test('does not duplicate a timed-out user creation or import write', async ({ page }) => {
  await seedSession(page, 'admin', 3600)
  let creates = 0
  let patches = 0
  await page.route('**/api/admin/create-user', async (route) => {
    if (route.request().method() !== 'POST') {
      await route.fallback()
      return
    }
    creates += 1
    await new Promise((resolve) => setTimeout(resolve, 4000))
    try {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ user: { id: 'new', email: 'a@b.co', role: 'user' } }),
      })
    } catch {
      // aborted
    }
  })
  await page.route(SUPABASE, async (route) => {
    if (route.request().method() === 'OPTIONS') {
      await route.fulfill({ status: 204, headers: cors })
      return
    }
    const request = route.request()
    if (request.method() === 'PATCH') {
      patches += 1
      await new Promise((resolve) => setTimeout(resolve, 4000))
      try {
        await fulfillJson(route, 200, [])
      } catch {
        // aborted
      }
      return
    }
    if (request.url().includes('/rest/v1/stations') && request.method() === 'GET') {
      await fulfillJson(route, 200, [])
      return
    }
    await fulfillJson(route, 404, {})
  })

  await page.goto('/admin/users')
  await page.getByLabel('Email').fill('new@example.com')
  await page.getByLabel('Пароль').fill('secret-pass')
  await page.getByRole('button', { name: 'Создать пользователя' }).click()
  await expect(page.getByRole('alert')).toContainText('Результат неизвестен')
  expect(creates).toBe(1)
  await page.waitForTimeout(1500)
  expect(creates).toBe(1)

  const dir = mkdtempSync(path.join(tmpdir(), 'azs-import-'))
  const file = path.join(dir, 'stations.xlsx')
  const book = XLSX.utils.book_new()
  const sheet = XLSX.utils.aoa_to_sheet([
    ['station_no', 'npo'],
    ['01001', 'НПО'],
  ])
  XLSX.utils.book_append_sheet(book, sheet, 'Stations')
  writeFileSync(file, XLSX.write(book, { type: 'buffer', bookType: 'xlsx' }))

  await page.getByRole('link', { name: 'Импорт' }).click()
  await page.locator('input[type="file"]').setInputFiles(file)
  await expect(page.getByRole('button', { name: 'Импортировать данные' })).toBeVisible()
  page.once('dialog', (dialog) => dialog.accept())
  await page.getByRole('button', { name: 'Импортировать данные' }).click()
  await expect(page.getByText('Результат части запросов неизвестен')).toBeVisible()
  expect(patches).toBe(1)
  await page.waitForTimeout(1500)
  expect(patches).toBe(1)
})

test('does not treat an unreadable create-user success as a retryable failure', async ({ page }) => {
  await seedSession(page, 'admin', 3600)
  let creates = 0
  await page.route('**/api/admin/create-user', async (route) => {
    if (route.request().method() !== 'POST') {
      await route.fallback()
      return
    }
    creates += 1
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: '{"user":',
    })
  })
  await page.route(SUPABASE, async (route) => {
    if (route.request().method() === 'OPTIONS') {
      await route.fulfill({ status: 204, headers: cors })
      return
    }
    await fulfillJson(route, 404, {})
  })

  await page.goto('/admin/users')
  await page.getByLabel('Email').fill('new@example.com')
  await page.getByLabel('Пароль').fill('secret-pass')
  await page.getByRole('button', { name: 'Создать пользователя' }).click()
  await expect(page.getByRole('alert')).toContainText('Результат неизвестен')
  await expect(page.getByRole('alert')).not.toContainText('Повторите попытку')
  await expect(page.getByText('успешно создан')).toHaveCount(0)
  expect(creates).toBe(1)
  await page.waitForTimeout(500)
  expect(creates).toBe(1)
})

test('stops an import when the batch response is an ambiguous service error', async ({ page }) => {
  await seedSession(page, 'admin', 3600)
  let posts = 0
  await page.route(SUPABASE, async (route) => {
    if (route.request().method() === 'OPTIONS') {
      await route.fulfill({ status: 204, headers: cors })
      return
    }
    const request = route.request()
    if (request.method() === 'POST' && request.url().includes('/rest/v1/stations')) {
      posts += 1
      await fulfillJson(route, 503, { message: 'bad gateway' })
      return
    }
    if (request.method() === 'PATCH') {
      await fulfillJson(route, 200, [])
      return
    }
    await fulfillJson(route, 200, [])
  })

  const dir = mkdtempSync(path.join(tmpdir(), 'azs-import-'))
  const file = path.join(dir, 'stations.xlsx')
  const book = XLSX.utils.book_new()
  const sheet = XLSX.utils.aoa_to_sheet([
    ['station_no', 'npo'],
    ['01001', 'НПО'],
  ])
  XLSX.utils.book_append_sheet(book, sheet, 'Stations')
  writeFileSync(file, XLSX.write(book, { type: 'buffer', bookType: 'xlsx' }))

  await page.goto('/import')
  await page.locator('input[type="file"]').setInputFiles(file)
  await expect(page.getByRole('button', { name: 'Импортировать данные' })).toBeVisible()
  page.once('dialog', (dialog) => dialog.accept())
  await page.getByRole('button', { name: 'Импортировать данные' }).click()
  await expect(page.getByText('Результат части запросов неизвестен')).toBeVisible()
  await expect(page.getByText('Результат неизвестен')).toBeVisible()
  expect(posts).toBe(1)
  await page.waitForTimeout(500)
  expect(posts).toBe(1)
})

test('reports a file read error without sending an import', async ({ page }) => {
  await seedSession(page, 'admin', 3600)
  let patches = 0
  await page.addInitScript(() => {
    class BrokenReader {
      result: string | null = null
      error = new DOMException('unreadable', 'NotReadableError')
      onload: ((event: Event) => void) | null = null
      onerror: ((event: Event) => void) | null = null
      onabort: ((event: Event) => void) | null = null
      readAsBinaryString() {
        queueMicrotask(() => this.onerror?.(new Event('error')))
      }
      abort() {
        this.onabort?.(new Event('abort'))
      }
    }
    window.FileReader = BrokenReader as unknown as typeof FileReader
  })
  await page.route(SUPABASE, async (route) => {
    if (route.request().method() === 'PATCH') patches += 1
    if (route.request().method() === 'OPTIONS') {
      await route.fulfill({ status: 204, headers: cors })
      return
    }
    await fulfillJson(route, 200, [])
  })
  await page.goto('/import')
  await page.locator('input[type="file"]').setInputFiles({
    name: 'stations.xlsx',
    mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    buffer: Buffer.from('not-a-workbook'),
  })
  await expect(page.getByRole('alert')).toContainText('Не удалось прочитать файл')
  expect(patches).toBe(0)
})

test('shows a recoverable error when an admin chunk fails to load', async ({ page }) => {
  await seedSession(page, 'admin', 3600)
  let failImport = true
  await page.route(/\/assets\/(?!index-).+\.js/, async (route) => {
    if (failImport) {
      failImport = false
      await route.abort('failed')
      return
    }
    await route.continue()
  })
  await page.route(SUPABASE, async (route) => {
    if (route.request().method() === 'OPTIONS') {
      await route.fulfill({ status: 204, headers: cors })
      return
    }
    if (route.request().url().includes('/rest/v1/stations')) {
      await fulfillJson(route, 200, [])
      return
    }
    await fulfillJson(route, 404, {})
  })
  await page.goto('/')
  await page.getByRole('link', { name: 'Импорт' }).click()
  await expect(page.getByRole('alert')).toContainText('Не удалось загрузить раздел')
  await page.getByRole('button', { name: 'Повторить' }).click()
  await expect(page.getByRole('heading', { name: 'Import Stations' })).toBeVisible()
})

test('does not navigate away when sign-out fails', async ({ page }) => {
  await seedSession(page, 'user', 3600)
  let logouts = 0
  await page.route(SUPABASE, async (route) => {
    if (route.request().method() === 'OPTIONS') {
      await route.fulfill({ status: 204, headers: cors })
      return
    }
    const request = route.request()
    if (request.method() === 'POST' && request.url().includes('/logout')) {
      logouts += 1
      await fulfillJson(route, 500, { message: 'nope', code: 'unexpected_failure' })
      return
    }
    if (request.url().includes('/rest/v1/stations')) {
      await fulfillJson(route, 200, [station('01001')])
      return
    }
    await fulfillJson(route, 404, {})
  })
  await page.goto('/')
  await expect(page.getByText('Найдено станций: 1')).toBeVisible()
  await page.getByRole('button', { name: 'Выйти' }).click()
  await expect(page.getByRole('alert')).toContainText('Не удалось выйти')
  await expect(page).not.toHaveURL(/\/login/)
  expect(logouts).toBe(1)
  await page.waitForTimeout(500)
  expect(logouts).toBe(1)
})

test('rejects an invalid refresh without keeping a recoverable session', async ({ page }) => {
  await seedSession(page, 'user', -120)
  await page.route(SUPABASE, async (route) => {
    if (route.request().method() === 'OPTIONS') {
      await route.fulfill({ status: 204, headers: cors })
      return
    }
    if (route.request().url().includes('grant_type=refresh_token')) {
      await fulfillJson(route, 400, { error_code: 'refresh_token_not_found', msg: 'Invalid Refresh Token' })
      return
    }
    await fulfillJson(route, 404, {})
  })
  await page.goto('/')
  await expect(page).toHaveURL(/\/login/)
  await expect(page.getByText('Данные входа сохранены')).toHaveCount(0)
  await expect(page.getByLabel('Email')).toBeVisible()
  const stored = await page.evaluate(() => localStorage.getItem('sb-azs-test-auth-token'))
  expect(stored).toBeNull()
})

test('distinguishes a missing station from a failed station request', async ({ page }) => {
  await seedSession(page, 'user', 3600)
  let missing = true
  await page.route(SUPABASE, async (route) => {
    if (route.request().method() === 'OPTIONS') {
      await route.fulfill({ status: 204, headers: cors })
      return
    }
    const url = route.request().url()
    if (url.includes('station_no=eq.40404')) {
      await fulfillJson(route, 200, [])
      return
    }
    if (url.includes('station_no=eq.50000')) {
      if (missing) {
        await fulfillJson(route, 500, { message: 'db down', code: '57014' })
        return
      }
      await fulfillJson(route, 200, [station('50000', 'Вернулась')])
      return
    }
    if (url.includes('/rest/v1/stations')) {
      await fulfillJson(route, 200, [])
      return
    }
    await fulfillJson(route, 404, {})
  })

  await page.goto('/station/40404')
  await expect(page.getByRole('heading', { name: 'Станция не найдена' })).toBeVisible()
  await expect(page.getByRole('button', { name: 'Повторить' })).toHaveCount(0)

  await page.goto('/station/50000')
  await expect(page.getByRole('alert')).toContainText('Сервер временно недоступен')
  missing = false
  await page.getByRole('button', { name: 'Повторить' }).click()
  await expect(page.getByRole('heading', { name: '50000' })).toBeVisible()
  await expect(page.getByText('Вернулась')).toBeVisible()
})
