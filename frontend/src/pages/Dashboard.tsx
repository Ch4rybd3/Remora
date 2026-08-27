import { useQuery } from '@tanstack/react-query'
import { useNavigate } from 'react-router-dom'
import {
  FolderOpen, AlertTriangle, Activity, Shield,
  Crosshair, Server, FileArchive, Clock, RefreshCw,
  Target, List, TrendingUp, TrendingDown, Minus,
  Users, Timer,
} from '../ui/icons'
import { dashboardApi, type DashboardStats, type KVCount, type AgingBucket, type RecentCase, type RecentEvent } from '../api/dashboard'
import { SeverityBadge, StatusBadge } from '../components/ui/Badge'
import type { CaseSeverity, CaseStatus } from '../types'
import { fmtTimeOnly } from '../utils/dateUtils'

// ── Helpers ────────────────────────────────────────────────────────────────────

function fmtKey(key: string): string {
  return key.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase())
}

function maxCount(items: KVCount[]): number {
  return Math.max(1, ...items.map(i => i.count))
}

// ── Trend badge ────────────────────────────────────────────────────────────────

function TrendBadge({ current, previous }: { current: number; previous: number }) {
  const diff = current - previous
  if (diff === 0 && previous === 0) return null
  if (diff === 0) return (
    <span className="flex items-center gap-0.5 text-label text-fg-secondary/40 font-mono">
      <Minus size={9} /> same as prev week
    </span>
  )
  const pct = previous > 0 ? Math.abs(Math.round((diff / previous) * 100)) : null
  const up  = diff > 0
  return (
    <span className={`flex items-center gap-0.5 text-label font-mono ${up ? 'text-severity-medium' : 'text-accent'}`}>
      {up ? <TrendingUp size={9} /> : <TrendingDown size={9} />}
      {pct != null ? `${pct}%` : (up ? `+${diff}` : `${diff}`)}
      <span className="text-fg-secondary/40 font-sans ml-0.5">vs prev week</span>
    </span>
  )
}

// ── KPI Card ───────────────────────────────────────────────────────────────────

function KpiCard({
  label, value, sub, icon: Icon, color, dim = false, trend,
}: {
  label: string
  value: string | number
  sub?: string
  icon: React.ElementType
  color: string
  dim?: boolean
  trend?: React.ReactNode
}) {
  return (
    <div className={`bg-panel border border-hairline p-5 flex flex-col gap-2 ${dim ? 'opacity-55' : ''}`}>
      <div className="flex items-center justify-between">
        <span className="text-label text-fg-secondary/50 uppercase tracking-widest font-semibold">{label}</span>
        <Icon size={13} className={color} />
      </div>
      <p className={`text-title font-bold font-mono leading-none ${color}`}>{value}</p>
      <div className="flex flex-col gap-0.5 mt-0.5">
        {sub && <p className="text-label text-fg-secondary/50">{sub}</p>}
        {trend}
      </div>
    </div>
  )
}

// ── Horizontal bar chart row ───────────────────────────────────────────────────

function BarRow({
  label, count, max, color = 'bg-accent/50',
}: {
  label: string; count: number; max: number; color?: string
}) {
  const pct = max > 0 ? (count / max) * 100 : 0
  return (
    <div className="flex items-center gap-2 group">
      <span className="text-label text-fg-secondary/60 w-32 truncate shrink-0 group-hover:text-fg transition-colors" title={label}>
        {label}
      </span>
      <div className="flex-1 h-1.5 bg-fg/5 rounded-pill overflow-hidden">
        <div className={`h-full rounded-pill transition-all ${color}`} style={{ width: `${pct}%` }} />
      </div>
      <span className="text-label font-mono text-fg-secondary/50 w-6 text-right shrink-0">{count}</span>
    </div>
  )
}

// ── Section header ─────────────────────────────────────────────────────────────

function SectionHeader({ icon: Icon, title }: { icon?: React.ElementType; title: string }) {
  return (
    <h2 className="text-accent font-semibold text-label uppercase tracking-widest mb-4 flex items-center gap-2">
      {Icon && <Icon size={11} />}
      {title}
    </h2>
  )
}

// ── Weekly Activity Chart ──────────────────────────────────────────────────────

