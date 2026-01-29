import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

export default async function handler(req: any, res: any) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  // Extract JWT from Authorization header
  const authHeader = req.headers['authorization'];
  const token = authHeader?.replace('Bearer ', '');

  if (!token) {
    return res.status(401).json({ error: 'Missing authorization token' });
  }

  // Verify the JWT and get user info
  const { data: { user }, error: authError } = await supabase.auth.getUser(token);

  if (authError || !user) {
    return res.status(401).json({ error: 'Invalid or expired token' });
  }

  // Check if user has admin role (check both app_metadata and user_metadata)
  const isAdmin =
    user.app_metadata?.role === 'admin' ||
    user.user_metadata?.role === 'admin';

  if (!isAdmin) {
    return res.status(403).json({ error: 'Forbidden: admin access required' });
  }

  const { email, password, role } = req.body;

  if (!email || !password) {
    return res.status(400).json({ error: 'Missing fields' });
  }

  const { data, error } = await supabase.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
    user_metadata: { role },
  });

  if (error) {
    return res.status(400).json({ error: error.message });
  }

  return res.status(200).json({ user: data.user });
}
