import { useQuery } from '@tanstack/react-query'
import { useNavigate } from 'react-router-dom'
import {
  FolderOpen, AlertTriangle, Activity, Shield,
  Crosshair, Server, FileArchive, Clock, RefreshCw,
  Target, List,
} from 'lucide-react'
import { dashboardApi, type DashboardStats, type KVCount, type AgingBucket, type RecentCase, type RecentEvent } from '../api/dashboard'
import { SeverityBadge, StatusBadge } from '../components/ui/Badge'
import type { CaseSeverity, CaseStatus } from '../types'

// ── Helpers ────────────────────────────────────────────────────────────────────

function fmtKey(key: string): string {
  return key.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase())
}

function maxCount(items: KVCount[]): number {
  return Math.max(1, ...items.map(i => i.count))
}

// ── KPI Card ───────────────────────────────────────────────────────────────────

function KpiCard({
  label, value, sub, icon: Icon, color, dim = false,
}: {
  label: string
  value: string | number
  sub?: string
  icon: React.ElementType
  color: string
  dim?: boolean
}) {
  return (
    <div className={`card p-5 flex flex-col gap-2 ${dim ? 'opacity-60' : ''}`}>
      <div className="flex items-center justify-between">
        <span className="text-[11px] text-accent-muted uppercase tracking-widest font-medium">{label}</span>
        <Icon size={14} className={color} />
      </div>
      <p className={`text-3xl font-bold font-mono leading-none ${color}`}>{value}</p>
      {sub && <p className="text-[11px] text-accent-muted mt-0.5">{sub}</p>}
    </div>
  )
}

// ── Horizontal bar chart row ───────────────────────────────────────────────────

function BarRow({
  label, count, max, color = 'bg-accent-green/50',
}: {
  label: string; count: number; max: number; color?: string
}) {
  const pct = max > 0 ? (count / max) * 100 : 0
  return (
    <div className="flex items-center gap-2 group">
      <span className="text-xs text-accent-muted w-32 truncate shrink-0 group-hover:text-foreground transition-colors" title={label}>
        {label}
      </span>
      <div className="flex-1 h-1.5 bg-white/5 rounded-full overflow-hidden">
        <div className={`h-full rounded-full transition-all ${color}`} style={{ width: `${pct}%` }} />
      </div>
      <span className="text-xs font-mono text-accent-muted w-6 text-right shrink-0">{count}</span>
    </div>
  )
}

// ── Section header ─────────────────────────────────────────────────────────────

function SectionHeader({ icon: Icon, title }: { icon?: React.ElementType; title: string }) {
  return (
    <h2 className="text-accent-green font-semibold text-xs uppercase tracking-widest mb-4 flex items-center gap-2">
      {Icon && <Icon size={12} />}
      {title}
    </h2>
  )
}

// ── Recent Cases table ─────────────────────────────────────────────────────────

