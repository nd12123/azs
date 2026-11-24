import { Navigate } from 'react-router-dom'
import { useAuth } from '../contexts/AuthContext'
import RecoveryNotice from './RecoveryNotice'

interface Props {
  children: React.ReactNode
  requireAdmin?: boolean
}

export default function ProtectedRoute({ children, requireAdmin = false }: Props) {
  const { user, isAdmin, loading, recovery, retrySession } = useAuth()

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

  if (!user) {
    return (
      <Navigate
        to="/login"
        replace
        state={recovery?.category === 'auth_expired' ? { notice: recovery.userMessage } : undefined}
      />
    )
  }

  if (requireAdmin && !isAdmin) {
    return <Navigate to="/" replace />
  }

  return <>{children}</>
}
