import { promises as fs } from 'node:fs'
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http'
import path from 'node:path'
import { handleCreateUser, type CreateUserDeps } from '../api/admin/create-user'

export const DEFAULT_PORT = 8080
export const MAX_BODY_BYTES = 16 * 1024
const REQUEST_TIMEOUT_MS = 20_000
const HEADERS_TIMEOUT_MS = 10_000

export interface PublicRuntimeConfig {
  url: string
  anonKey: string
}

export interface ServerOptions {
  distDir: string
  host: string
  port: number
  publicConfig: PublicRuntimeConfig
  createUserDeps?: CreateUserDeps
}

export interface RunningServer {
  url: string
  port: number
  beginShutdown: () => void
  close: () => Promise<void>
}

export function serializePublicConfig(config: PublicRuntimeConfig): string {
  return JSON.stringify({ url: config.url, anonKey: config.anonKey }).replace(/</g, '\\u003c')
}

function injectedIndex(template: string, config: PublicRuntimeConfig): string {
  const script = `<script>window.__AZS_PUBLIC__=${serializePublicConfig(config)}</script>`
  if (template.includes('</head>')) return template.replace('</head>', `${script}</head>`)
  return `${script}${template}`
}

function send(
  res: ServerResponse,
  status: number,
  body: string | Buffer,
  headers: Record<string, string>,
  method: string,
) {
  const payload = method === 'HEAD' ? Buffer.alloc(0) : body
  const length = Buffer.isBuffer(body) ? body.length : Buffer.byteLength(body)
  res.writeHead(status, {
    'content-length': String(length),
    'x-content-type-options': 'nosniff',
    ...headers,
  })
  res.end(payload)
}

function sendJson(res: ServerResponse, status: number, body: unknown, method = 'GET') {
  send(res, status, JSON.stringify(body), {
    'content-type': 'application/json; charset=utf-8',
    'cache-control': 'no-store',
  }, method)
}

function contentType(file: string): string {
  switch (path.extname(file).toLowerCase()) {
    case '.html': return 'text/html; charset=utf-8'
    case '.js':
    case '.mjs': return 'text/javascript; charset=utf-8'
    case '.css': return 'text/css; charset=utf-8'
    case '.json':
    case '.webmanifest': return 'application/json; charset=utf-8'
    case '.svg': return 'image/svg+xml'
    case '.png': return 'image/png'
    case '.jpg':
    case '.jpeg': return 'image/jpeg'
    case '.webp': return 'image/webp'
    case '.ico': return 'image/x-icon'
    case '.txt': return 'text/plain; charset=utf-8'
    case '.map': return 'application/json; charset=utf-8'
    case '.woff2': return 'font/woff2'
    default: return 'application/octet-stream'
  }
}

function isInside(root: string, candidate: string): boolean {
  const relative = path.relative(root, candidate)
  return relative === '' || (!relative.startsWith(`..${path.sep}`) && relative !== '..' && !path.isAbsolute(relative))
}

function safePath(distDir: string, urlPath: string): string | null {
  let decoded: string
  try {
    decoded = decodeURIComponent(urlPath)
  } catch {
    return null
  }
  if (decoded.includes('\0') || decoded.includes('\\')) return null
  if (decoded.split('/').includes('..')) return null
  const root = path.resolve(distDir)
  const full = path.resolve(root, decoded.replace(/^[/\\]+/, ''))
  return isInside(root, full) ? full : null
}

async function locate(distDir: string, urlPath: string): Promise<
  | { kind: 'file'; file: string }
  | { kind: 'spa' }
  | { kind: 'missing' }
  | { kind: 'invalid' }
> {
  const full = safePath(distDir, urlPath)
  if (!full) return { kind: 'invalid' }
  const root = path.resolve(distDir)
  if (full === root) return { kind: 'spa' }
  try {
    const stat = await fs.stat(full)
    const real = await fs.realpath(full)
    if (!isInside(root, real)) return { kind: 'invalid' }
    if (stat.isDirectory()) return { kind: 'spa' }
    if (path.basename(real) === 'index.html') return { kind: 'spa' }
    return { kind: 'file', file: real }
  } catch {
    return path.extname(full) ? { kind: 'missing' } : { kind: 'spa' }
  }
}

function readBody(req: IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    let settled = false
    const fail = (statusCode: number) => {
      if (settled) return
      settled = true
      reject(Object.assign(new Error('body'), { statusCode }))
    }
    const done = (value: string) => {
      if (settled) return
      settled = true
      resolve(value)
    }
    const declared = Number(req.headers['content-length'] ?? '0')
    if (Number.isFinite(declared) && declared > MAX_BODY_BYTES) {
      req.resume()
      fail(413)
      return
    }
    const chunks: Buffer[] = []
    let size = 0
    req.on('data', (chunk: Buffer) => {
      size += chunk.length
      if (size > MAX_BODY_BYTES) {
        req.destroy()
        fail(413)
      } else {
        chunks.push(chunk)
      }
    })
    req.on('end', () => done(Buffer.concat(chunks).toString('utf8')))
    req.on('error', () => fail(400))
  })
}

