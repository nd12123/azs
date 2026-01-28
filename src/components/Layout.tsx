import { Outlet, Link, useNavigate } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';

export default function Layout() {
  const { user, isAdmin, signOut } = useAuth();
  const navigate = useNavigate();

  async function handleSignOut() {
    await signOut();
    navigate('/login');
  }

  return (
    <div className="app-layout">
      <header className="app-header">
        <div className="header-left">
          <Link to="/" className="logo">AZS Directory</Link>
        </div>
        <nav className="header-nav">
          <Link to="/">Станции</Link>
          {isAdmin && <Link to="/import">Импорт</Link>}
          {isAdmin && <Link to="/admin/users">Пользователи</Link>}
        </nav>
        <div className="header-right">
          <span className="user-email">{user?.email}</span>
          <button onClick={handleSignOut} className="sign-out-btn">
            Выйти
          </button>
        </div>
      </header>
      <main className="app-main">
        <Outlet />
      </main>
    </div>
  );
}
