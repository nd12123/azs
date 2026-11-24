import { createClient } from '@supabase/supabase-js'
import { decideCreateUser, isTrustedAdmin, type CreateRole } from '../../src/lib/createUserPolicy'

const supabase = createClient(
  process.env.SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
)

interface RequestLike {
  method?: string
  headers: Record<string, string | string[] | undefined> | { authorization?: string }
  body?: unknown
}

interface ResponseLike {
  status: (code: number) => { json: (body: unknown) => unknown }
}

export default async function handler(req: RequestLike, res: ResponseLike) {
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

    const { data: { user }, error: authError } = await supabase.auth.getUser(token)
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

    const { data, error } = await supabase.auth.admin.createUser({
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
