import { useState } from 'react'
import { VersionFooter } from './VersionFooter'
import { NavLink, useNavigate } from 'react-router-dom'
import { NAV_ICON, LogOut, Clock, AlertTriangle, ChevronDown, Download } from '../../ui/icons'
import { useAuth } from '../../context/AuthContext'
import { useTimezone, TIMEZONE_OPTIONS, type TzOption } from '../../context/TimezoneContext'

const ROLE_COLORS: Record<string, string> = {
  admin:   'bg-severity-critical/10 text-severity-critical border-severity-critical/20',
  owner:   'bg-accent-green/10 text-accent-green border-accent-green/20',
  analyst: 'bg-blue-500/10 text-blue-400 border-blue-500/20',
}

interface NavItem {
  to: string
  label: string
}

interface NavSection {
  heading: string
  items: NavItem[]
}

function SectionHeading({ label }: { label: string }) {
  return (
    <p className="px-3 pt-4 pb-1 text-[9px] font-semibold tracking-widest uppercase text-accent-muted/40 select-none">
      {label}
    </p>
  )
}

function NavItem({ to, label }: NavItem) {
  // The icon is derived from the route rather than passed in, so a destination
  // cannot end up with one icon here and a different one somewhere else.
  const Icon = NAV_ICON[to]
  return (
    <NavLink
      to={to}
      end={to === '/'}
      className={({ isActive }) =>
        `flex items-center gap-3 px-3 py-2 rounded-md text-sm transition-colors ${
          isActive
            ? 'bg-accent-green/10 text-accent-green'
            : 'text-accent-muted hover:text-white hover:bg-white/5'
        }`
      }
    >
      {Icon && <Icon size={16} />}
      {label}
    </NavLink>
  )
}

// ── Timezone selector ─────────────────────────────────────────────────────────

function groupBy<T>(arr: T[], key: keyof T): Record<string, T[]> {
  return arr.reduce((acc, item) => {
    const k = String(item[key])
    ;(acc[k] ??= []).push(item)
    return acc
  }, {} as Record<string, T[]>)
}

function TimezoneSelector() {
  const { timezone, setTz, isUTC } = useTimezone()
  const [open, setOpen] = useState(false)

  const current = TIMEZONE_OPTIONS.find(o => o.value === timezone)
  const grouped  = groupBy(TIMEZONE_OPTIONS, 'region')

  return (
    <div className="relative">
      {/* Trigger */}
      <button
        onClick={() => setOpen(v => !v)}
        className={`flex items-center gap-1.5 w-full px-2 py-1.5 rounded-md text-[11px] transition-colors ${
          isUTC
            ? 'text-accent-muted hover:text-white hover:bg-white/5'
            : 'text-orange-400 hover:bg-orange-400/5'
        }`}
        title={isUTC ? 'Timezone (UTC recommended)' : 'UTC is recommended for forensic analysis'}
      >
        <Clock size={12} className="shrink-0" />
        <span className="flex-1 text-left truncate font-mono">{current?.label ?? timezone}</span>
        {!isUTC && <AlertTriangle size={10} className="shrink-0 text-orange-400" />}
        <ChevronDown size={10} className={`shrink-0 transition-transform ${open ? 'rotate-180' : ''}`} />
      </button>

      {/* Dropdown */}
      {open && (
        <>
          {/* Backdrop */}
          <div className="fixed inset-0 z-40" onClick={() => setOpen(false)} />

          {/* Menu — opens upward */}
          <div className="absolute bottom-full left-0 right-0 mb-1 z-50 bg-bg-card border border-white/10 rounded-lg shadow-xl overflow-hidden max-h-80 overflow-y-auto">

            {/* Warning banner when non-UTC */}
            {!isUTC && (
              <div className="flex items-start gap-2 px-3 py-2 bg-orange-400/8 border-b border-orange-400/20 text-[10px] text-orange-300">
                <AlertTriangle size={11} className="shrink-0 mt-0.5" />
                <span>UTC is recommended for forensic analysis. Changing the timezone can skew event correlation.</span>
              </div>
            )}

            {Object.entries(grouped).map(([region, opts]: [string, TzOption[]]) => (
              <div key={region}>
                <p className="px-3 pt-2 pb-0.5 text-[9px] font-semibold tracking-widest uppercase text-accent-muted/40 select-none">
                  {region}
                </p>
                {opts.map(opt => (
                  <button
                    key={opt.value}
                    onClick={() => { setTz(opt.value); setOpen(false) }}
                    className={`flex items-center gap-2 w-full px-3 py-1.5 text-[11px] text-left transition-colors ${
                      opt.value === timezone
                        ? 'text-accent-green bg-accent-green/8'
                        : 'text-accent-muted hover:text-white hover:bg-white/5'
                    }`}
                  >
                    {opt.value === 'UTC' && (
                      <span className="text-[9px] text-accent-green/60 font-mono border border-accent-green/20 px-1 rounded">REC</span>
                    )}
                    <span className={opt.value === 'UTC' ? 'font-medium' : ''}>{opt.label}</span>
                    <span className="ml-auto text-[9px] font-mono text-accent-muted/30">{opt.value.split('/')[1] ?? opt.value}</span>
                  </button>
                ))}
              </div>
            ))}
          </div>
        </>
      )}
    </div>
  )
}

