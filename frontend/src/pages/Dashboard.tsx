import { useQuery } from '@tanstack/react-query'
import { useNavigate } from 'react-router-dom'
import { FolderOpen, AlertTriangle, CheckCircle, Activity, Shield } from 'lucide-react'
import { casesApi } from '../api/cases'
import type { CaseSeverity } from '../types'
import { SeverityBadge, StatusBadge } from '../components/ui/Badge'
import { format } from 'date-fns'

export default function Dashboard() {
  const navigate = useNavigate()
  const { data: cases = [] } = useQuery({ queryKey: ['cases'], queryFn: casesApi.list })

  const open = cases.filter(c => c.status === 'open').length
  const inProgress = cases.filter(c => c.status === 'in_progress').length
  const closed = cases.filter(c => c.status === 'closed').length
  const critical = cases.filter(c => c.severity === 'critical').length

  const recent = [...cases].slice(0, 5)

  const severityOrder: CaseSeverity[] = ['critical', 'high', 'medium', 'low', 'informational']
  const bySeverity = severityOrder.map(s => ({ severity: s, count: cases.filter(c => c.severity === s).length }))

  return (
    <div className="p-6 max-w-6xl mx-auto">
      <div className="mb-8">
        <h1 className="text-2xl font-bold text-accent-green">Dashboard</h1>
        <p className="text-accent-muted text-sm mt-1">DFIR Operations Overview</p>
      </div>

      <div className="grid grid-cols-4 gap-4 mb-8">
        {[
          { label: 'Open Cases', value: open, icon: FolderOpen, color: 'text-accent-green' },
          { label: 'In Progress', value: inProgress, icon: Activity, color: 'text-severity-medium' },
          { label: 'Critical', value: critical, icon: AlertTriangle, color: 'text-severity-critical' },
          { label: 'Closed', value: closed, icon: CheckCircle, color: 'text-accent-muted' },
        ].map(({ label, value, icon: Icon, color }) => (
          <div key={label} className="card p-5">
            <div className="flex items-center justify-between mb-3">
              <span className="text-xs text-accent-muted uppercase tracking-wide">{label}</span>
              <Icon size={16} className={color} />
            </div>
            <p className={`text-3xl font-bold font-mono ${color}`}>{value}</p>
          </div>
        ))}
      </div>

      <div className="grid grid-cols-3 gap-6">
        <div className="col-span-2 card p-5">
          <h2 className="text-accent-green font-semibold text-sm uppercase tracking-wide mb-4">Recent Cases</h2>
          {recent.length === 0 ? (
            <p className="text-accent-muted text-sm text-center py-8">No cases yet. <button className="text-accent-green hover:underline" onClick={() => navigate('/cases')}>Create one →</button></p>
          ) : (
            <div className="space-y-2">
              {recent.map(c => (
                <div
                  key={c.id}
                  className="flex items-center gap-4 p-3 rounded-lg hover:bg-white/5 cursor-pointer transition-colors"
                  onClick={() => navigate(`/cases/${c.id}`)}
                >
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium truncate">{c.title}</p>
                    <p className="text-xs text-accent-muted mt-0.5">{format(new Date(c.updated_at), 'dd MMM yyyy HH:mm')}</p>
                  </div>
                  <div className="flex items-center gap-2 shrink-0">
                    <SeverityBadge severity={c.severity} />
                    <StatusBadge status={c.status} />
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        <div className="card p-5">
          <h2 className="text-accent-green font-semibold text-sm uppercase tracking-wide mb-4">
            <Shield size={14} className="inline mr-2" />
            By Severity
          </h2>
          <div className="space-y-3">
            {bySeverity.map(({ severity, count }) => (
              <div key={severity} className="flex items-center gap-3">
                <SeverityBadge severity={severity} />
                <div className="flex-1 bg-white/5 rounded-full h-1.5">
                  <div
                    className="h-1.5 rounded-full bg-accent-green/60 transition-all"
                    style={{ width: cases.length ? `${(count / cases.length) * 100}%` : '0%' }}
                  />
                </div>
                <span className="text-xs font-mono text-accent-muted w-4 text-right">{count}</span>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  )
}
