import { useState } from 'react';

export default function AdminUsers() {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [role, setRole] = useState<'user' | 'admin'>('user');
  const [loading, setLoading] = useState(false);
  const [success, setSuccess] = useState('');
  const [error, setError] = useState('');

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    setSuccess('');
    setError('');

    try {
      const res = await fetch('/api/admin/create-user', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-admin-secret': 'admin-ui',
        },
        body: JSON.stringify({ email, password, role }),
      });

      const data = await res.json();

      if (!res.ok) {
        console.error(data);
        throw new Error(data.error || 'Ошибка создания пользователя');
      }

      setSuccess(`Пользователь ${email} успешно создан`);
      setEmail('');
      setPassword('');
      setRole('user');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Ошибка при создании пользователя');
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
        {error && <div className="error-message">{error}</div>}

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
