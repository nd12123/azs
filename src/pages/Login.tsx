import { useState, type FormEvent } from 'react'
import { Navigate, useLocation } from 'react-router-dom'
import { useAuth } from '../contexts/AuthContext'
import type { AppFailure } from '../lib/failures'
import RecoveryNotice from '../components/RecoveryNotice'

export default function Login() {
  const { user, loading, recovery, signIn, retrySession } = useAuth()
  const location = useLocation()
  const notice = (location.state as { notice?: string } | null)?.notice
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState<AppFailure | null>(null)
  const [submitting, setSubmitting] = useState(false)

  if (user && !loading && !recovery) {
    return <Navigate to="/" replace />
  }

  async function handleSubmit(e: FormEvent) {
    e.preventDefault()
    setError(null)
    setSubmitting(true)
    try {
      const { error: signInError } = await signIn(email, password)
      if (signInError) setError(signInError)
    } finally {
      setSubmitting(false)
    }
  }

  if (loading) {
    return (
      <div className="loading loading-fullscreen" role="status" aria-live="polite">
        <div className="spinner" />
        <span>Восстановление сессии...</span>
      </div>
    )
  }

  if (recovery && recovery.category !== 'auth_expired') {
    return (
      <div className="recovery-screen">
        <RecoveryNotice message={recovery.userMessage} detail={recovery.detail} onRetry={retrySession} />
      </div>
    )
  }

  return (
    <div className="login-page">
      <div className="login-card">
        <h1>AZS Directory</h1>
        <p>Sign in to access the station directory</p>

        <form onSubmit={handleSubmit}>
          <div className="form-group">
            <label htmlFor="email">Email</label>
            <input
              id="email"
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              required
              autoComplete="email"
              disabled={submitting}
            />
          </div>

          <div className="form-group">
            <label htmlFor="password">Password</label>
            <input
              id="password"
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
              autoComplete="current-password"
              disabled={submitting}
            />
          </div>

          {(notice || recovery?.category === 'auth_expired') && (
            <div className="error-message" role="status">
              {notice || recovery?.userMessage}
            </div>
          )}
          {error && (
            <div className="error-message" role="alert">
              <p>{error.userMessage}</p>
              <p className="error-detail">{error.detail}</p>
            </div>
          )}

          <button type="submit" disabled={submitting}>
            {submitting ? 'Signing in...' : 'Sign In'}
          </button>
        </form>
      </div>
    </div>
  )
}
