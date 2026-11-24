import { expect, test } from '@playwright/test'
import http from 'node:http'
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import type { CreateUserDeps } from '../api/admin/create-user'
import { mergePublicConfig, readPublicSupabaseConfig } from '../src/lib/publicConfig'
import { MAX_BODY_BYTES, startServer, type RunningServer } from '../server/app'

const SERVICE_ROLE = 'synthetic-service-role-secret'
const ANON_KEY = 'synthetic-anon-key'
const SUPABASE_URL = 'https://example.supabase.co'

function deps(overrides: Partial<CreateUserDeps> = {}): CreateUserDeps & { created: unknown[] } {
  const created: unknown[] = []
  return {
    created,
    async getUser(token) {
      if (token === 'admin-token') {
        return {
          data: { user: { app_metadata: { role: 'admin' }, user_metadata: { role: 'user' } } },
          error: null,
        }
      }
      if (token === 'metadata-admin') {
        return {
          data: { user: { app_metadata: {}, user_metadata: { role: 'admin' } } },
          error: null,
        }
      }
      if (token === 'plain-user') {
        return { data: { user: { app_metadata: { role: 'user' } } }, error: null }
      }
      return { data: { user: null }, error: { message: 'invalid' } }
    },
    async createUser(input) {
      created.push(input)
      if (input.email === 'fail@example.com') {
        return { data: { user: null }, error: { message: `rejected ${input.password}` } }
      }
      return { data: { user: { id: 'user-1', email: input.email } }, error: null }
    },
    ...overrides,
  }
}

test.describe('production server', () => {
  let directory: string
  let server: RunningServer
  let admin: ReturnType<typeof deps>

  test.beforeAll(async () => {
    directory = await mkdtemp(path.join(tmpdir(), 'azs-server-'))
    await mkdir(path.join(directory, 'assets'))
    await writeFile(
      path.join(directory, 'index.html'),
      '<!doctype html><html><head><title>AZS</title></head><body><div id="root"></div></body></html>',
    )
    await writeFile(path.join(directory, 'assets', 'app.js'), 'console.log("asset-ok")')
    await writeFile(path.join(directory, 'manifest.json'), '{"name":"AZS Directory"}')
    admin = deps()
    process.env.SUPABASE_SERVICE_ROLE_KEY = SERVICE_ROLE
    server = await startServer({
      distDir: directory,
      host: '127.0.0.1',
      port: 0,
      publicConfig: {
        url: `https://example.supabase.co/</script><script>alert(1)`,
        anonKey: ANON_KEY,
      },
      createUserDeps: admin,
    })
  })

  test.afterAll(async () => {
    await server.close()
    delete process.env.SUPABASE_SERVICE_ROLE_KEY
    await rm(directory, { recursive: true, force: true })
  })

  test('health, deep links, assets, and unknown routes', async () => {
    const health = await fetch(`${server.url}/health`)
    expect(health.status).toBe(200)
    expect(await health.json()).toEqual({ status: 'ok' })
    expect(health.headers.get('cache-control')).toContain('no-store')
    const connection = await new Promise<string | undefined>((resolve, reject) => {
      http.get(`${server.url}/health`, (res) => {
        res.resume()
        res.on('end', () => resolve(res.headers.connection))
      }).on('error', reject)
    })
    expect(connection).toBe('close')

    const login = await fetch(`${server.url}/login`)
    expect(login.status).toBe(200)
    const loginHtml = await login.text()
    expect(loginHtml).toContain('<div id="root">')
    expect(loginHtml).toContain('window.__AZS_PUBLIC__')
    expect(loginHtml).toContain(ANON_KEY)
    expect(loginHtml).not.toContain(SERVICE_ROLE)
    expect(loginHtml).not.toContain('</script><script>')
    expect(loginHtml).toContain('\\u003c/script>')

    const station = await fetch(`${server.url}/stations/01001`)
    expect(station.status).toBe(200)
    expect(await station.text()).toContain('id="root"')

    const index = await fetch(`${server.url}/index.html`)
    expect(await index.text()).toContain('window.__AZS_PUBLIC__')

    const asset = await fetch(`${server.url}/assets/app.js`)
    expect(asset.status).toBe(200)
    expect(asset.headers.get('content-type')).toContain('javascript')
    expect(await asset.text()).toBe('console.log("asset-ok")')

    const manifest = await fetch(`${server.url}/manifest.json`)
    expect(manifest.status).toBe(200)
    expect(await manifest.json()).toEqual({ name: 'AZS Directory' })

    const missing = await fetch(`${server.url}/assets/missing.js`)
    expect(missing.status).toBe(404)
    const missingBody = await missing.text()
    expect(missingBody).toBe('Not found')
    expect(missingBody).not.toContain('id="root"')

    const outside = path.join(directory, '..', 'outside-secret.txt')
    await writeFile(outside, 'outside-secret')
    const escaped = await fetch(`${server.url}/${encodeURIComponent('..\\..\\outside-secret.txt')}`)
    expect(escaped.status).toBe(404)
    expect(await escaped.text()).not.toContain('outside-secret')
    await rm(outside, { force: true })

    const unknown = await fetch(`${server.url}/api/admin/delete-user`, { method: 'POST' })
    expect(unknown.status).toBe(404)
    expect(await unknown.json()).toEqual({ error: 'Not found' })

    const postedPage = await fetch(`${server.url}/login`, { method: 'POST' })
    expect(postedPage.status).toBe(405)
  })

  test('admin authorization uses app_metadata and does not echo secrets', async () => {
    const createdBefore = admin.created.length

    const missingToken = await fetch(`${server.url}/api/admin/create-user`, { method: 'POST' })
    expect(missingToken.status).toBe(401)

    const metadataAdmin = await fetch(`${server.url}/api/admin/create-user`, {
      method: 'POST',
      headers: { authorization: 'Bearer metadata-admin', 'content-type': 'application/json' },
      body: JSON.stringify({ email: 'meta@example.com', password: 'secret-pass', role: 'user' }),
    })
    expect(metadataAdmin.status).toBe(403)
    expect(await metadataAdmin.text()).not.toContain('secret-pass')

    const plain = await fetch(`${server.url}/api/admin/create-user`, {
      method: 'POST',
      headers: { authorization: 'Bearer plain-user', 'content-type': 'application/json' },
      body: JSON.stringify({ email: 'plain@example.com', password: 'secret-pass' }),
    })
    expect(plain.status).toBe(403)

    const invalid = await fetch(`${server.url}/api/admin/create-user`, {
      method: 'POST',
      headers: { authorization: 'Bearer admin-token', 'content-type': 'application/json' },
      body: JSON.stringify({ email: 'not-an-email', password: 'secret-pass' }),
    })
    expect(invalid.status).toBe(400)
    expect(admin.created).toHaveLength(createdBefore)

    const created = await fetch(`${server.url}/api/admin/create-user`, {
      method: 'POST',
      headers: { authorization: 'Bearer admin-token', 'content-type': 'application/json' },
      body: JSON.stringify({ email: 'new@example.com', password: 'secret-pass', role: 'user' }),
    })
    expect(created.status).toBe(200)
    expect(await created.json()).toEqual({
      user: { id: 'user-1', email: 'new@example.com', role: 'user' },
    })
    expect(admin.created.at(-1)).toMatchObject({
      email: 'new@example.com',
      email_confirm: true,
      app_metadata: { role: 'user' },
    })
    expect(JSON.stringify(admin.created.at(-1))).not.toContain('user_metadata')

    const failed = await fetch(`${server.url}/api/admin/create-user`, {
      method: 'POST',
      headers: { authorization: 'Bearer admin-token', 'content-type': 'application/json' },
      body: JSON.stringify({ email: 'fail@example.com', password: 'secret-pass' }),
    })
    expect(failed.status).toBe(400)
    const failedBody = await failed.text()
    expect(failedBody).toContain('Unable to create user')
    expect(failedBody).not.toContain('secret-pass')

    const broken = await fetch(`${server.url}/api/admin/create-user`, {
      method: 'POST',
      headers: { authorization: 'Bearer admin-token', 'content-type': 'application/json' },
      body: '{"email":',
    })
    expect(broken.status).toBe(400)

    const oversized = await fetch(`${server.url}/api/admin/create-user`, {
      method: 'POST',
      headers: { authorization: 'Bearer admin-token', 'content-type': 'application/json' },
      body: `{"email":"${'a'.repeat(MAX_BODY_BYTES)}@example.com"}`,
    })
    expect(oversized.status).toBe(413)
  })

})

