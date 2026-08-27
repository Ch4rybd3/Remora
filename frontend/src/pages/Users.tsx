import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { Plus, Trash2, Edit2, KeyRound, ShieldCheck } from '../ui/icons'
import { usersApi, type AuthUser } from '../api/auth'
import { useAuth } from '../context/AuthContext'
import Modal from '../components/ui/Modal'
import ConfirmDialog from '../components/ui/ConfirmDialog'
import { fmtDateTimeShort } from '../utils/dateUtils'

const ROLE_COLORS: Record<string, string> = {
  admin:   'bg-severity-critical/10 text-severity-critical border-severity-critical/20',
  owner:   'bg-accent/10 text-accent border-accent/20',
  analyst: 'bg-severity-low/10 text-severity-low border-severity-low/20',
}

const ROLE_RANK: Record<string, number> = { analyst: 0, admin: 1, owner: 2 }

/** True when `actor` may manage the `target` account. */
function canManage(actor: AuthUser | null, target: AuthUser): boolean {
  if (!actor) return false
  if (actor.id === target.id) return false
  return ROLE_RANK[actor.role] > ROLE_RANK[target.role]
}

export default function Users() {
  const { user: me } = useAuth()
  const qc = useQueryClient()
  const { data: users = [] } = useQuery({ queryKey: ['users'], queryFn: usersApi.list })

  const [createOpen, setCreateOpen] = useState(false)
  const [editTarget, setEditTarget] = useState<AuthUser | null>(null)
  const [pwTarget, setPwTarget] = useState<AuthUser | null>(null)
  const [deleteTarget, setDeleteTarget] = useState<AuthUser | null>(null)

  const [form, setForm] = useState({ username: '', email: '', password: '', role: 'analyst' })
  const [newPw, setNewPw] = useState('')

  const create = useMutation({
    mutationFn: () => usersApi.create(form),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['users'] }); setCreateOpen(false); setForm({ username: '', email: '', password: '', role: 'analyst' }) },
  })

  const updateRole = useMutation({
    mutationFn: ({ id, role }: { id: string; role: string }) => usersApi.update(id, { role }),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['users'] }); setEditTarget(null) },
  })

  const toggleActive = useMutation({
    mutationFn: ({ id, is_active }: { id: string; is_active: boolean }) =>
      usersApi.update(id, { is_active }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['users'] }),
  })

  const changePw = useMutation({
    mutationFn: () => usersApi.changePassword(pwTarget!.id, newPw),
    onSuccess: () => { setPwTarget(null); setNewPw('') },
  })

  const remove = useMutation({
    mutationFn: (id: string) => usersApi.delete(id),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['users'] }),
  })

  return (
    <div className="p-6 max-w-4xl mx-auto">
      <div className="flex items-center justify-between mb-8">
        <div>
          <h1 className="text-title font-bold text-accent flex items-center gap-2">
            <ShieldCheck size={22} /> Gestion des utilisateurs
          </h1>
          <p className="text-fg-secondary text-ui mt-1">{users.length} compte(s)</p>
        </div>
        <button className="btn-primary flex items-center gap-2" onClick={() => setCreateOpen(true)}>
          <Plus size={15} /> New user
        </button>
      </div>

      <div className="card overflow-hidden">
        <table className="w-full text-ui">
          <thead>
            <tr className="border-b border-hairline text-fg-secondary text-label uppercase tracking-wide">
              <th className="text-left px-4 py-3">Utilisateur</th>
              <th className="text-left px-4 py-3">Role</th>
              <th className="text-left px-4 py-3">Status</th>
              <th className="text-left px-4 py-3">Last login</th>
              <th className="px-4 py-3"></th>
            </tr>
          </thead>
          <tbody>
            {users.map(u => (
              <tr key={u.id} className="border-b border-hairline last:border-0 hover:bg-white/[0.02] group">
                <td className="px-4 py-3">
                  <p className="font-medium">{u.username}</p>
                  {u.email && <p className="text-label text-fg-secondary">{u.email}</p>}
                  {u.id === me?.id && (
                    <span className="text-label text-accent/60">(vous)</span>
                  )}
                </td>
                <td className="px-4 py-3">
                  <span className={`text-label font-mono px-2 py-0.5 rounded-control border ${ROLE_COLORS[u.role]}`}>
                    {u.role}
                  </span>
                </td>
                <td className="px-4 py-3">
                  <button
                    onClick={() => u.id !== me?.id && toggleActive.mutate({ id: u.id, is_active: !u.is_active })}
                    disabled={u.id === me?.id}
                    className={`text-label px-2 py-0.5 rounded-control border transition-colors ${ u.is_active
                        ? 'bg-accent/10 text-accent border-accent/20 hover:bg-accent/20'
                        : 'bg-fg/5 text-fg-secondary border-hairline hover:bg-fg/10'
                    } disabled:cursor-default disabled:opacity-50`}
                  >
                    {u.is_active ? 'Actif' : 'Inactif'}
                  </button>
                </td>
                <td className="px-4 py-3 text-label text-fg-secondary">
                  {fmtDateTimeShort(u.last_login)}
                </td>
                <td className="px-4 py-3">
                  <div className="flex items-center gap-2 opacity-0 group-hover:opacity-100 transition-opacity">
                    {canManage(me, u) && (
                      <button
                        onClick={() => setEditTarget(u)}
                        className="text-fg-secondary hover:text-accent transition-colors"
                        title="Change the role"
                      >
                        <Edit2 size={13} />
                      </button>
                    )}
                    {(u.id === me?.id || canManage(me, u)) && (
                      <button
                        onClick={() => setPwTarget(u)}
                        className="text-fg-secondary hover:text-severity-medium transition-colors"
                        title="Reset the password"
                      >
                        <KeyRound size={13} />
                      </button>
                    )}
                    {u.id !== me?.id && canManage(me, u) && (
                      <button
                        onClick={() => setDeleteTarget(u)}
                        className="text-fg-secondary hover:text-severity-critical transition-colors"
                        title="Delete"
                      >
                        <Trash2 size={13} />
                      </button>
                    )}
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* Create */}
      <Modal open={createOpen} onClose={() => setCreateOpen(false)} title="New user" size="sm">
        <div className="space-y-4">
          <div>
            <label className="label">Username *</label>
            <input className="input" value={form.username} onChange={e => setForm(f => ({ ...f, username: e.target.value }))} />
          </div>
          <div>
            <label className="label">Email</label>
            <input className="input" type="email" value={form.email} onChange={e => setForm(f => ({ ...f, email: e.target.value }))} />
          </div>
          <div>
            <label className="label">Mot de passe *</label>
            <input className="input" type="password" value={form.password} onChange={e => setForm(f => ({ ...f, password: e.target.value }))} />
          </div>
          <div>
            <label className="label">Role</label>
            <select className="input" value={form.role} onChange={e => setForm(f => ({ ...f, role: e.target.value }))}>
              {['analyst', 'admin', 'owner']
                .filter(r => ROLE_RANK[r] <= ROLE_RANK[me?.role ?? 'analyst'])
                .map(r => <option key={r} value={r}>{r}</option>)}
            </select>
          </div>
          <div className="flex justify-end gap-3 pt-2">
            <button className="btn-secondary" onClick={() => setCreateOpen(false)}>Cancel</button>
            <button className="btn-primary" onClick={() => create.mutate()} disabled={!form.username || !form.password || create.isPending}>
              {create.isPending ? 'Creating...' : 'Create'}
            </button>
          </div>
        </div>
      </Modal>

      {/* Edit role */}
      <Modal open={!!editTarget} onClose={() => setEditTarget(null)} title={`Role - ${editTarget?.username}`} size="sm">
        <div className="space-y-4">
          <select
            className="input"
            defaultValue={editTarget?.role}
            onChange={e => setEditTarget(t => t ? { ...t, role: e.target.value as any } : null)}
          >
            {['analyst', 'admin', 'owner']
              .filter(r => ROLE_RANK[r] <= ROLE_RANK[me?.role ?? 'analyst'])
              .map(r => <option key={r} value={r}>{r}</option>)}
          </select>
          <div className="flex justify-end gap-3">
            <button className="btn-secondary" onClick={() => setEditTarget(null)}>Cancel</button>
            <button className="btn-primary" onClick={() => editTarget && updateRole.mutate({ id: editTarget.id, role: editTarget.role })} disabled={updateRole.isPending}>
              Save
            </button>
          </div>
        </div>
      </Modal>

      {/* Change password */}
      <Modal open={!!pwTarget} onClose={() => setPwTarget(null)} title={`Mot de passe — ${pwTarget?.username}`} size="sm">
        <div className="space-y-4">
          <div>
            <label className="label">New password</label>
            <input className="input" type="password" value={newPw} onChange={e => setNewPw(e.target.value)} />
          </div>
          <div className="flex justify-end gap-3">
            <button className="btn-secondary" onClick={() => setPwTarget(null)}>Cancel</button>
            <button className="btn-primary" onClick={() => changePw.mutate()} disabled={!newPw || changePw.isPending}>
              {changePw.isPending ? 'Saving...' : 'Change'}
            </button>
          </div>
        </div>
      </Modal>

      <ConfirmDialog
        open={!!deleteTarget}
        onClose={() => setDeleteTarget(null)}
        onConfirm={() => deleteTarget && remove.mutate(deleteTarget.id)}
        title="Delete the user"
        message={`The account "${deleteTarget?.username}" will be permanently deleted.`}
      />
    </div>
  )
}
