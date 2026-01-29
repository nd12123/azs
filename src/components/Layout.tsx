import { useState, useEffect, useRef } from 'react';
import { Outlet, Link, useNavigate, useLocation } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';

export default function Layout() {
  const { user, isAdmin, signOut } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);

  async function handleSignOut() {
    await signOut();
    navigate('/login');
  }

  // Close mobile menu on route change
  useEffect(() => {
    setMobileMenuOpen(false);
  }, [location.pathname]);

  // Close mobile menu when clicking outside
  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (menuRef.current && !menuRef.current.contains(event.target as Node)) {
        setMobileMenuOpen(false);
      }
    }
    if (mobileMenuOpen) {
      document.addEventListener('mousedown', handleClickOutside);
    }
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [mobileMenuOpen]);

  return (
    <div className="app-layout">
      <header className="app-header">
        <div className="header-left">
          <Link to="/" className="logo">AZS Directory</Link>
        </div>

        {/* Desktop navigation */}
        <nav className="header-nav header-nav-desktop">
          <Link to="/">Станции</Link>
          {isAdmin && <Link to="/import">Импорт</Link>}
          {isAdmin && <Link to="/admin/users">Пользователи</Link>}
        </nav>

        {/* Mobile menu button */}
        <div className="mobile-menu-container" ref={menuRef}>
          <button
            className="mobile-menu-btn"
            onClick={() => setMobileMenuOpen(!mobileMenuOpen)}
            aria-expanded={mobileMenuOpen}
            aria-label="Меню навигации"
          >
            <span className={`hamburger ${mobileMenuOpen ? 'open' : ''}`}>
              <span></span>
              <span></span>
              <span></span>
            </span>
          </button>

          {/* Mobile dropdown menu */}
          {mobileMenuOpen && (
            <nav className="mobile-nav-dropdown">
              <Link to="/" className="mobile-nav-link">Станции</Link>
              {isAdmin && <Link to="/import" className="mobile-nav-link">Импорт</Link>}
              {isAdmin && <Link to="/admin/users" className="mobile-nav-link">Пользователи</Link>}
            </nav>
          )}
        </div>

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
