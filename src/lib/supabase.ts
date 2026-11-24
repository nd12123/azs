import { createClient } from '@supabase/supabase-js'
import { deadlineFetch, REQUEST_TIMEOUT_MS } from './net'
import { readPublicSupabaseConfig } from './publicConfig'

const { url: supabaseUrl, anonKey: supabaseAnonKey } = readPublicSupabaseConfig()

if (!supabaseUrl || !supabaseAnonKey) {
  throw new Error('Missing Supabase environment variables')
}

// lockAcquireTimeout is supported by the installed auth-js client. The
// supabase-js option type has not re-exported it, so the value is passed
// through a widened options object and still reaches GoTrueClient.
export const supabase = createClient(supabaseUrl, supabaseAnonKey, {
  global: {
    fetch: deadlineFetch(fetch),
  },
  auth: {
    persistSession: true,
    autoRefreshToken: true,
    lockAcquireTimeout: REQUEST_TIMEOUT_MS,
  },
} as Parameters<typeof createClient>[2])
