export type CreateRole = 'user' | 'admin'

export interface TrustedUser {
  app_metadata?: { role?: unknown }
  user_metadata?: { role?: unknown }
}

/** Admin rights come only from app_metadata, which the user cannot edit. */
export function isTrustedAdmin(user: TrustedUser | null | undefined): boolean {
  return user?.app_metadata?.role === 'admin'
}

export type CreateUserDecision =
  | { ok: true; email: string; password: string; role: CreateRole }
  | { ok: false; error: string }

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

export function decideCreateUser(body: unknown): CreateUserDecision {
  if (typeof body !== 'object' || body === null || Array.isArray(body)) {
    return { ok: false, error: 'Missing fields' }
  }
  const record = body as Record<string, unknown>
  const email = typeof record.email === 'string' ? record.email.trim() : ''
  const password = typeof record.password === 'string' ? record.password : ''
  const role = record.role === undefined ? 'user' : record.role

  if (!email || !password) return { ok: false, error: 'Missing fields' }
  if (email.length > 254 || !EMAIL_PATTERN.test(email)) {
    return { ok: false, error: 'Invalid email' }
  }
  if (password.length < 6 || password.length > 72) {
    return { ok: false, error: 'Invalid password' }
  }
  if (role !== 'user' && role !== 'admin') {
    return { ok: false, error: 'Invalid role' }
  }
  return { ok: true, email, password, role }
}
