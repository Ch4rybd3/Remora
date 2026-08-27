import type { CaseSeverity, CaseStatus } from '../../types'

const severityColors: Record<CaseSeverity, string> = {
  critical: 'bg-severity-critical/15 text-severity-critical border-severity-critical/30',
  high: 'bg-severity-high/15 text-severity-high border-severity-high/30',
  medium: 'bg-severity-medium/15 text-severity-medium border-severity-medium/30',
  low: 'bg-severity-low/15 text-severity-low border-severity-low/30',
  informational: 'bg-fg-secondary/10 text-fg-secondary border-fg-secondary/20',
}

const statusColors: Record<CaseStatus, string> = {
  open: 'bg-accent/15 text-accent border-accent/30',
  in_progress: 'bg-severity-medium/15 text-severity-medium border-severity-medium/30',
  closed: 'bg-fg-secondary/10 text-fg-secondary border-fg-secondary/20',
  archived: 'bg-fg/5 text-fg/30 border-hairline',
}

export function SeverityBadge({ severity }: { severity: CaseSeverity }) {
  return (
    <span className={`text-label px-2 py-0.5 rounded-control border font-mono uppercase tracking-wider ${severityColors[severity]}`}>
      {severity}
    </span>
  )
}

export function StatusBadge({ status }: { status: CaseStatus }) {
  const label = status.replace('_', ' ')
  return (
    <span className={`text-label px-2 py-0.5 rounded-control border font-mono uppercase tracking-wider ${statusColors[status]}`}>
      {label}
    </span>
  )
}

export function TLPBadge({ tlp }: { tlp: string }) {
  const colorMap: Record<string, string> = {
    'TLP:RED': 'bg-severity-critical/15 text-severity-critical border-severity-critical/30',
    'TLP:AMBER': 'bg-severity-high/15 text-severity-high border-severity-high/30',
    'TLP:GREEN': 'bg-accent/15 text-accent border-accent/30',
    'TLP:WHITE': 'bg-fg/10 text-fg border-strong',
    'TLP:CLEAR': 'bg-fg/10 text-fg border-strong',
  }
  const color = colorMap[tlp] ?? 'bg-fg/5 text-fg-secondary border-hairline'
  return (
    <span className={`text-label px-2 py-0.5 rounded-control border font-mono ${color}`}>{tlp}</span>
  )
}

export function Tag({ label }: { label: string }) {
  return (
    <span className="text-label px-2 py-0.5 rounded-control bg-fg/5 text-fg-secondary border border-hairline font-mono">
      {label}
    </span>
  )
}
