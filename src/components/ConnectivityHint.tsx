import { useOnlineHint } from '../hooks/useOnlineHint'

export function ConnectivityHint() {
  const online = useOnlineHint()
  if (online) return null
  return (
    <div className="connectivity-hint" role="status">
      Похоже, устройство не в сети. Это не доказывает, что сервер недоступен, и наличие сети не
      гарантирует доступ к нему.
    </div>
  )
}
