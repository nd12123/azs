import { createClient } from '@supabase/supabase-js'
import { decideCreateUser, isTrustedAdmin, type CreateRole } from '../../src/lib/createUserPolicy'

interface RequestLike {
  method?: string
  headers: Record<string, string | string[] | undefined> | { authorization?: string }
  body?: unknown
}

interface ResponseLike {
  status: (code: number) => { json: (body: unknown) => unknown }
}

interface AdminUser {
  app_metadata?: { role?: unknown }
  user_metadata?: { role?: unknown }
}

export interface CreateUserDeps {
  getUser: (token: string) => Promise<{
    data: { user: AdminUser | null }
    error: { message?: string } | null
  }>
  createUser: (input: {
    email: string
    password: string
    email_confirm: true
    app_metadata: { role: CreateRole }
  }) => Promise<{
    data: { user: { id?: string; email?: string | null } | null }
    error: { message?: string } | null
  }>
}

function defaultDeps(): CreateUserDeps {
  const url = process.env.SUPABASE_URL
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!url || !key) {
    throw new Error('Missing server configuration')
  }
  const supabase = createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
  })
  return {
    async getUser(token) {
      const { data, error } = await supabase.auth.getUser(token)
      const user = data.user
        ? { app_metadata: data.user.app_metadata, user_metadata: data.user.user_metadata }
        : null
      return { data: { user: user as AdminUser | null }, error }
    },
    async createUser(input) {
      const { data, error } = await supabase.auth.admin.createUser(input)
      return { data: { user: data.user }, error }
    },
  }
}

export async function handleCreateUser(
  req: RequestLike,
  res: ResponseLike,
  deps: CreateUserDeps = defaultDeps(),
) {
  try {
    if (req.method !== 'POST') {
      return res.status(405).json({ error: 'Method not allowed' })
    }

    const headerValue = req.headers.authorization ?? req.headers['authorization']
    const authHeader = Array.isArray(headerValue) ? headerValue[0] : headerValue
    const token = authHeader?.replace(/^Bearer\s+/i, '').trim()

    if (!token || token.length > 8192) {
      return res.status(401).json({ error: 'Missing authorization token' })
    }

    const { data: { user }, error: authError } = await deps.getUser(token)
    if (authError || !user || !isTrustedAdmin(user)) {
      if (authError || !user) {
        return res.status(401).json({ error: 'Invalid or expired token' })
      }
      return res.status(403).json({ error: 'Forbidden: admin access required' })
    }

    const decision = decideCreateUser(req.body)
    if (!decision.ok) {
      return res.status(400).json({ error: decision.error })
    }

    const { data, error } = await deps.createUser({
      email: decision.email,
      password: decision.password,
      email_confirm: true,
      app_metadata: { role: decision.role satisfies CreateRole },
    })

    if (error || !data.user) {
      return res.status(400).json({ error: 'Unable to create user' })
    }

    return res.status(200).json({
      user: { id: data.user.id, email: data.user.email, role: decision.role },
    })
  } catch {
    return res.status(500).json({ error: 'Unexpected error' })
  }
}

export default function handler(req: RequestLike, res: ResponseLike) {
  return handleCreateUser(req, res)
}
