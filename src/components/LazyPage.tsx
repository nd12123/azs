import { useEffect, useState, type ComponentType } from 'react'
import { CHUNK_FAILED_MESSAGE } from '../lib/failures'
import RecoveryNotice from './RecoveryNotice'

interface Props {
  load: () => Promise<{ default: ComponentType }>
}

export default function LazyPage({ load }: Props) {
  const [error, setError] = useState('')
  const [Component, setComponent] = useState<ComponentType | null>(null)

  useEffect(() => {
    let active = true
    load()
      .then((module) => {
        if (!active) return
        setComponent(() => module.default)
      })
      .catch(() => {
        if (!active) return
        setError(CHUNK_FAILED_MESSAGE)
      })
    return () => {
      active = false
    }
  }, [load])

  if (error) {
    return (
      <div className="recovery-screen">
        <RecoveryNotice
          message={error}
          detail="Код: network · route.chunk"
          onRetry={() => {
            // A failed dynamic import stays failed for that URL until the
            // document is loaded again, so retry has to reload the page.
            window.location.reload()
          }}
        />
      </div>
    )
  }

  if (!Component) {
    return (
      <div className="loading" role="status" aria-live="polite">
        <div className="spinner" />
        <span>Загрузка раздела...</span>
      </div>
    )
  }

  return <Component />
}
