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

// Check user role from user_roles table
async function checkUserRole(userId: string): Promise<boolean> {
  try {
    const { data, error } = await supabase
      .from('user_roles')
      .select('role')
      .eq('user_id', userId)
      .single();

    if (error) {
      console.error('Error checking user role:', error.message);
      return false;
    }

    return data?.role === 'admin';
  } catch (err) {
    console.error('Exception checking user role:', err);
    return false;
  }
}

// Helper to get session with timeout
function getSessionWithTimeout(timeoutMs: number): Promise<Session | null> {
  return Promise.race([
    supabase.auth.getSession().then(({ data }) => data.session),
    new Promise<null>((resolve) => setTimeout(() => resolve(null), timeoutMs)),
  ]);
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
    let authResolved = false;

    // Listen for auth changes FIRST - this is more reliable
    const { data: { subscription } } = supabase.auth.onAuthStateChange(
      async (event, session) => {
        console.log('Auth event:', event);
        authResolved = true;

        if (!mounted) return;

        const isAdmin = session?.user ? await checkUserRole(session.user.id) : false;

        if (!mounted) return;

        setState({
          user: session?.user ?? null,
          session,
          isAdmin,
          loading: false,
        });
      }
    );

    // Fallback: if no auth event fires within 3 seconds, try getSession
    const timeoutId = setTimeout(async () => {
      if (authResolved || !mounted) return;

      console.log('Auth: No event received, trying getSession...');
      try {
        const { data: { session } } = await supabase.auth.getSession();
        console.log('Auth: getSession returned', session ? 'with user' : 'null');

        if (!mounted || authResolved) return;

        const isAdmin = session?.user ? await checkUserRole(session.user.id) : false;

        if (!mounted) return;

        setState({
          user: session?.user ?? null,
          session,
          isAdmin,
          loading: false,
        });
      } catch (err) {
        console.error('Auth: getSession failed', err);
        if (mounted && !authResolved) {
          setState(s => ({ ...s, loading: false }));
        }
      }
    }, 100);

    return () => {
      mounted = false;
      clearTimeout(timeoutId);
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

// Hook to use auth in components
export function useAuth() {
  const context = useContext(AuthContext);
  if (!context) {
    throw new Error('useAuth must be used within AuthProvider');
  }
  return context;
}