function ActivityChart({ weeks }: { weeks: KVCount[] }) {
  const max = Math.max(1, ...weeks.map(w => w.count))
  const CHART_H = 72

  return (
    <div className="flex flex-col gap-1.5">
      {/* Bars */}
      <div className="flex items-end gap-1" style={{ height: CHART_H }}>
        {weeks.map((w, i) => {
          const barH = w.count > 0 ? Math.max(4, Math.round((w.count / max) * CHART_H)) : 2
          const intensity = 0.25 + 0.75 * (w.count / max)
          return (
            <div
              key={i}
              className="flex-1 rounded-control cursor-default transition-all hover:opacity-90"
              style={{
                height: barH,
                backgroundColor: w.count > 0
                  ? `rgba(45,212,191,${intensity})`
                  : 'rgba(255,255,255,0.04)',
              }}
              title={`${w.key}: ${w.count} case${w.count !== 1 ? 's' : ''} opened`}
            />
          )
        })}
      </div>
      {/* X-axis labels — every 3rd */}
      <div className="flex gap-1">
        {weeks.map((w, i) => (
          <div key={i} className="flex-1 text-center overflow-hidden">
            {i % 3 === 0 && (
              <span className="text-label text-fg-secondary/30 whitespace-nowrap">{w.key}</span>
            )}
          </div>
        ))}
      </div>
    </div>
  )
}

// ── Status / Severity donut-style summary ──────────────────────────────────────

function StatusDonut({ items }: { items: KVCount[]; colors: Record<string, string> }) {
  const total = items.reduce((a, b) => a + b.count, 0)
  if (total === 0) return <p className="text-fg-secondary/40 text-label py-2 text-center">No data</p>

  // Build SVG donut segments
  const R = 36, STROKE = 10
  const circ = 2 * Math.PI * R
  let offset = 0

  const colorMap: Record<string, string> = {
    open: '#2DD4BF', in_progress: '#FFAF00', closed: '#4b5563', archived: '#374151',
    critical: '#ef4444', high: '#f97316', medium: '#FFAF00', low: '#3b82f6', informational: '#4b5563',
  }

  const segments = items.filter(i => i.count > 0).map(item => {
    const pct = item.count / total
    const dash = circ * pct
    const gap  = circ * (1 - pct)
    const seg  = { key: item.key, count: item.count, dash, gap, offset, color: colorMap[item.key] ?? '#6b7280' }
    offset += dash
    return seg
  })

  return (
    <div className="flex items-center gap-4">
      {/* Donut */}
      <div className="relative shrink-0">
        <svg width="80" height="80" viewBox="0 0 80 80">
          <circle cx="40" cy="40" r={R} fill="none" stroke="rgba(255,255,255,0.04)" strokeWidth={STROKE} />
          {segments.map(seg => (
            <circle
              key={seg.key}
              cx="40" cy="40" r={R}
              fill="none"
              stroke={seg.color}
              strokeWidth={STROKE}
              strokeDasharray={`${seg.dash} ${seg.gap}`}
              strokeDashoffset={-seg.offset + circ * 0.25}
              strokeLinecap="butt"
            />
          ))}
        </svg>
        <div className="absolute inset-0 flex flex-col items-center justify-center">
          <span className="text-title font-bold font-mono text-fg">{total}</span>
          <span className="text-label text-fg-secondary/40">total</span>
        </div>
      </div>

      {/* Legend */}
      <div className="flex-1 space-y-1.5 min-w-0">
        {items.filter(i => i.count > 0).map(({ key, count }) => (
          <div key={key} className="flex items-center gap-2 min-w-0">
            <div className="w-2 h-2 rounded-control shrink-0" style={{ backgroundColor: colorMap[key] ?? '#6b7280' }} />
            <span className="text-label text-fg-secondary/60 truncate flex-1">{fmtKey(key)}</span>
            <span className="text-label font-mono text-fg-secondary/50 shrink-0">{count}</span>
          </div>
        ))}
      </div>
    </div>
  )
}

// ── Recent Cases table ─────────────────────────────────────────────────────────

