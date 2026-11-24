export interface PublicSupabaseConfig {
  url?: string
  anonKey?: string
}

const CONFIG_KEY = '__AZS_PUBLIC__'

function nonempty(value: unknown): string | undefined {
  return typeof value === 'string' && value.length > 0 ? value : undefined
}

/** Values Vite inlined at build time. Empty when the image is built without them. */
function readBuildConfig(): PublicSupabaseConfig {
  try {
    return {
      url: nonempty(import.meta.env.VITE_SUPABASE_URL),
      anonKey: nonempty(import.meta.env.VITE_SUPABASE_ANON_KEY),
    }
  } catch {
    return {}
  }
}

/** Values the production server inserts before the app module runs. */
function readRuntimeConfig(): PublicSupabaseConfig {
  const host = globalThis as typeof globalThis & {
    [CONFIG_KEY]?: PublicSupabaseConfig
  }
  const config = host[CONFIG_KEY]
  return {
    url: nonempty(config?.url),
    anonKey: nonempty(config?.anonKey),
  }
}

/** Prefer a Vite build value, then the value injected when the server starts. */
export function mergePublicConfig(
  built: PublicSupabaseConfig,
  runtime: PublicSupabaseConfig,
): PublicSupabaseConfig {
  return {
    url: built.url ?? runtime.url,
    anonKey: built.anonKey ?? runtime.anonKey,
  }
}

/**
 * Prefer the Vite build values used by Vercel. The Timeweb image is built
 * without those values and receives the same public settings at startup.
 */
export function readPublicSupabaseConfig(): PublicSupabaseConfig {
  return mergePublicConfig(readBuildConfig(), readRuntimeConfig())
}
