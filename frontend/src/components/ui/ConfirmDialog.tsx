import Modal from './Modal'

interface Props {
  open: boolean
  onClose: () => void
  onConfirm: () => void
  title: string
  message: string
  confirmLabel?: string
}

export default function ConfirmDialog({
  open, onClose, onConfirm, title, message, confirmLabel = 'Delete',
}: Props) {
  return (
    <Modal open={open} onClose={onClose} title={title} size="sm">
      <p className="text-accent-muted text-sm mb-6">{message}</p>
      <div className="flex justify-end gap-3">
        <button onClick={onClose} className="btn-secondary">Cancel</button>
        <button onClick={() => { onConfirm(); onClose() }} className="btn-danger">{confirmLabel}</button>
      </div>
    </Modal>
  )
}
