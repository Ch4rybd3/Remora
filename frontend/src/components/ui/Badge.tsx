import type { CaseSeverity, CaseStatus } from '../../types'

const severityColors: Record<CaseSeverity, string> = {
  critical: 'bg-severity-critical/15 text-severity-critical border-severity-critical/30',
  high: 'bg-severity-high/15 text-severity-high border-severity-high/30',
  medium: 'bg-severity-medium/15 text-severity-medium border-severity-medium/30',
  low: 'bg-severity-low/15 text-severity-low border-severity-low/30',
  informational: 'bg-accent-muted/10 text-accent-muted border-accent-muted/20',
}

const statusColors: Record<CaseStatus, string> = {
  open: 'bg-accent-green/15 text-accent-green border-accent-green/30',
  in_progress: 'bg-severity-medium/15 text-severity-medium border-severity-medium/30',
  closed: 'bg-accent-muted/10 text-accent-muted border-accent-muted/20',
  archived: 'bg-white/5 text-white/30 border-white/10',
}

export function SeverityBadge({ severity }: { severity: CaseSeverity }) {
  return (
    <span className={`text-xs px-2 py-0.5 rounded border font-mono uppercase tracking-wider ${severityColors[severity]}`}>
      {severity}
    </span>
  )
}

export function StatusBadge({ status }: { status: CaseStatus }) {
  const label = status.replace('_', ' ')
  return (
    <span className={`text-xs px-2 py-0.5 rounded border font-mono uppercase tracking-wider ${statusColors[status]}`}>
      {label}
    </span>
  )
}

export function TLPBadge({ tlp }: { tlp: string }) {
  const colorMap: Record<string, string> = {
    'TLP:RED': 'bg-severity-critical/15 text-severity-critical border-severity-critical/30',
    'TLP:AMBER': 'bg-severity-high/15 text-severity-high border-severity-high/30',
    'TLP:GREEN': 'bg-accent-green/15 text-accent-green border-accent-green/30',
    'TLP:WHITE': 'bg-white/10 text-white border-white/20',
    'TLP:CLEAR': 'bg-white/10 text-white border-white/20',
  }
  const color = colorMap[tlp] ?? 'bg-white/5 text-accent-muted border-white/10'
  return (
    <span className={`text-xs px-2 py-0.5 rounded border font-mono ${color}`}>{tlp}</span>
  )
}

export function Tag({ label }: { label: string }) {
  return (
    <span className="text-xs px-2 py-0.5 rounded bg-white/5 text-accent-muted border border-white/10 font-mono">
      {label}
    </span>
  )
}
