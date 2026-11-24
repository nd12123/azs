import type { Session } from '@supabase/supabase-js'

/** Same margin auth-js uses before it refreshes an access token (3 × 30s). */
export const SESSION_EXPIRY_MARGIN_MS = 90_000

export function authStorageKey(supabaseUrl: string): string {
  const ref = new URL(supabaseUrl).hostname.split('.')[0]
  return `sb-${ref}-auth-token`
}

export function readStoredSession(
  storage: Storage | undefined = globalThis.localStorage,
  supabaseUrl?: string,
): Session | null {
  const url =
    supabaseUrl ??
    (import.meta as ImportMeta & { env?: Record<string, string | undefined> }).env?.VITE_SUPABASE_URL
  if (!url || !storage) return null
  try {
    const raw = storage.getItem(authStorageKey(url))
    if (!raw) return null
    const parsed = JSON.parse(raw) as Session
    if (!parsed?.access_token || !parsed?.refresh_token || typeof parsed.expires_at !== 'number') {
      return null
    }
    return parsed
  } catch {
    return null
  }
}

export function sessionNeedsRefresh(session: Session, now = Date.now()): boolean {
  return session.expires_at! * 1000 - now < SESSION_EXPIRY_MARGIN_MS
}
