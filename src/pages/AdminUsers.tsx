import { useState } from 'react';
import { supabase } from '../lib/supabase';
import { fetchWithDeadline, readJsonResponse } from '../lib/net';
import { AppFailure, toFailure } from '../lib/failures';

function createUserMessage(status: number, serverMessage?: string): string {
  if (status === 401) return 'Сессия истекла. Войдите снова.';
  if (status === 403) return 'Недостаточно прав для создания пользователя.';
  if (status === 429) return 'Слишком много запросов. Подождите немного и повторите попытку.';
  if (status >= 500) return 'Сервер временно недоступен. Повторите попытку.';
  if (serverMessage === 'Invalid email') return 'Укажите корректный email.';
  if (serverMessage === 'Invalid password') return 'Пароль должен быть от 6 до 72 символов.';
  if (serverMessage === 'Invalid role') return 'Укажите роль пользователя или администратора.';
  if (serverMessage === 'Missing fields') return 'Заполните email и пароль.';
  return 'Не удалось создать пользователя.';
}

export default function AdminUsers() {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [role, setRole] = useState<'user' | 'admin'>('user');
  const [loading, setLoading] = useState(false);
  const [success, setSuccess] = useState('');
  const [error, setError] = useState<AppFailure | null>(null);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    setSuccess('');
    setError(null);

    try {
      const { data: { session }, error: sessionError } = await supabase.auth.getSession();
      if (sessionError) throw toFailure(sessionError, 'auth.getSession', 'read');
      if (!session?.access_token) {
        throw toFailure({ message: 'auth_expired:admin.createUser', status: 401 }, 'admin.createUser', 'write');
      }

      const res = await fetchWithDeadline('/api/admin/create-user', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${session.access_token}`,
        },
        body: JSON.stringify({ email, password, role }),
      }, { operation: 'admin.createUser', kind: 'write' });

      const data = await readJsonResponse(res, 'admin.createUser', 'write') as { error?: string };
      if (!res.ok) {
        throw new AppFailure({
          category: res.status === 429 ? 'rate_limit' : res.status >= 500 ? 'server' : res.status === 401 ? 'auth_expired' : 'unknown',
          outcome: 'failed',
          operation: 'admin.createUser',
          userMessage: createUserMessage(res.status, data.error),
        });
      }

      setSuccess(`Пользователь ${email} успешно создан`);
      setEmail('');
      setPassword('');
      setRole('user');
    } catch (err) {
      setError(toFailure(err, 'admin.createUser', 'write'));
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="admin-users-page">
      <h1>Управление пользователями</h1>

      <form onSubmit={handleSubmit} className="user-form">
        <h2>Создать пользователя</h2>

        {success && <div className="success-message">{success}</div>}
        {error && (
          <div className="error-message" role="alert">
            <p>{error.userMessage}</p>
            <p className="error-detail">{error.detail}</p>
          </div>
        )}

        <div className="form-group">
          <label htmlFor="email">Email</label>
          <input
            id="email"
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            required
            disabled={loading}
            placeholder="user@example.com"
          />
        </div>

        <div className="form-group">
          <label htmlFor="password">Пароль</label>
          <input
            id="password"
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            required
            disabled={loading}
            minLength={6}
            placeholder="Минимум 6 символов"
          />
        </div>

        <div className="form-group">
          <label htmlFor="role">Роль</label>
          <select
            id="role"
            value={role}
            onChange={(e) => setRole(e.target.value as 'user' | 'admin')}
            disabled={loading}
          >
            <option value="user">Пользователь</option>
            <option value="admin">Администратор</option>
          </select>
        </div>

        <button type="submit" className="submit-btn" disabled={loading}>
          {loading ? (
            <>
              <span className="spinner" />
              Создание...
            </>
          ) : (
            'Создать пользователя'
          )}
        </button>
      </form>
    </div>
  );
}