test('draining health check reports unavailable', async () => {
  const directory = await mkdtemp(path.join(tmpdir(), 'azs-drain-'))
  await writeFile(path.join(directory, 'index.html'), '<!doctype html><html><head></head><body></body></html>')
  const draining = await startServer({
    distDir: directory,
    host: '127.0.0.1',
    port: 0,
    publicConfig: { url: SUPABASE_URL, anonKey: ANON_KEY },
    createUserDeps: deps(),
  })
  try {
    draining.beginShutdown()
    const health = await fetch(`${draining.url}/health`)
    expect(health.status).toBe(503)
    expect(await health.json()).toEqual({ status: 'draining' })
  } finally {
    await draining.close()
    await rm(directory, { recursive: true, force: true })
  }
})

test('runtime public config fills values the Vite build left empty', () => {
  expect(mergePublicConfig({}, { url: SUPABASE_URL, anonKey: ANON_KEY })).toEqual({
    url: SUPABASE_URL,
    anonKey: ANON_KEY,
  })
  expect(mergePublicConfig(
    { url: 'https://vercel.example', anonKey: 'vercel-anon' },
    { url: SUPABASE_URL, anonKey: ANON_KEY },
  )).toEqual({ url: 'https://vercel.example', anonKey: 'vercel-anon' })

  const host = globalThis as typeof globalThis & { __AZS_PUBLIC__?: { url: string; anonKey: string } }
  host.__AZS_PUBLIC__ = { url: SUPABASE_URL, anonKey: ANON_KEY }
  try {
    const config = readPublicSupabaseConfig()
    expect(config.url).toBeTruthy()
    expect(config.anonKey).toBeTruthy()
  } finally {
    delete host.__AZS_PUBLIC__
  }
})

test('the image build does not accept the service-role key', async () => {
  const dockerfile = await readFile(new URL('../Dockerfile', import.meta.url), 'utf8')
  const ignored = await readFile(new URL('../.dockerignore', import.meta.url), 'utf8')
  expect(dockerfile).toContain('EXPOSE 8080')
  expect(dockerfile).toContain('ca-certificates curl wget')
  expect(dockerfile).toMatch(/^HEALTHCHECK\b/m)
  expect(dockerfile).toContain('http://127.0.0.1:${PORT:-8080}/health')
  expect(dockerfile).not.toMatch(/ARG\s+SUPABASE_SERVICE_ROLE_KEY/)
  expect(dockerfile).not.toMatch(/ENV\s+SUPABASE_SERVICE_ROLE_KEY/)
  expect(dockerfile).not.toMatch(/VITE_/)
  expect(ignored).toContain('.env')
  expect(ignored).toContain('server.mjs')
})
