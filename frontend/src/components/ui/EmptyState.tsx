import type { LucideIcon } from '../../ui/icons'

interface Props {
  icon: LucideIcon
  message: string
  action?: { label: string; onClick: () => void }
}

export default function EmptyState({ icon: Icon, message, action }: Props) {
  return (
    <div className="flex flex-col items-center justify-center py-16 text-center">
      <div className="w-14 h-14 rounded-pill bg-fg/5 flex items-center justify-center mb-4">
        <Icon size={24} className="text-fg-secondary/50" />
      </div>
      <p className="text-fg-secondary text-ui mb-4">{message}</p>
      {action && (
        <button onClick={action.onClick} className="btn-secondary text-label">
          {action.label}
        </button>
      )}
    </div>
  )
}
