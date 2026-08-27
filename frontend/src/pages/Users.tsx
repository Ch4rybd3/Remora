import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { Plus, Trash2, Edit2, KeyRound, ShieldCheck } from 'lucide-react'
import { usersApi, type AuthUser } from '../api/auth'
import { useAuth } from '../context/AuthContext'
import Modal from '../components/ui/Modal'
import ConfirmDialog from '../components/ui/ConfirmDialog'
import { fmtDateTimeShort } from '../utils/dateUtils'

const ROLE_COLORS: Record<string, string> = {
  admin:   'bg-severity-critical/10 text-severity-critical border-severity-critical/20',
  owner:   'bg-accent-green/10 text-accent-green border-accent-green/20',
  analyst: 'bg-blue-500/10 text-blue-400 border-blue-500/20',
}

const ROLE_RANK: Record<string, number> = { analyst: 0, admin: 1, owner: 2 }

/** Retourne vrai si `actor` peut gérer le compte `target`. */
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
          <h1 className="text-2xl font-bold text-accent-green flex items-center gap-2">
            <ShieldCheck size={22} /> Gestion des utilisateurs
          </h1>
          <p className="text-accent-muted text-sm mt-1">{users.length} compte(s)</p>
        </div>
        <button className="btn-primary flex items-center gap-2" onClick={() => setCreateOpen(true)}>
          <Plus size={15} /> Nouvel utilisateur
        </button>
      </div>

      <div className="card overflow-hidden">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-white/5 text-accent-muted text-xs uppercase tracking-wide">
              <th className="text-left px-4 py-3">Utilisateur</th>
              <th className="text-left px-4 py-3">Rôle</th>
              <th className="text-left px-4 py-3">Statut</th>
              <th className="text-left px-4 py-3">Dernière connexion</th>
              <th className="px-4 py-3"></th>
            </tr>
          </thead>
          <tbody>
            {users.map(u => (
              <tr key={u.id} className="border-b border-white/5 last:border-0 hover:bg-white/[0.02] group">
                <td className="px-4 py-3">
                  <p className="font-medium">{u.username}</p>
                  {u.email && <p className="text-xs text-accent-muted">{u.email}</p>}
                  {u.id === me?.id && (
                    <span className="text-xs text-accent-green/60">(vous)</span>
                  )}
                </td>
                <td className="px-4 py-3">
                  <span className={`text-xs font-mono px-2 py-0.5 rounded border ${ROLE_COLORS[u.role]}`}>
                    {u.role}
                  </span>
                </td>
                <td className="px-4 py-3">
                  <button
                    onClick={() => u.id !== me?.id && toggleActive.mutate({ id: u.id, is_active: !u.is_active })}
                    disabled={u.id === me?.id}
                    className={`text-xs px-2 py-0.5 rounded border transition-colors ${
                      u.is_active
                        ? 'bg-accent-green/10 text-accent-green border-accent-green/20 hover:bg-accent-green/20'
                        : 'bg-white/5 text-accent-muted border-white/10 hover:bg-white/10'
                    } disabled:cursor-default disabled:opacity-50`}
                  >
                    {u.is_active ? 'Actif' : 'Inactif'}
                  </button>
                </td>
                <td className="px-4 py-3 text-xs text-accent-muted">
                  {fmtDateTimeShort(u.last_login)}
                </td>
                <td className="px-4 py-3">
                  <div className="flex items-center gap-2 opacity-0 group-hover:opacity-100 transition-opacity">
                    {canManage(me, u) && (
                      <button
                        onClick={() => setEditTarget(u)}
                        className="text-accent-muted hover:text-accent-green transition-colors"
                        title="Changer le rôle"
                      >
                        <Edit2 size={13} />
                      </button>
                    )}
                    {(u.id === me?.id || canManage(me, u)) && (
                      <button
                        onClick={() => setPwTarget(u)}
                        className="text-accent-muted hover:text-severity-medium transition-colors"
                        title="Réinitialiser le mot de passe"
                      >
                        <KeyRound size={13} />
                      </button>
                    )}
                    {u.id !== me?.id && canManage(me, u) && (
                      <button
                        onClick={() => setDeleteTarget(u)}
                        className="text-accent-muted hover:text-severity-critical transition-colors"
                        title="Supprimer"
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
      <Modal open={createOpen} onClose={() => setCreateOpen(false)} title="Nouvel utilisateur" size="sm">
        <div className="space-y-4">
          <div>
            <label className="label">Nom d'utilisateur *</label>
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
            <label className="label">Rôle</label>
            <select className="input" value={form.role} onChange={e => setForm(f => ({ ...f, role: e.target.value }))}>
              {['analyst', 'admin', 'owner']
                .filter(r => ROLE_RANK[r] <= ROLE_RANK[me?.role ?? 'analyst'])
                .map(r => <option key={r} value={r}>{r}</option>)}
            </select>
          </div>
          <div className="flex justify-end gap-3 pt-2">
            <button className="btn-secondary" onClick={() => setCreateOpen(false)}>Annuler</button>
            <button className="btn-primary" onClick={() => create.mutate()} disabled={!form.username || !form.password || create.isPending}>
              {create.isPending ? 'Création…' : 'Créer'}
            </button>
          </div>
        </div>
      </Modal>

      {/* Edit role */}
      <Modal open={!!editTarget} onClose={() => setEditTarget(null)} title={`Rôle — ${editTarget?.username}`} size="sm">
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
            <button className="btn-secondary" onClick={() => setEditTarget(null)}>Annuler</button>
            <button className="btn-primary" onClick={() => editTarget && updateRole.mutate({ id: editTarget.id, role: editTarget.role })} disabled={updateRole.isPending}>
              Enregistrer
            </button>
          </div>
        </div>
      </Modal>

      {/* Change password */}
      <Modal open={!!pwTarget} onClose={() => setPwTarget(null)} title={`Mot de passe — ${pwTarget?.username}`} size="sm">
        <div className="space-y-4">
          <div>
            <label className="label">Nouveau mot de passe</label>
            <input className="input" type="password" value={newPw} onChange={e => setNewPw(e.target.value)} />
          </div>
          <div className="flex justify-end gap-3">
            <button className="btn-secondary" onClick={() => setPwTarget(null)}>Annuler</button>
            <button className="btn-primary" onClick={() => changePw.mutate()} disabled={!newPw || changePw.isPending}>
              {changePw.isPending ? 'Enregistrement…' : 'Changer'}
            </button>
          </div>
        </div>
      </Modal>

      <ConfirmDialog
        open={!!deleteTarget}
        onClose={() => setDeleteTarget(null)}
        onConfirm={() => deleteTarget && remove.mutate(deleteTarget.id)}
        title="Supprimer l'utilisateur"
        message={`Le compte "${deleteTarget?.username}" sera définitivement supprimé.`}
      />
    </div>
  )
}
