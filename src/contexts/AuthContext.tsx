import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from 'react'
import type { AuthError, Session, User } from '@supabase/supabase-js'
import { supabase } from '../lib/supabase'
import {
  AppFailure,
  makeFailure,
  SESSION_RETRY_MESSAGE,
  SIGN_OUT_FAILED_MESSAGE,
  toFailure,
} from '../lib/failures'
import { REQUEST_TIMEOUT_MS } from '../lib/net'
import { readStoredSession, sessionNeedsRefresh } from '../lib/sessionStore'

interface AuthState {
  user: User | null
  session: Session | null
  isAdmin: boolean
  loading: boolean
  recovery: AppFailure | null
  signOutError: AppFailure | null
}

interface AuthContextType extends AuthState {
  signIn: (email: string, password: string) => Promise<{ error: AppFailure | null }>
  signOut: () => Promise<{ ok: boolean }>
  retrySession: () => void
}

const AuthContext = createContext<AuthContextType | null>(null)

function isAdminFromSession(session: Session | null): boolean {
  return session?.user?.app_metadata?.role === 'admin'
}

function settledState(session: Session | null): AuthState {
  if (!session?.user) {
    return {
      user: null,
      session: null,
      isAdmin: false,
      loading: false,
      recovery: null,
      signOutError: null,
    }
  }
  return {
    user: session.user,
    session,
    isAdmin: isAdminFromSession(session),
    loading: false,
    recovery: null,
    signOutError: null,
  }
}

function isTerminalAuthFailure(failure: AppFailure): boolean {
  return failure.category === 'auth_expired' || failure.category === 'credentials'
}

