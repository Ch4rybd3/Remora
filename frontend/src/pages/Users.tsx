import { useState } from 'react'
import { PageShell } from '../ui/PageShell'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { AlertCircle, Plus, Trash2, Edit2, KeyRound } from '../ui/icons'
import { usersApi, type AuthUser } from '../api/auth'
import {
  ALL_ROLES, ROLE_COLORS, ROLE_DESCRIPTIONS, ROLE_LABELS,
  canManage, mayAssignRole, type Role,
} from '../auth/roles'
import { useAuth } from '../context/AuthContext'
import { DataTable } from '../ui/DataTable'
import { Panel } from '../ui/Panel'
import Modal from '../components/ui/Modal'
import ConfirmDialog from '../components/ui/ConfirmDialog'
import { fmtDateTimeShort } from '../utils/dateUtils'

/**
 * Role management, using the shared rules in `auth/roles`.
 *
 * The rank comparison that used to live here could not express the two new
 * roles: "sees everything, writes nothing" has no position on a line.
 */

/**
 * Whatever the backend refused with, as something worth showing.
 *
 * Every mutation on this page used to fail in silence: the button said
 * "Creating", went back to "Create", and nothing appeared. An action that fails
 * without saying so is indistinguishable from a broken product.
 */
function errorMessage(error: unknown): string {
  const detail = (error as any)?.response?.data?.detail
  if (typeof detail === 'string') return detail
  // FastAPI validation errors arrive as a list of field problems.
  if (Array.isArray(detail)) {
    return detail.map((d: any) => d?.msg ?? String(d)).join('. ')
  }
  return (error as any)?.message ?? 'The request was refused'
}

function ErrorNote({ error }: { error: unknown }) {
  if (!error) return null
  return (
    <p className="flex items-start gap-1.5 text-label text-severity-critical">
      <AlertCircle size={11} className="mt-0.5 shrink-0" />
      {errorMessage(error)}
    </p>
  )
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

  // `reset()` on open, so a failure from the previous attempt is not the first
  // thing shown the next time the dialog appears.
  const create = useMutation({
    mutationFn: () => usersApi.create({
      ...form,
      // Send nothing rather than an empty string. The backend normalises it
      // too, but a deployment where only the frontend is new must not write a
      // value that collides on the unique constraint.
      email: form.email.trim() || undefined,
    }),
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
    <PageShell
      route="/users"
      title="Users"
      meta={`${users.length} account${users.length > 1 ? 's' : ''}`}
      actions={(
        <button className="btn-primary flex items-center gap-1.5" onClick={() => { create.reset(); setCreateOpen(true) }}>
          <Plus size={13} /> New user
        </button>
      )}
    >
      <div className="max-w-4xl mx-auto">

      <Panel className="overflow-hidden">
        <DataTable
          rows={users}
          rowKey={(u) => u.id}
          empty="No user yet."
          columns={[
            {
              key: 'username',
              header: 'User',
              render: (u) => (
                <>
                  <p className="font-medium text-fg">{u.username}</p>
                  {u.email && <p className="text-label text-fg-secondary">{u.email}</p>}
                  {u.id === me?.id && <span className="text-label text-accent">(you)</span>}
                </>
              ),
            },
            {
              key: 'role',
              header: 'Role',
              width: 'w-28',
              render: (u) => (
                <span className={`text-label font-mono px-2 py-0.5 rounded-control border ${ROLE_COLORS[u.role]}`}>
                  {ROLE_LABELS[u.role]}
                </span>
              ),
            },
            {
              key: 'status',
              header: 'Status',
              width: 'w-24',
              render: (u) => (
                <button
                  onClick={() => u.id !== me?.id && toggleActive.mutate({ id: u.id, is_active: !u.is_active })}
                  disabled={u.id === me?.id}
                  className={`text-label px-2 py-0.5 rounded-control border transition-colors ${
                    u.is_active
                      ? 'bg-accent/10 text-accent border-accent/20 hover:bg-accent/20'
                      : 'bg-fg/5 text-fg-secondary border-hairline hover:bg-fg/10'
                  } disabled:cursor-default disabled:opacity-50`}
                >
                  {u.is_active ? 'Active' : 'Inactive'}
                </button>
              ),
            },
            {
              key: 'last_login',
              header: 'Last login',
              width: 'w-44',
              mono: true,
              hideBelow: 'md',
              render: (u) => (
                <span className="text-fg-secondary">{fmtDateTimeShort(u.last_login)}</span>
              ),
            },
          ]}
          trailing={{
            render: (u) => (
              <>
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
              </>
            ),
          }}
        />
      </Panel>

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
            <label className="label">Password *</label>
            <input className="input" type="password" value={form.password} onChange={e => setForm(f => ({ ...f, password: e.target.value }))} />
          </div>
          <div>
            <label className="label">Role</label>
            <select className="input" value={form.role} onChange={e => setForm(f => ({ ...f, role: e.target.value }))}>
              {ALL_ROLES
                .filter(r => mayAssignRole(me?.role, r))
                .map(r => <option key={r} value={r}>{ROLE_LABELS[r]}</option>)}
            </select>
            <p className="text-label text-fg-muted mt-1">
              {ROLE_DESCRIPTIONS[form.role as Role]}
            </p>
          </div>
          <ErrorNote error={create.error} />
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
            {ALL_ROLES
              .filter(r => mayAssignRole(me?.role, r))
              .map(r => <option key={r} value={r}>{ROLE_LABELS[r]}</option>)}
          </select>
          {editTarget && (
            <p className="text-label text-fg-muted -mt-2">
              {ROLE_DESCRIPTIONS[editTarget.role]}
            </p>
          )}
          <ErrorNote error={updateRole.error} />
          <div className="flex justify-end gap-3">
            <button className="btn-secondary" onClick={() => setEditTarget(null)}>Cancel</button>
            <button className="btn-primary" onClick={() => editTarget && updateRole.mutate({ id: editTarget.id, role: editTarget.role })} disabled={updateRole.isPending}>
              Save
            </button>
          </div>
        </div>
      </Modal>

      {/* Change password */}
      <Modal open={!!pwTarget} onClose={() => setPwTarget(null)} title={`Password - ${pwTarget?.username}`} size="sm">
        <div className="space-y-4">
          <div>
            <label className="label">New password</label>
            <input className="input" type="password" value={newPw} onChange={e => setNewPw(e.target.value)} />
          </div>
          <ErrorNote error={changePw.error} />
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
    </PageShell>
  )
}
