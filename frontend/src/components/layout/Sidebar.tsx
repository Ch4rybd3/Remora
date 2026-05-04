import { NavLink, useNavigate } from 'react-router-dom'
import { LayoutDashboard, FolderOpen, FileText, Users, LogOut, GitBranch, Mail, HardDrive, Shield, Cpu, Database, Globe, Binary, KeyRound, FileOutput, Swords } from 'lucide-react'
import { useAuth } from '../../context/AuthContext'

const ROLE_COLORS: Record<string, string> = {
  admin:   'bg-severity-critical/10 text-severity-critical border-severity-critical/20',
  owner:   'bg-accent-green/10 text-accent-green border-accent-green/20',
  analyst: 'bg-blue-500/10 text-blue-400 border-blue-500/20',
}

interface NavItem {
  to: string
  icon: React.ElementType
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

function NavItem({ to, icon: Icon, label }: NavItem) {
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
      <Icon size={16} />
      {label}
    </NavLink>
  )
}

export default function Sidebar() {
  const { user, logout, isAdmin } = useAuth()
  const navigate = useNavigate()

  const sections: NavSection[] = [
    {
      heading: 'Home',
      items: [
        { to: '/', icon: LayoutDashboard, label: 'Dashboard' },
        { to: '/cases', icon: FolderOpen, label: 'Cases' },
      ],
    },
    {
      heading: 'Artifact Processing',
      items: [
        { to: '/artifacts/email',       icon: Mail,      label: 'Email Analysis' },
        { to: '/artifacts/filesystem',  icon: HardDrive, label: 'Logs' },
        { to: '/artifacts/browser',      icon: Globe,     label: 'Browser' },
        { to: '/artifacts/mft',         icon: Database,  label: 'MFT / USN' },
        { to: '/artifacts/memory',      icon: Cpu,       label: 'Memory Analysis' },
        { to: '/artifacts/binary',      icon: Binary,    label: 'Binary Analysis' },
        { to: '/artifacts/registry',    icon: KeyRound,  label: 'Registry' },
      ],
    },
    {
      heading: 'Knowledge Base',
      items: [
        { to: '/knowledge', icon: FileText, label: 'Vault' },
      ],
    },
    {
      heading: 'Config',
      items: [
        { to: '/templates',              icon: FileText,   label: 'Case Templates' },
        { to: '/report-templates',       icon: FileOutput, label: 'Report Templates' },
        { to: '/playbooks',              icon: GitBranch,  label: 'Playbooks' },
        { to: '/config/chainsaw-rules',  icon: Swords,     label: 'Detection Rules' },
        ...(isAdmin ? [{ to: '/users', icon: Users, label: 'Utilisateurs' }] : []),
        ...(isAdmin ? [{ to: '/audit', icon: Shield, label: 'Audit' }] : []),
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
            style={{ filter: 'drop-shadow(0 0 6px rgba(159,239,0,0.25))' }}
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

      {/* User info + logout */}
      <div className="px-4 py-4 border-t border-white/5 space-y-3">
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
          Déconnexion
        </button>
      </div>
    </aside>
  )
}
