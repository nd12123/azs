import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { DEFAULT_PORT, startServer } from './app'

function required(name: string): string {
  const value = process.env[name]?.trim()
  if (!value) {
    console.error(`${name} is required`)
    process.exit(1)
  }
  return value
}

function readPort(value: string | undefined): number {
  if (!value) return DEFAULT_PORT
  const parsed = Number(value)
  if (!Number.isInteger(parsed) || parsed < 1 || parsed > 65535) {
    console.error('PORT must be an integer from 1 to 65535')
    process.exit(1)
  }
  return parsed
}

const supabaseUrl = required('SUPABASE_URL')
const anonKey = required('SUPABASE_ANON_KEY')
const serviceRoleKey = required('SUPABASE_SERVICE_ROLE_KEY')

let parsed: URL
try {
  parsed = new URL(supabaseUrl)
} catch {
  console.error('SUPABASE_URL must be an absolute http(s) URL')
  process.exit(1)
}
if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') {
  console.error('SUPABASE_URL must be an absolute http(s) URL')
  process.exit(1)
}
if (anonKey === serviceRoleKey) {
  console.error('SUPABASE_ANON_KEY must be the public anon key')
  process.exit(1)
}

const port = readPort(process.env.PORT)
const distDir = path.join(path.dirname(fileURLToPath(import.meta.url)), 'dist')

const running = await startServer({
  distDir,
  host: '0.0.0.0',
  port,
  publicConfig: { url: supabaseUrl, anonKey },
})

console.log(`listening ${port}`)

let stopping = false
function shutdown() {
  if (stopping) return
  stopping = true
  running.beginShutdown()
  const timer = setTimeout(() => process.exit(1), 10_000)
  timer.unref()
  void running.close().then(() => process.exit(0))
}

process.on('SIGTERM', shutdown)
process.on('SIGINT', shutdown)