function logRequest(method: string, resource: string, status: number, started: number) {
  const pathname = resource.split('?')[0] || '/'
  console.log(`${method} ${pathname} ${status} ${Date.now() - started}`)
}

export async function startServer(options: ServerOptions): Promise<RunningServer> {
  const distDir = path.resolve(options.distDir)
  const indexTemplate = await fs.readFile(path.join(distDir, 'index.html'), 'utf8')
  const indexHtml = injectedIndex(indexTemplate, options.publicConfig)
  let draining = false

  const server: Server = createServer((req, res) => {
    void handle(req, res)
  })
  server.requestTimeout = REQUEST_TIMEOUT_MS
  server.headersTimeout = HEADERS_TIMEOUT_MS
  server.on('clientError', (_error, socket) => {
    if (socket.writable) socket.end('HTTP/1.1 400 Bad Request\r\nConnection: close\r\n\r\n')
  })

  async function handle(req: IncomingMessage, res: ServerResponse) {
    const started = Date.now()
    const method = req.method ?? 'GET'
    const resource = req.url ?? '/'
    let status = 500
    try {
      const url = new URL(resource, 'http://127.0.0.1')
      status = await dispatch(method, url.pathname, req, res)
    } catch {
      if (!res.headersSent && !res.writableEnded) {
        try {
          sendJson(res, 500, { error: 'Unexpected error' }, method)
        } catch {
          // The client already went away.
        }
      }
      status = res.statusCode || 500
    } finally {
      logRequest(method, resource, status, started)
    }
  }

  async function dispatch(
    method: string,
    pathname: string,
    req: IncomingMessage,
    res: ServerResponse,
  ): Promise<number> {
    if (pathname === '/health') {
      const status = draining ? 503 : 200
      sendJson(res, status, { status: draining ? 'draining' : 'ok' }, method)
      return status
    }

    if (pathname.startsWith('/api/')) {
      if (pathname !== '/api/admin/create-user') {
        req.resume()
        sendJson(res, 404, { error: 'Not found' }, method)
        return 404
      }
      let body: unknown
      if (method === 'POST') {
        let raw = ''
        try {
          raw = await readBody(req)
        } catch (error) {
          const status = (error as { statusCode?: number }).statusCode === 413 ? 413 : 400
          sendJson(res, status, { error: status === 413 ? 'Request too large' : 'Invalid request' }, method)
          return status
        }
        if (raw.length > 0) {
          try {
            body = JSON.parse(raw) as unknown
          } catch {
            sendJson(res, 400, { error: 'Invalid request' }, method)
            return 400
          }
        }
      }
      let status = 200
      await handleCreateUser({
        method,
        headers: req.headers,
        body,
      }, {
        status(code) {
          status = code
          return {
            json(payload) {
              sendJson(res, code, payload, method)
            },
          }
        },
      }, options.createUserDeps)
      return status
    }

    if (method !== 'GET' && method !== 'HEAD') {
      sendJson(res, 405, { error: 'Method not allowed' }, method)
      return 405
    }

    const located = await locate(distDir, pathname)
    if (located.kind === 'invalid' || located.kind === 'missing') {
      send(res, 404, 'Not found', { 'content-type': 'text/plain; charset=utf-8', 'cache-control': 'no-store' }, method)
      return 404
    }
    if (located.kind === 'spa') {
      send(res, 200, indexHtml, {
        'content-type': 'text/html; charset=utf-8',
        'cache-control': 'no-store',
      }, method)
      return 200
    }

    const data = await fs.readFile(located.file)
    send(res, 200, data, {
      'content-type': contentType(located.file),
      'cache-control': pathname.startsWith('/assets/')
        ? 'public, max-age=31536000, immutable'
        : 'public, max-age=3600',
    }, method)
    return 200
  }

  await new Promise<void>((resolve, reject) => {
    server.once('error', reject)
    server.listen(options.port, options.host, () => resolve())
  })
  const address = server.address()
  const port = typeof address === 'object' && address ? address.port : options.port

  return {
    url: `http://${options.host === '0.0.0.0' ? '127.0.0.1' : options.host}:${port}`,
    port,
    beginShutdown() {
      draining = true
    },
    close() {
      draining = true
      return new Promise((resolve, reject) => {
        server.close((error) => error ? reject(error) : resolve())
      })
    },
  }
}