function RecentCasesWidget({ cases }: { cases: RecentCase[] }) {
  const navigate = useNavigate()
  if (cases.length === 0) {
    return (
      <p className="text-accent-muted text-sm text-center py-10">
        No cases yet.{' '}
        <button className="text-accent-green hover:underline" onClick={() => navigate('/cases')}>
          Create one →
        </button>
      </p>
    )
  }
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-xs">
        <thead>
          <tr className="text-left text-accent-muted uppercase tracking-wider border-b border-border">
            <th className="pb-2 pr-3 font-medium">Case</th>
            <th className="pb-2 pr-3 font-medium">Severity</th>
            <th className="pb-2 pr-3 font-medium">Status</th>
            <th className="pb-2 pr-3 font-medium text-right">IOCs</th>
            <th className="pb-2 pr-3 font-medium text-right">Assets</th>
            <th className="pb-2 pr-3 font-medium text-right">Evidence</th>
            <th className="pb-2 font-medium text-right">Age</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-border/40">
          {cases.map(c => (
            <tr
              key={c.id}
              className="hover:bg-white/5 cursor-pointer transition-colors"
              onClick={() => navigate(`/cases/${c.id}`)}
            >
              <td className="py-2.5 pr-3">
                <p className="font-medium text-foreground truncate max-w-[220px]">{c.title}</p>
                <p className="text-accent-muted text-[10px] mt-0.5">{c.updated_at}</p>
              </td>
              <td className="py-2.5 pr-3">
                <SeverityBadge severity={c.severity as CaseSeverity} />
              </td>
              <td className="py-2.5 pr-3">
                <StatusBadge status={c.status as CaseStatus} />
              </td>
              <td className="py-2.5 pr-3 text-right font-mono text-accent-muted">
                {c.ioc_count > 0 ? <span className="text-severity-high">{c.ioc_count}</span> : '—'}
              </td>
              <td className="py-2.5 pr-3 text-right font-mono text-accent-muted">
                {c.asset_count > 0
                  ? <span className="text-severity-medium">{c.asset_count}</span>
                  : '—'}
              </td>
              <td className="py-2.5 pr-3 text-right font-mono text-accent-muted">
                {c.evidence_count > 0 ? c.evidence_count : '—'}
              </td>
              <td className="py-2.5 text-right font-mono">
                {c.days_open >= 0
                  ? <span className={c.days_open > 30 ? 'text-severity-critical' : c.days_open > 7 ? 'text-severity-high' : 'text-accent-muted'}>
                      {c.days_open === 0 ? '<1d' : `${c.days_open}d`}
                    </span>
                  : <span className="text-accent-muted/40">—</span>}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

// ── Case Status + Severity combined widget ─────────────────────────────────────

function CaseStatsWidget({ stats }: { stats: DashboardStats }) {
  const totalBySev = stats.by_severity.reduce((a, b) => a + b.count, 0)
  const totalByStatus = stats.by_status.reduce((a, b) => a + b.count, 0)

  const sevColors: Record<string, string> = {
    critical:      'bg-severity-critical/60',
    high:          'bg-severity-high/60',
    medium:        'bg-severity-medium/60',
    low:           'bg-severity-low/60',
    informational: 'bg-accent-muted/40',
  }
  const statusColors: Record<string, string> = {
    open:        'bg-accent-green/60',
    in_progress: 'bg-severity-medium/60',
    closed:      'bg-accent-muted/40',
    archived:    'bg-white/10',
  }

  return (
    <div className="flex flex-col gap-6">
      {/* Status */}
      <div>
        <SectionHeader icon={Activity} title="By Status" />
        <div className="space-y-2.5">
          {stats.by_status.map(({ key, count }) => (
            <BarRow
              key={key}
              label={fmtKey(key)}
              count={count}
              max={totalByStatus}
              color={statusColors[key] ?? 'bg-white/20'}
            />
          ))}
        </div>
      </div>
      {/* Severity */}
      <div>
        <SectionHeader icon={Shield} title="By Severity" />
        <div className="space-y-2.5">
          {stats.by_severity.map(({ key, count }) => (
            <BarRow
              key={key}
              label={fmtKey(key)}
              count={count}
              max={totalBySev}
              color={sevColors[key] ?? 'bg-white/20'}
            />
          ))}
        </div>
      </div>
    </div>
  )
}

// ── IOC Types ──────────────────────────────────────────────────────────────────

function IocTypesWidget({ data }: { data: KVCount[] }) {
  const top = data.slice(0, 8)
  const mx  = maxCount(top)
  if (top.length === 0) return <p className="text-accent-muted text-xs py-4 text-center">No IOCs recorded.</p>

  const iocColors: Record<string, string> = {
    ip:          'bg-severity-critical/55',
    domain:      'bg-severity-high/55',
    url:         'bg-severity-high/40',
    hash_md5:    'bg-purple-400/50',
    hash_sha1:   'bg-purple-400/50',
    hash_sha256: 'bg-purple-400/50',
    email:       'bg-blue-400/50',
    email_subject: 'bg-blue-400/40',
    sender_name: 'bg-blue-400/35',
    filename:    'bg-severity-medium/55',
    registry:    'bg-pink-400/50',
    user_agent:  'bg-teal-400/50',
  }

  return (
    <div className="space-y-2.5">
      {top.map(({ key, count }) => (
        <BarRow
          key={key}
          label={fmtKey(key)}
          count={count}
          max={mx}
          color={iocColors[key] ?? 'bg-accent-green/40'}
        />
      ))}
    </div>
  )
}

// ── Asset Health ───────────────────────────────────────────────────────────────

function AssetHealthWidget({ stats }: { stats: DashboardStats }) {
  const clean = stats.total_assets - stats.compromised_assets
  const pctComp = stats.total_assets > 0
    ? Math.round((stats.compromised_assets / stats.total_assets) * 100)
    : 0

  const mx = maxCount(stats.asset_by_type)

  return (
    <div className="space-y-4">
      {/* Compromised gauge */}
      <div className="flex items-center gap-4">
        <div className="text-center">
          <p className="text-2xl font-bold font-mono text-severity-critical">{stats.compromised_assets}</p>
          <p className="text-[10px] text-accent-muted mt-0.5">Compromised</p>
        </div>
        <div className="flex-1 space-y-1.5">
          <div className="h-2 bg-white/5 rounded-full overflow-hidden">
            <div
              className="h-full bg-severity-critical/60 rounded-full transition-all"
              style={{ width: `${pctComp}%` }}
            />
          </div>
          <div className="flex justify-between text-[10px] text-accent-muted">
            <span>{pctComp}% compromised</span>
            <span>{clean} clean</span>
          </div>
        </div>
      </div>

      {/* Asset types */}
      {stats.asset_by_type.length > 0 && (
        <div className="space-y-2 pt-2 border-t border-border/40">
          {stats.asset_by_type.slice(0, 6).map(({ key, count }) => (
            <BarRow
              key={key}
              label={fmtKey(key)}
              count={count}
              max={mx}
              color="bg-blue-400/45"
            />
          ))}
        </div>
      )}
    </div>
  )
}

// ── Top MITRE Tactics ──────────────────────────────────────────────────────────

function TopTacticsWidget({ data }: { data: KVCount[] }) {
  const mx = maxCount(data)
  if (data.length === 0) return <p className="text-accent-muted text-xs py-4 text-center">No ATT&CK techniques recorded.</p>

  const tacticColors: Record<string, string> = {
    'Initial Access':      'bg-severity-critical/55',
    'Execution':           'bg-severity-high/55',
    'Persistence':         'bg-severity-medium/55',
    'Privilege Escalation':'bg-severity-high/45',
    'Stealth':             'bg-lime-400/45',
    'Defense Impairment':  'bg-fuchsia-400/45',
    'Credential Access':   'bg-accent-green/55',
    'Discovery':           'bg-teal-400/45',
    'Lateral Movement':    'bg-cyan-400/45',
    'Collection':          'bg-blue-400/45',
    'Command And Control': 'bg-indigo-400/45',
    'Exfiltration':        'bg-purple-400/45',
    'Impact':              'bg-severity-critical/60',
  }

  return (
    <div className="space-y-2.5">
      {data.map(({ key, count }) => (
        <BarRow
          key={key}
          label={key}
          count={count}
          max={mx}
          color={tacticColors[key] ?? 'bg-accent-green/40'}
        />
      ))}
    </div>
  )
}

// ── Case Aging ─────────────────────────────────────────────────────────────────

function CaseAgingWidget({ buckets, avgDays }: { buckets: AgingBucket[]; avgDays: number }) {
  const total = buckets.reduce((a, b) => a + b.count, 0)
  const mx    = Math.max(1, ...buckets.map(b => b.count))

  const agingColors = [
    'bg-accent-green/60',       // < 1 day
    'bg-severity-medium/60',    // 1-7 days
    'bg-severity-high/60',      // 7-30 days
    'bg-severity-critical/60',  // > 30 days
  ]

  return (
    <div className="space-y-4">
      <div className="flex items-baseline gap-3">
        <p className="text-2xl font-bold font-mono text-accent-muted">{avgDays}d</p>
        <p className="text-[11px] text-accent-muted">avg age (active cases)</p>
      </div>
      <div className="space-y-2.5">
        {buckets.map(({ label, count }, i) => (
          <div key={label} className="flex items-center gap-2">
            <span className="text-xs text-accent-muted w-24 shrink-0">{label}</span>
            <div className="flex-1 h-1.5 bg-white/5 rounded-full overflow-hidden">
              <div
                className={`h-full rounded-full transition-all ${agingColors[i]}`}
                style={{ width: mx > 0 ? `${(count / mx) * 100}%` : '0%' }}
              />
            </div>
            <span className="text-xs font-mono text-accent-muted w-4 text-right">{count}</span>
          </div>
        ))}
      </div>
      {total === 0 && (
        <p className="text-[11px] text-accent-muted/60 text-center">No active cases.</p>
      )}
    </div>
  )
}

// ── Recent Timeline Feed ───────────────────────────────────────────────────────

function TimelineFeedWidget({ events }: { events: RecentEvent[] }) {
  const navigate = useNavigate()
  if (events.length === 0) {
    return <p className="text-accent-muted text-xs py-4 text-center">No timeline events yet.</p>
  }
  return (
    <div className="space-y-0 divide-y divide-border/30">
      {events.map((ev, i) => (
        <div
          key={i}
          className="flex items-start gap-3 py-2.5 hover:bg-white/5 px-2 -mx-2 rounded cursor-pointer transition-colors"
          onClick={() => navigate(`/cases/${ev.case_id}?tab=timeline`)}
        >
          <div className="w-1.5 h-1.5 rounded-full bg-accent-green/60 shrink-0 mt-1.5" />
          <div className="flex-1 min-w-0">
            <p className="text-xs font-medium text-foreground truncate">{ev.title}</p>
            <p className="text-[10px] text-accent-muted mt-0.5 truncate">
              <span className="text-accent-green/70">{ev.case_title}</span>
              {ev.actor && <> · {ev.actor}</>}
            </p>
          </div>
          <p className="text-[10px] text-accent-muted/60 shrink-0 whitespace-nowrap">{ev.event_ts}</p>
        </div>
      ))}
    </div>
  )
}

// ── Loading skeleton ───────────────────────────────────────────────────────────

function SkeletonCard() {
  return (
    <div className="card p-5 animate-pulse">
      <div className="h-3 bg-white/5 rounded w-20 mb-3" />
      <div className="h-8 bg-white/5 rounded w-16" />
    </div>
  )
}

// ── Main Dashboard ─────────────────────────────────────────────────────────────

export default function Dashboard() {
  const { data: stats, isLoading, dataUpdatedAt, refetch, isRefetching } = useQuery({
    queryKey: ['dashboard-stats'],
    queryFn: dashboardApi.stats,
    refetchInterval: 60_000,
    staleTime: 30_000,
  })

  const lastUpdated = dataUpdatedAt
    ? new Date(dataUpdatedAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
    : null

  return (
    <div className="p-6 max-w-7xl mx-auto space-y-6">

      {/* ── Header ──────────────────────────────────────────────────────────── */}
      <div className="flex items-end justify-between">
        <div>
          <h1 className="text-2xl font-bold text-accent-green">Dashboard</h1>
          <p className="text-accent-muted text-sm mt-0.5">DFIR Operations Overview</p>
        </div>
        <button
          onClick={() => refetch()}
          disabled={isRefetching}
          className="flex items-center gap-1.5 text-xs text-accent-muted hover:text-foreground transition-colors disabled:opacity-40"
        >
          <RefreshCw size={11} className={isRefetching ? 'animate-spin' : ''} />
          {lastUpdated ? `Updated ${lastUpdated}` : 'Refresh'}
        </button>
      </div>

      {/* ── KPI Strip ───────────────────────────────────────────────────────── */}
      {isLoading ? (
        <div className="grid grid-cols-6 gap-3">
          {Array.from({ length: 6 }).map((_, i) => <SkeletonCard key={i} />)}
        </div>
      ) : stats && (
        <div className="grid grid-cols-6 gap-3">
          <KpiCard
            label="Total Cases"
            value={stats.total_cases}
            icon={FolderOpen}
            color="text-accent-green"
            sub={`${stats.closed_archived} closed`}
          />
          <KpiCard
            label="Active"
            value={stats.active_cases}
            icon={Activity}
            color="text-severity-medium"
            sub="open + in progress"
          />
          <KpiCard
            label="Critical / High"
            value={stats.critical_high}
            icon={AlertTriangle}
            color={stats.critical_high > 0 ? 'text-severity-critical' : 'text-accent-muted'}
            dim={stats.critical_high === 0}
          />
          <KpiCard
            label="Total IOCs"
            value={stats.total_iocs}
            icon={Crosshair}
            color="text-severity-high"
            sub={`${stats.ioc_by_type.length} types`}
          />
          <KpiCard
            label="Compromised"
            value={stats.compromised_assets}
            icon={Server}
            color={stats.compromised_assets > 0 ? 'text-severity-critical' : 'text-accent-muted'}
            sub={`of ${stats.total_assets} assets`}
            dim={stats.compromised_assets === 0}
          />
          <KpiCard
            label="Evidence"
            value={stats.total_evidence}
            icon={FileArchive}
            color="text-blue-400"
            sub={`${stats.total_events} timeline events`}
          />
        </div>
      )}

      {/* ── Row 2: Recent Cases + Case Stats ────────────────────────────────── */}
      {stats && (
        <div className="grid grid-cols-3 gap-5">
          {/* Recent Cases */}
          <div className="col-span-2 card p-5">
            <SectionHeader icon={FolderOpen} title="Recent Cases" />
            <RecentCasesWidget cases={stats.recent_cases} />
          </div>

          {/* Case Status + Severity */}
          <div className="card p-5">
            <CaseStatsWidget stats={stats} />
          </div>
        </div>
      )}

      {/* ── Row 3: IOC Types / Asset Health / MITRE Tactics ─────────────────── */}
      {stats && (
        <div className="grid grid-cols-3 gap-5">
          {/* IOC Types */}
          <div className="card p-5">
            <SectionHeader icon={Crosshair} title={`IOC Breakdown · ${stats.total_iocs}`} />
            <IocTypesWidget data={stats.ioc_by_type} />
          </div>

          {/* Asset Health */}
          <div className="card p-5">
            <SectionHeader icon={Server} title={`Asset Health · ${stats.total_assets}`} />
            <AssetHealthWidget stats={stats} />
          </div>

          {/* MITRE Tactics */}
          <div className="card p-5">
            <SectionHeader icon={Target} title={`Top ATT&CK Tactics · ${stats.total_ttps}`} />
            <TopTacticsWidget data={stats.top_tactics} />
          </div>
        </div>
      )}

      {/* ── Row 4: Case Aging + Timeline Feed ───────────────────────────────── */}
      {stats && (
        <div className="grid grid-cols-3 gap-5">
          {/* Case Aging */}
          <div className="card p-5">
            <SectionHeader icon={Clock} title="Case Aging (Active)" />
            <CaseAgingWidget buckets={stats.case_aging} avgDays={stats.avg_age_days} />
          </div>

          {/* Timeline Feed */}
          <div className="col-span-2 card p-5">
            <SectionHeader icon={List} title={`Recent Timeline Activity · ${stats.total_events} events`} />
            <TimelineFeedWidget events={stats.recent_timeline} />
          </div>
        </div>
      )}

    </div>
  )
}