export default function Sidebar() {
  const { user, logout, isAdmin } = useAuth()
  const navigate = useNavigate()

  const sections: NavSection[] = [
    {
      heading: 'Home',
      items: [
        { to: '/', label: 'Dashboard' },
        { to: '/cases', label: 'Cases' },
      ],
    },
    {
      heading: 'Artifact Processing',
      items: [
        { to: '/artifacts/explorer', label: 'Artifact Explorer' },
        { to: '/artifacts/email', label: 'Email Analysis' },
        { to: '/artifacts/filesystem', label: 'Logs' },
        { to: '/artifacts/pcap', label: 'Network (PCAP)' },
        { to: '/artifacts/images', label: 'Disk Images' },
        { to: '/artifacts/memory', label: 'Memory Analysis' },
        { to: '/artifacts/binary', label: 'Binary Analysis' },
        { to: '/artifacts/cti', label: 'CTI Lookup' },
      ],
    },
    {
      heading: 'Knowledge Base',
      items: [
        { to: '/knowledge', label: 'Vault' },
      ],
    },
    {
      heading: 'Config',
      items: [
        { to: '/config/clients', label: 'Clients' },
        { to: '/templates', label: 'Case Templates' },
        { to: '/report-templates', label: 'Report Templates' },
        { to: '/playbooks', label: 'Playbooks' },
        { to: '/config/chainsaw-rules', label: 'Detection Rules' },
        { to: '/config/connectors', label: 'Connectors' },
        { to: '/config/vaults', label: 'Vault Management' },
        ...(isAdmin ? [{ to: '/users', label: 'Users' }] : []),
        ...(isAdmin ? [{ to: '/audit', label: 'Audit' }] : []),
      ],
    },
  ]

  const handleLogout = () => {
    logout()
    navigate('/login')
  }

  return (
    <aside className="w-56 shrink-0 bg-bg-secondary border-r border-white/5 flex flex-col">
      {/* Logo */}
      <div className="px-5 py-5 border-b border-white/5">
        <div className="flex items-center gap-3">
          <img
            src="/logo.png"
            alt="Remora"
            className="h-8 w-auto object-contain"
            onError={e => { (e.target as HTMLImageElement).style.display = 'none' }}
          />
          <span className="text-accent-green font-bold text-lg tracking-tight font-mono">
            REMORA
          </span>
        </div>
        <p className="text-accent-muted text-xs mt-0.5">DFIR Case Management</p>
      </div>

      {/* Nav sections */}
      <nav className="flex-1 px-3 py-2 overflow-y-auto">
        {sections.map(section => (
          <div key={section.heading}>
            <SectionHeading label={section.heading} />
            {section.items.length === 0
              ? <p className="px-3 py-1.5 text-[11px] italic text-accent-muted/30">Coming soon…</p>
              : (
                <div className="space-y-0.5">
                  {section.items.map(item => (
                    <NavItem key={item.to} {...item} />
                  ))}
                </div>
              )
            }
          </div>
        ))}
      </nav>

      {/* Backup */}
      <div className="px-3 py-2 border-t border-white/5">
        <button
          onClick={async () => {
            try {
              const token = localStorage.getItem('remora_token')
              const res = await fetch('/api/v1/backup', {
                headers: token ? { Authorization: `Bearer ${token}` } : {},
              })
              if (!res.ok) throw new Error(`HTTP ${res.status}`)
              const blob = await res.blob()
              const url  = URL.createObjectURL(blob)
              const a    = document.createElement('a')
              const date = new Date().toISOString().slice(0, 10)
              a.href     = url
              a.download = `remora_backup_${date}.db`
              a.click()
              URL.revokeObjectURL(url)
            } catch (err) {
              alert(`Backup failed: ${err}`)
            }
          }}
          className="flex items-center gap-2 w-full px-2 py-1.5 rounded-md text-xs text-accent-muted/50 hover:text-accent-green hover:bg-accent-green/5 transition-colors"
          title="Download a SQLite backup of the database"
        >
          <Download size={12} />
          Backup BD
        </button>
      </div>

      {/* Timezone selector */}
      <div className="px-3 pb-1 border-t border-white/5 pt-2">
        <p className="px-2 pb-0.5 text-[9px] font-semibold tracking-widest uppercase text-accent-muted/30 select-none">
          Timezone
        </p>
        <TimezoneSelector />
      </div>

      {/* User info + logout */}
      <div className="px-4 py-3 border-t border-white/5 space-y-3">
        {user && (
          <div className="flex items-center gap-2">
            <div className="w-7 h-7 rounded-full bg-accent-green/10 border border-accent-green/20 flex items-center justify-center shrink-0">
              <span className="text-xs font-bold text-accent-green">
                {user.username[0].toUpperCase()}
              </span>
            </div>
            <div className="flex-1 min-w-0">
              <p className="text-xs font-medium text-white truncate">{user.username}</p>
              <span className={`text-[10px] font-mono px-1.5 py-0.5 rounded border ${ROLE_COLORS[user.role]}`}>
                {user.role}
              </span>
            </div>
          </div>
        )}
        <button
          onClick={handleLogout}
          className="flex items-center gap-2 w-full px-2 py-1.5 rounded-md text-xs text-accent-muted hover:text-severity-critical hover:bg-severity-critical/5 transition-colors"
        >
          <LogOut size={13} />
          Log out
        </button>
      </div>

      <VersionFooter />
    </aside>
  )
}
