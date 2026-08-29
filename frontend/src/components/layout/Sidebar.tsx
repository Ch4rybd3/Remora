import { useState } from 'react'
import { ThemeSelector } from './ThemeSelector'
import { VersionFooter } from './VersionFooter'
import { NavLink, useNavigate } from 'react-router-dom'
import { NAV_ICON, LogOut, Clock, AlertTriangle, ChevronDown, Download } from '../../ui/icons'
import { useAuth } from '../../context/AuthContext'
import { useTimezone, TIMEZONE_OPTIONS, type TzOption } from '../../context/TimezoneContext'

const ROLE_COLORS: Record<string, string> = {
  admin:   'bg-severity-critical/10 text-severity-critical border-severity-critical/20',
  owner:   'bg-accent/10 text-accent border-accent/20',
  analyst: 'bg-severity-low/10 text-severity-low border-severity-low/20',
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
    <p className="px-3 pt-4 pb-1 text-label font-semibold tracking-widest uppercase text-fg-secondary/40 select-none">
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
        `flex items-center gap-3 px-3 py-2 rounded-control text-ui transition-colors ${
          isActive
            ? 'bg-accent/10 text-accent'
            : 'text-fg-secondary hover:text-fg hover:bg-fg/5'
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
        className={`flex items-center gap-1.5 w-full px-2 py-1.5 rounded-control text-label transition-colors ${ isUTC
            ? 'text-fg-secondary hover:text-fg hover:bg-fg/5'
            : 'text-severity-high hover:bg-severity-high/5'
        }`}
        title={isUTC ? 'Timezone (UTC recommended)' : 'UTC is recommended for forensic analysis'}
      >
        <Clock size={12} className="shrink-0" />
        <span className="flex-1 text-left truncate font-mono">{current?.label ?? timezone}</span>
        {!isUTC && <AlertTriangle size={10} className="shrink-0 text-severity-high" />}
        <ChevronDown size={10} className={`shrink-0 transition-transform ${open ? 'rotate-180' : ''}`} />
      </button>

      {/* Dropdown */}
      {open && (
        <>
          {/* Backdrop */}
          <div className="fixed inset-0 z-40" onClick={() => setOpen(false)} />

          {/* Menu — opens upward */}
          <div className="absolute bottom-full left-0 right-0 mb-1 z-50 bg-panel border border-hairline shadow-xl overflow-hidden max-h-80 overflow-y-auto">

            {/* Warning banner when non-UTC */}
            {!isUTC && (
              <div className="flex items-start gap-2 px-3 py-2 bg-severity-high/8 border-b border-severity-high/20 text-label text-severity-high">
                <AlertTriangle size={11} className="shrink-0 mt-0.5" />
                <span>UTC is recommended for forensic analysis. Changing the timezone can skew event correlation.</span>
              </div>
            )}

            {Object.entries(grouped).map(([region, opts]: [string, TzOption[]]) => (
              <div key={region}>
                <p className="px-3 pt-2 pb-0.5 text-label font-semibold tracking-widest uppercase text-fg-secondary/40 select-none">
                  {region}
                </p>
                {opts.map(opt => (
                  <button
                    key={opt.value}
                    onClick={() => { setTz(opt.value); setOpen(false) }}
                    className={`flex items-center gap-2 w-full px-3 py-1.5 text-label text-left transition-colors ${ opt.value === timezone
                        ? 'text-accent bg-accent/8'
                        : 'text-fg-secondary hover:text-fg hover:bg-fg/5'
                    }`}
                  >
                    {opt.value === 'UTC' && (
                      <span className="text-label text-accent/60 font-mono border border-accent/20 px-1 rounded-control">REC</span>
                    )}
                    <span className={opt.value === 'UTC' ? 'font-medium' : ''}>{opt.label}</span>
                    <span className="ml-auto text-label font-mono text-fg-secondary/30">{opt.value.split('/')[1] ?? opt.value}</span>
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
        ...(isAdmin ? [{ to: '/design', label: 'Design System' }] : []),
      ],
    },
  ]

  const handleLogout = () => {
    logout()
    navigate('/login')
  }

  return (
    <aside className="w-56 shrink-0 bg-panel border-r border-hairline flex flex-col">
      {/* Logo */}
      <div className="px-5 py-5 border-b border-hairline">
        <div className="flex items-center gap-3">
          <img
            src="/logo.png"
            alt="Remora"
            className="h-8 w-auto object-contain"
            onError={e => { (e.target as HTMLImageElement).style.display = 'none' }}
          />
          <span className="text-accent font-bold text-title tracking-tight font-mono">
            REMORA
          </span>
        </div>
        <p className="text-fg-secondary text-label mt-0.5">DFIR Case Management</p>
      </div>

      {/* Nav sections */}
      <nav className="flex-1 px-3 py-2 overflow-y-auto">
        {sections.map(section => (
          <div key={section.heading}>
            <SectionHeading label={section.heading} />
            {section.items.length === 0
              ? <p className="px-3 py-1.5 text-label italic text-fg-secondary/30">Coming soon…</p>
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
      <div className="px-3 py-2 border-t border-hairline">
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
          className="flex items-center gap-2 w-full px-2 py-1.5 rounded-control text-label text-fg-secondary/50 hover:text-accent hover:bg-accent/5 transition-colors"
          title="Download a SQLite backup of the database"
        >
          <Download size={12} />
          Backup BD
        </button>
      </div>

      {/* Timezone selector */}
      <div className="px-3 pb-1 border-t border-hairline pt-2">
        <p className="px-2 pb-0.5 text-label font-semibold tracking-widest uppercase text-fg-secondary/30 select-none">
          Timezone
        </p>
        <TimezoneSelector />
      </div>

      <div className="px-3 pb-1">
        <p className="px-2 pb-0.5 text-label font-mono uppercase tracking-label text-fg-muted select-none">
          Theme
        </p>
        <ThemeSelector />
      </div>

      {/* User info + logout */}
      <div className="px-4 py-3 border-t border-hairline space-y-3">
        {user && (
          // The whole identity block is the way to your own account. Two-factor
          // enrolment lives there, and it is not user administration - a factor
          // an admin enrolled for you is not a second factor.
          <NavLink to="/account"
            className="flex items-center gap-2 rounded-control -mx-1 px-1 py-1 hover:bg-white/[0.04] transition-colors">
            <div className="w-7 h-7 rounded-pill bg-accent/10 border border-accent/20 flex items-center justify-center shrink-0">
              <span className="text-label font-bold text-accent">
                {user.username[0].toUpperCase()}
              </span>
            </div>
            <div className="flex-1 min-w-0">
              <p className="text-label font-medium text-fg truncate">{user.username}</p>
              <span className={`text-label font-mono px-1.5 py-0.5 rounded-control border ${ROLE_COLORS[user.role]}`}>
                {user.role}
              </span>
            </div>
          </NavLink>
        )}
        <button
          onClick={handleLogout}
          className="flex items-center gap-2 w-full px-2 py-1.5 rounded-control text-label text-fg-secondary hover:text-severity-critical hover:bg-severity-critical/5 transition-colors"
        >
          <LogOut size={13} />
          Log out
        </button>
      </div>

      <VersionFooter />
    </aside>
  )
}
