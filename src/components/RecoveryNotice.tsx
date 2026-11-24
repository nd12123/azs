interface Props {
  message: string
  detail?: string
  onRetry?: () => void
  pending?: boolean
}

export default function RecoveryNotice({ message, detail, onRetry, pending = false }: Props) {
  return (
    <div className="error-message recovery-notice" role="alert">
      <p>{message}</p>
      {detail && <p className="error-detail">{detail}</p>}
      {onRetry && (
        <button type="button" onClick={onRetry} disabled={pending}>
          {pending ? 'Повторяем...' : 'Повторить'}
        </button>
      )}
    </div>
  )
}