function recoveryFromStorage(operation: string, durationMs: number): AuthState {
  const stored = readStoredSession()
  if (!stored) {
    const failure = makeFailure('network', operation, 'read', durationMs)
    return {
      user: null,
      session: null,
      isAdmin: false,
      loading: false,
      recovery: failure,
      signOutError: null,
    }
  }
  if (!sessionNeedsRefresh(stored)) {
    return settledState(stored)
  }
  const failure = new AppFailure({
    category: 'timeout',
    outcome: 'failed',
    operation,
    durationMs,
    userMessage: SESSION_RETRY_MESSAGE,
  })
  return {
    user: stored.user ?? null,
    session: stored,
    isAdmin: isAdminFromSession(stored),
    loading: false,
    recovery: failure,
    signOutError: null,
  }
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<AuthState>({
    user: null,
    session: null,
    isAdmin: false,
    loading: true,
    recovery: null,
    signOutError: null,
  })
  const attemptRef = useRef(0)

  const applySessionResult = useCallback((attempt: number, result: { data: { session: Session | null }; error: AuthError | null }) => {
    if (attempt !== attemptRef.current) return
    if (result.error) {
      const failure = toFailure(result.error, 'auth.getSession', 'read')
      if (isTerminalAuthFailure(failure) && !readStoredSession()) {
        setState({
          user: null,
          session: null,
          isAdmin: false,
          loading: false,
          recovery: new AppFailure({
            category: 'auth_expired',
            outcome: 'failed',
            operation: 'auth.getSession',
            userMessage: failure.category === 'auth_expired' ? failure.userMessage : failure.userMessage,
          }),
          signOutError: null,
        })
        return
      }
      if (isTerminalAuthFailure(failure)) {
        setState((current) => ({
          ...settledState(null),
          recovery: failure,
          signOutError: current.signOutError,
        }))
        return
      }
      setState((current) => ({
        ...recoveryFromStorage('auth.getSession', failure.durationMs),
        signOutError: current.signOutError,
      }))
      return
    }
    setState((current) => ({
      ...settledState(result.data.session),
      signOutError: current.signOutError,
    }))
  }, [])

  const restore = useCallback(() => {
    const attempt = ++attemptRef.current
    const started = performance.now()

    const timer = window.setTimeout(() => {
      if (attempt !== attemptRef.current) return
      setState((current) => {
        if (attempt !== attemptRef.current || !current.loading) return current
        return {
          ...recoveryFromStorage('auth.getSession', Math.round(performance.now() - started)),
          signOutError: current.signOutError,
        }
      })
    }, REQUEST_TIMEOUT_MS)

    supabase.auth
      .getSession()
      .then((result) => {
        window.clearTimeout(timer)
        applySessionResult(attempt, result)
      })
      .catch((error: unknown) => {
        window.clearTimeout(timer)
        if (attempt !== attemptRef.current) return
        const failure = toFailure(error, 'auth.getSession', 'read')
        if (failure.category === 'aborted') return
        if (isTerminalAuthFailure(failure) && !readStoredSession()) {
          setState((current) => ({
            ...settledState(null),
            recovery: failure,
            signOutError: current.signOutError,
          }))
          return
        }
        setState((current) => ({
          ...recoveryFromStorage('auth.getSession', failure.durationMs || Math.round(performance.now() - started)),
          signOutError: current.signOutError,
        }))
      })
  }, [applySessionResult])

  useEffect(() => {
    restore()
    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((event, session) => {
      if (session?.user) {
        setState((current) => ({
          ...settledState(session),
          signOutError: current.signOutError,
        }))
        return
      }
      if (event === 'SIGNED_OUT') {
        setState((current) => ({
          ...settledState(null),
          signOutError: current.signOutError,
        }))
        return
      }
      const stored = readStoredSession()
      if (stored) {
        setState((current) => ({
          ...(sessionNeedsRefresh(stored)
            ? {
                user: stored.user ?? null,
                session: stored,
                isAdmin: isAdminFromSession(stored),
                loading: false,
                recovery: new AppFailure({
                  category: 'timeout',
                  outcome: 'failed',
                  operation: 'auth.getSession',
                  userMessage: SESSION_RETRY_MESSAGE,
                }),
              }
            : settledState(stored)),
          signOutError: current.signOutError,
        }))
      }
    })
    return () => {
      attemptRef.current += 1
      subscription.unsubscribe()
    }
  }, [restore])

  async function signIn(email: string, password: string) {
    try {
      const { error } = await supabase.auth.signInWithPassword({ email, password })
      if (error) return { error: toFailure(error, 'auth.signIn', 'read') }
      return { error: null }
    } catch (error) {
      return { error: toFailure(error, 'auth.signIn', 'read') }
    }
  }

  async function signOut() {
    setState((current) => ({ ...current, signOutError: null }))
    try {
      const { error } = await supabase.auth.signOut()
      if (error) {
        const failure = toFailure(error, 'auth.signOut', 'write')
        const shown =
          failure.outcome === 'unknown'
            ? failure
            : new AppFailure({
                category: failure.category,
                outcome: 'failed',
                operation: 'auth.signOut',
                durationMs: failure.durationMs,
                userMessage: SIGN_OUT_FAILED_MESSAGE,
              })
        setState((current) => ({ ...current, signOutError: shown }))
        return { ok: false }
      }
      return { ok: true }
    } catch (error) {
      const failure = toFailure(error, 'auth.signOut', 'write')
      setState((current) => ({ ...current, signOutError: failure }))
      return { ok: false }
    }
  }

  const retrySession = useCallback(() => {
    setState((current) => ({ ...current, loading: true, recovery: null }))
    restore()
  }, [restore])

  return (
    <AuthContext.Provider value={{ ...state, signIn, signOut, retrySession }}>
      {children}
    </AuthContext.Provider>
  )
}

// Hook shares this module with the provider; fast refresh does not apply to it.
// eslint-disable-next-line react-refresh/only-export-components
export function useAuth() {
  const context = useContext(AuthContext)
  if (!context) throw new Error('useAuth must be used within AuthProvider')
  return context
}
