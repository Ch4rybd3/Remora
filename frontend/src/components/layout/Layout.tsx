import { Outlet } from 'react-router-dom'
import Sidebar from './Sidebar'
import TopBar from './TopBar'
import { ROLE_DESCRIPTIONS, ROLE_LABELS } from '../../auth/roles'
import { useAuth } from '../../context/AuthContext'
import { Eye } from '../../ui/icons'

/**
 * A standing notice for accounts that cannot write.
 *
 * The backend refuses the request either way. This exists so the refusal is
 * expected rather than surprising: an analyst who clicks Save and gets a 403
 * concludes the product is broken, not that they are read-only.
 */
function ReadOnlyBanner() {
  const { user, can } = useAuth()
  if (!user || can('write')) return null

  return (
    <div className="flex items-center gap-2 px-4 py-1.5 bg-severity-medium/8 border-b border-severity-medium/20 shrink-0">
      <Eye size={12} className="text-severity-medium shrink-0" />
      <span className="text-label text-severity-medium">
        {ROLE_LABELS[user.role]} account — {ROLE_DESCRIPTIONS[user.role].toLowerCase()}
      </span>
    </div>
  )
}

export default function Layout() {
  return (
    <div className="flex h-full bg-canvas text-fg">
      <Sidebar />
      <div className="flex-1 flex flex-col overflow-hidden">
        <TopBar />
        <ReadOnlyBanner />
        <main className="flex-1 overflow-auto">
          <Outlet />
        </main>
      </div>
    </div>
  )
}