function RecentCasesWidget({ cases }: { cases: RecentCase[] }) {
  const navigate = useNavigate()
  if (cases.length === 0) {
    return (
      <p className="text-fg-secondary/50 text-ui text-center py-10">
        No cases yet.{' '}
        <button className="text-accent hover:underline" onClick={() => navigate('/cases')}>
          Create one →
        </button>
      </p>
    )
  }
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-label">
        <thead>
          <tr className="text-left text-fg-secondary/40 uppercase tracking-wider border-b border-hairline">
            <th className="pb-2 pr-3 font-semibold text-label">Case</th>
            <th className="pb-2 pr-3 font-semibold text-label">Severity</th>
            <th className="pb-2 pr-3 font-semibold text-label">Status</th>
            <th className="pb-2 pr-3 font-semibold text-label text-right">IOCs</th>
            <th className="pb-2 pr-3 font-semibold text-label text-right">Assets</th>
            <th className="pb-2 pr-3 font-semibold text-label text-right">Evid.</th>
            <th className="pb-2 font-semibold text-label text-right">Age</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-hairline/[0.03]">
          {cases.map(c => (
            <tr
              key={c.id}
              className="hover:bg-white/[0.03] cursor-pointer transition-colors group"
              onClick={() => navigate(`/cases/${c.id}`)}
            >
              <td className="py-2.5 pr-3">
                <p className="font-medium text-fg/80 group-hover:text-fg transition-colors truncate max-w-[200px]">{c.title}</p>
                <p className="text-fg-secondary/30 text-label mt-0.5 font-mono">{c.updated_at}</p>
              </td>
              <td className="py-2.5 pr-3">
                <SeverityBadge severity={c.severity as CaseSeverity} />
              </td>
              <td className="py-2.5 pr-3">
                <StatusBadge status={c.status as CaseStatus} />
              </td>
              <td className="py-2.5 pr-3 text-right font-mono text-fg-secondary/50">
                {c.ioc_count > 0 ? <span className="text-severity-high">{c.ioc_count}</span> : <span className="text-fg/15">—</span>}
              </td>
              <td className="py-2.5 pr-3 text-right font-mono text-fg-secondary/50">
                {c.asset_count > 0 ? <span className="text-severity-low/80">{c.asset_count}</span> : <span className="text-fg/15">—</span>}
              </td>
              <td className="py-2.5 pr-3 text-right font-mono text-fg-secondary/50">
                {c.evidence_count > 0 ? c.evidence_count : <span className="text-fg/15">—</span>}
              </td>
              <td className="py-2.5 text-right font-mono">
                {c.days_open >= 0
                  ? <span className={c.days_open > 30 ? 'text-severity-critical' : c.days_open > 7 ? 'text-severity-high' : 'text-fg-secondary/50'}>
                      {c.days_open === 0 ? '<1d' : `${c.days_open}d`}
                    </span>
                  : <span className="text-fg/15">—</span>}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

// ── IOC Types ──────────────────────────────────────────────────────────────────

function IocTypesWidget({ data }: { data: KVCount[] }) {
  const top = data.slice(0, 8)
  const mx  = maxCount(top)
  if (top.length === 0) return <p className="text-fg-secondary/40 text-label py-4 text-center">No IOCs recorded.</p>

  const iocColors: Record<string, string> = {
    ip:          'bg-severity-critical/55',
    domain:      'bg-severity-high/55',
    url:         'bg-severity-high/40',
    hash_md5:    'bg-data-2/50',
    hash_sha1:   'bg-data-2/50',
    hash_sha256: 'bg-data-2/50',
    email:       'bg-severity-low/50',
    filename:    'bg-severity-medium/55',
    registry:    'bg-data-3/50',
    user_agent:  'bg-accent/50',
  }

  return (
    <div className="space-y-2.5">
      {top.map(({ key, count }) => (
        <BarRow key={key} label={fmtKey(key)} count={count} max={mx} color={iocColors[key] ?? 'bg-accent/40'} />
      ))}
    </div>
  )
}

// ── Asset Health ───────────────────────────────────────────────────────────────

function AssetHealthWidget({ stats }: { stats: DashboardStats }) {
  const clean    = stats.total_assets - stats.compromised_assets
  const pctComp  = stats.total_assets > 0
    ? Math.round((stats.compromised_assets / stats.total_assets) * 100) : 0
  const mx = maxCount(stats.asset_by_type)

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-4">
        <div className="text-center">
          <p className="text-title font-bold font-mono text-severity-critical">{stats.compromised_assets}</p>
          <p className="text-label text-fg-secondary/40 mt-0.5">Compromised</p>
        </div>
        <div className="flex-1 space-y-1.5">
          <div className="h-2 bg-fg/5 rounded-pill overflow-hidden">
            <div className="h-full bg-severity-critical/60 rounded-pill transition-all" style={{ width: `${pctComp}%` }} />
          </div>
          <div className="flex justify-between text-label text-fg-secondary/40">
            <span>{pctComp}% compromised</span>
            <span>{clean} clean</span>
          </div>
        </div>
      </div>

      {stats.asset_by_type.length > 0 && (
        <div className="space-y-2 pt-2 border-t border-hairline">
          {stats.asset_by_type.slice(0, 6).map(({ key, count }) => (
            <BarRow key={key} label={fmtKey(key)} count={count} max={mx} color="bg-severity-low/45" />
          ))}
        </div>
      )}
    </div>
  )
}

// ── Analyst Workload ───────────────────────────────────────────────────────────

function AnalystWidget({ data }: { data: KVCount[] }) {
  const mx = maxCount(data)
  if (data.length === 0) {
    return <p className="text-fg-secondary/40 text-label py-4 text-center">No active assignments.</p>
  }
  return (
    <div className="space-y-2.5">
      {data.map(({ key, count }) => (
        <div key={key} className="flex items-center gap-2 group">
          <div className="w-5 h-5 rounded-pill bg-accent/10 border border-accent/20 flex items-center justify-center shrink-0">
            <span className="text-label font-bold text-accent">{key[0]?.toUpperCase()}</span>
          </div>
          <span className="text-label text-fg-secondary/60 truncate flex-1 group-hover:text-fg transition-colors" title={key}>
            {key}
          </span>
          <div className="flex-1 max-w-20 h-1.5 bg-fg/5 rounded-pill overflow-hidden">
            <div className="h-full rounded-pill bg-accent/40 transition-all" style={{ width: `${(count / mx) * 100}%` }} />
          </div>
          <span className="text-label font-mono text-fg-secondary/50 shrink-0">{count}</span>
        </div>
      ))}
    </div>
  )
}

// ── Top MITRE Tactics ──────────────────────────────────────────────────────────

function TopTacticsWidget({ data }: { data: KVCount[] }) {
  const mx = maxCount(data)
  if (data.length === 0) return <p className="text-fg-secondary/40 text-label py-4 text-center">No ATT&CK techniques recorded.</p>

  const tacticColors: Record<string, string> = {
    'Initial Access':       'bg-severity-critical/55',
    'Execution':            'bg-severity-high/55',
    'Persistence':          'bg-severity-medium/55',
    'Privilege Escalation': 'bg-severity-high/45',
    'Stealth':              'bg-accent/45',
    'Defense Impairment':   'bg-data-2/45',
    'Credential Access':    'bg-accent/55',
    'Discovery':            'bg-accent/45',
    'Lateral Movement':     'bg-data-5/45',
    'Collection':           'bg-severity-low/45',
    'Command And Control':  'bg-data-1/45',
    'Exfiltration':         'bg-data-2/45',
    'Impact':               'bg-severity-critical/60',
  }

  return (
    <div className="space-y-2.5">
      {data.map(({ key, count }) => (
        <BarRow key={key} label={key} count={count} max={mx} color={tacticColors[key] ?? 'bg-accent/40'} />
      ))}
    </div>
  )
}

// ── Case Aging ─────────────────────────────────────────────────────────────────

function CaseAgingWidget({ buckets, avgDays, mttr }: { buckets: AgingBucket[]; avgDays: number; mttr: number }) {
  const total = buckets.reduce((a, b) => a + b.count, 0)
  const mx    = Math.max(1, ...buckets.map(b => b.count))

  const agingColors = [
    'bg-accent/60',
    'bg-severity-medium/60',
    'bg-severity-high/60',
    'bg-severity-critical/60',
  ]

  return (
    <div className="space-y-4">
      {/* Two metrics side by side */}
      <div className="flex gap-4">
        <div>
          <p className="text-title font-bold font-mono text-fg-secondary/70">{avgDays}d</p>
          <p className="text-label text-fg-secondary/40 mt-0.5">avg age (active)</p>
        </div>
        {mttr > 0 && (
          <div className="border-l border-hairline pl-4">
            <p className="text-title font-bold font-mono text-accent/70">{mttr}d</p>
            <p className="text-label text-fg-secondary/40 mt-0.5">MTTR (closed)</p>
          </div>
        )}
      </div>
      <div className="space-y-2.5">
        {buckets.map(({ label, count }, i) => (
          <div key={label} className="flex items-center gap-2">
            <span className="text-label text-fg-secondary/50 w-24 shrink-0">{label}</span>
            <div className="flex-1 h-1.5 bg-fg/5 rounded-pill overflow-hidden">
              <div
                className={`h-full rounded-pill transition-all ${agingColors[i]}`}
                style={{ width: mx > 0 ? `${(count / mx) * 100}%` : '0%' }}
              />
            </div>
            <span className="text-label font-mono text-fg-secondary/50 w-4 text-right">{count}</span>
          </div>
        ))}
      </div>
      {total === 0 && (
        <p className="text-label text-fg-secondary/40 text-center">No active cases.</p>
      )}
    </div>
  )
}

// ── Recent Timeline Feed ───────────────────────────────────────────────────────

function TimelineFeedWidget({ events }: { events: RecentEvent[] }) {
  const navigate = useNavigate()
  if (events.length === 0) {
    return <p className="text-fg-secondary/40 text-label py-4 text-center">No timeline events yet.</p>
  }
  return (
    <div className="space-y-0 divide-y divide-hairline/[0.03]">
      {events.map((ev, i) => (
        <div
          key={i}
          className="flex items-start gap-3 py-2.5 hover:bg-white/[0.03] px-2 -mx-2 rounded-control cursor-pointer transition-colors"
          onClick={() => navigate(`/cases/${ev.case_id}?tab=timeline`)}
        >
          <div className="w-1.5 h-1.5 rounded-pill bg-accent/50 shrink-0 mt-1.5" />
          <div className="flex-1 min-w-0">
            <p className="text-label font-medium text-fg/70 truncate">{ev.title}</p>
            <p className="text-label text-fg-secondary/40 mt-0.5 truncate">
              <span className="text-accent/60">{ev.case_title}</span>
              {ev.actor && <> · {ev.actor}</>}
            </p>
          </div>
          <p className="text-label text-fg-secondary/40 shrink-0 whitespace-nowrap font-mono">{ev.event_ts}</p>
        </div>
      ))}
    </div>
  )
}

// ── Loading skeleton ───────────────────────────────────────────────────────────

function SkeletonCard() {
  return (
    <div className="bg-panel border border-hairline p-5 animate-pulse">
      <div className="h-2.5 bg-fg/5 rounded-control w-20 mb-3" />
      <div className="h-8 bg-fg/5 rounded-control w-16" />
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

  const lastUpdated = dataUpdatedAt ? fmtTimeOnly(dataUpdatedAt) : null

  return (
    <div className="p-6 max-w-7xl mx-auto space-y-5">

      {/* ── Header ──────────────────────────────────────────────────────────── */}
      <div className="flex items-end justify-between">
        <div>
          <h1 className="text-title font-bold text-fg">Dashboard</h1>
          <p className="text-fg-secondary/50 text-label mt-0.5">DFIR Operations Overview</p>
        </div>
        <button
          onClick={() => refetch()}
          disabled={isRefetching}
          className="flex items-center gap-1.5 text-label text-fg-secondary/40 hover:text-fg transition-colors disabled:opacity-40"
        >
          <RefreshCw size={11} className={isRefetching ? 'animate-spin' : ''} />
          {lastUpdated ? `Updated ${lastUpdated}` : 'Refresh'}
        </button>
      </div>

      {/* ── KPI Strip ───────────────────────────────────────────────────────── */}
      {isLoading ? (
        <div className="grid grid-cols-4 md:grid-cols-8 gap-3">
          {Array.from({ length: 8 }).map((_, i) => <SkeletonCard key={i} />)}
        </div>
      ) : stats && (
        <div className="grid grid-cols-4 gap-3">
          <KpiCard
            label="Total Cases"
            value={stats.total_cases}
            icon={FolderOpen}
            color="text-accent"
            sub={`${stats.closed_archived} closed · ${stats.active_cases} active`}
          />
          <KpiCard
            label="This Week"
            value={stats.cases_this_week}
            icon={Activity}
            color="text-severity-medium"
            sub="cases opened"
            trend={<TrendBadge current={stats.cases_this_week} previous={stats.cases_last_week} />}
          />
          <KpiCard
            label="Critical / High"
            value={stats.critical_high}
            icon={AlertTriangle}
            color={stats.critical_high > 0 ? 'text-severity-critical' : 'text-fg-secondary'}
            sub="severity cases"
            dim={stats.critical_high === 0}
          />
          <KpiCard
            label="MTTR"
            value={stats.mttr_days > 0 ? `${stats.mttr_days}d` : '—'}
            icon={Timer}
            color="text-accent"
            sub="mean time to resolve"
            dim={stats.mttr_days === 0}
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
            color={stats.compromised_assets > 0 ? 'text-severity-critical' : 'text-fg-secondary'}
            sub={`of ${stats.total_assets} assets`}
            dim={stats.compromised_assets === 0}
          />
          <KpiCard
            label="Evidence"
            value={stats.total_evidence}
            icon={FileArchive}
            color="text-severity-low"
            sub="files collected"
          />
          <KpiCard
            label="Timeline Events"
            value={stats.total_events}
            icon={List}
            color="text-data-1"
            sub={`${stats.total_ttps} TTP${stats.total_ttps !== 1 ? 's' : ''} mapped`}
          />
        </div>
      )}

      {/* ── Activity Chart ───────────────────────────────────────────────────── */}
      {stats && (
        <div className="bg-panel border border-hairline p-5">
          <div className="flex items-center justify-between mb-4">
            <SectionHeader icon={Activity} title="Case Activity — Last 12 Weeks" />
            <span className="text-label text-fg-secondary/30 font-mono -mt-4">
              {stats.activity_by_week.reduce((a, b) => a + b.count, 0)} cases opened
            </span>
          </div>
          <ActivityChart weeks={stats.activity_by_week} />
        </div>
      )}

      {/* ── Row: Recent Cases + Distribution ────────────────────────────────── */}
      {stats && (
        <div className="grid grid-cols-3 gap-5">
          {/* Recent Cases */}
          <div className="col-span-2 bg-panel border border-hairline p-5">
            <SectionHeader icon={FolderOpen} title="Recent Cases" />
            <RecentCasesWidget cases={stats.recent_cases} />
          </div>

          {/* Status + Severity donuts */}
          <div className="bg-panel border border-hairline p-5 space-y-6">
            <div>
              <SectionHeader icon={Activity} title="By Status" />
              <StatusDonut items={stats.by_status} colors={{}} />
            </div>
            <div className="border-t border-hairline pt-5">
              <SectionHeader icon={Shield} title="By Severity" />
              <StatusDonut items={stats.by_severity} colors={{}} />
            </div>
          </div>
        </div>
      )}

      {/* ── Row: IOC / Asset / Analyst ───────────────────────────────────────── */}
      {stats && (
        <div className="grid grid-cols-3 gap-5">
          <div className="bg-panel border border-hairline p-5">
            <SectionHeader icon={Crosshair} title={`IOC Breakdown · ${stats.total_iocs}`} />
            <IocTypesWidget data={stats.ioc_by_type} />
          </div>

          <div className="bg-panel border border-hairline p-5">
            <SectionHeader icon={Server} title={`Asset Health · ${stats.total_assets}`} />
            <AssetHealthWidget stats={stats} />
          </div>

          <div className="bg-panel border border-hairline p-5">
            <SectionHeader icon={Users} title="Analyst Workload (active)" />
            <AnalystWidget data={stats.by_analyst} />
          </div>
        </div>
      )}

      {/* ── Row: Aging / MITRE / Timeline ───────────────────────────────────── */}
      {stats && (
        <div className="grid grid-cols-3 gap-5">
          <div className="bg-panel border border-hairline p-5">
            <SectionHeader icon={Clock} title="Case Aging" />
            <CaseAgingWidget buckets={stats.case_aging} avgDays={stats.avg_age_days} mttr={stats.mttr_days} />
          </div>

          <div className="bg-panel border border-hairline p-5">
            <SectionHeader icon={Target} title={`ATT&CK Tactics · ${stats.total_ttps}`} />
            <TopTacticsWidget data={stats.top_tactics} />
          </div>

          <div className="bg-panel border border-hairline p-5">
            <SectionHeader icon={List} title={`Recent Timeline · ${stats.total_events}`} />
            <TimelineFeedWidget events={stats.recent_timeline} />
          </div>
        </div>
      )}

    </div>
  )
}
