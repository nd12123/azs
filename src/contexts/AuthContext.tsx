import { createContext, useContext, useEffect, useState, type ReactNode } from 'react';
import type { User, Session } from '@supabase/supabase-js';
import { supabase } from '../lib/supabase';

interface AuthState {
  user: User | null;
  session: Session | null;
  isAdmin: boolean;
  loading: boolean;
}

interface AuthContextType extends AuthState {
  signIn: (email: string, password: string) => Promise<{ error: Error | null }>;
  signOut: () => Promise<void>;
}

const AuthContext = createContext<AuthContextType | null>(null);

// ✅ Role is read ONLY from JWT metadata (NO DB, NO RLS)
function isAdminFromSession(session: Session | null): boolean {
  return session?.user?.app_metadata?.role === 'admin';
}

// ✅ Resolve auth state deterministically
function resolveAuthState(session: Session | null): AuthState {
  if (!session?.user) {
    return {
      user: null,
      session: null,
      isAdmin: false,
      loading: false,
    };
  }

  return {
    user: session.user,
    session,
    isAdmin: isAdminFromSession(session),
    loading: false,
  };
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<AuthState>({
    user: null,
    session: null,
    isAdmin: false,
    loading: true,
  });

  useEffect(() => {
    let mounted = true;

    // 1. Authoritative session restore
    supabase.auth.getSession().then(({ data: { session } }) => {
      if (!mounted) return;
      setState(resolveAuthState(session));
    });

    // 2. Incremental auth updates
    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((_event, session) => {
      if (!mounted) return;
      setState(resolveAuthState(session));
    });

    return () => {
      mounted = false;
      subscription.unsubscribe();
    };
  }, []);

  async function signIn(email: string, password: string) {
    const { error } = await supabase.auth.signInWithPassword({ email, password });
    return { error: error as Error | null };
  }

  async function signOut() {
    await supabase.auth.signOut();
  }

  return (
    <AuthContext.Provider value={{ ...state, signIn, signOut }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const context = useContext(AuthContext);
  if (!context) {
    throw new Error('useAuth must be used within AuthProvider');
  }
  return context;
}
