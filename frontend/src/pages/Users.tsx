import { useState } from 'react'
import { PageShell } from '../ui/PageShell'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import {
  AlertCircle, Building2, Check, Edit2, KeyRound, Lock, Plus,
  Shield, ShieldCheck, ShieldOff, SlidersHorizontal, Tag, Trash2,
} from '../ui/icons'
import { usersApi, type AuthUser } from '../api/auth'
import { clientsApi } from '../api/clients'
import { customRolesApi, type CustomRole } from '../api/customRoles'
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

// ── Shared helpers ────────────────────────────────────────────────────────────

function errorMessage(error: unknown): string {
  const detail = (error as any)?.response?.data?.detail
  if (typeof detail === 'string') return detail
  if (Array.isArray(detail)) return detail.map((d: any) => d?.msg ?? String(d)).join('. ')
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

// ── Role chip ─────────────────────────────────────────────────────────────────

function RoleChip({ user }: { user: AuthUser }) {
  if (user.custom_role) {
    const color = user.custom_role.color ?? 'bg-fg/5 text-fg border-hairline'
    return (
      <span className={`text-label font-mono px-2 py-0.5 rounded-control border flex items-center gap-1 w-fit ${color}`}>
        <Tag size={10} />
        {user.custom_role.name}
      </span>
    )
  }
  return (
    <span className={`text-label font-mono px-2 py-0.5 rounded-control border ${ROLE_COLORS[user.role]}`}>
      {ROLE_LABELS[user.role]}
    </span>
  )
}

// ── Permission chips ──────────────────────────────────────────────────────────

function PermChips({ role }: { role: CustomRole }) {
  const perms: Array<[keyof CustomRole, string]> = [
    ['can_read_artifacts',      'Artifacts'],
    ['can_write',               'Write'],
    ['can_change_own_password', 'Change password'],
  ]
  return (
    <div className="flex flex-wrap gap-1">
      {perms.map(([key, label]) => (
        <span key={key} className={`text-label px-1.5 py-0.5 rounded border flex items-center gap-1 ${
          role[key]
            ? 'bg-accent/10 text-accent border-accent/20'
            : 'bg-fg/5 text-fg-muted border-hairline line-through opacity-50'
        }`}>
          {role[key] && <Check size={9} />}
          {label}
        </span>
      ))}
    </div>
  )
}

// ── Custom role form ──────────────────────────────────────────────────────────

const PRESET_COLORS = [
  { label: 'Purple', value: 'bg-data-1/10 text-data-1 border-data-1/20' },
  { label: 'Teal',   value: 'bg-data-2/10 text-data-2 border-data-2/20' },
  { label: 'Blue',   value: 'bg-data-3/10 text-data-3 border-data-3/20' },
  { label: 'Amber',  value: 'bg-severity-medium/10 text-severity-medium border-severity-medium/20' },
  { label: 'Green',  value: 'bg-severity-low/10 text-severity-low border-severity-low/20' },
  { label: 'Muted',  value: 'bg-fg-muted/10 text-fg-muted border-fg-muted/20' },
]

interface RoleFormState {
  name: string
  description: string
  color: string
  can_write: boolean
  can_read_artifacts: boolean
  can_change_own_password: boolean
}

const EMPTY_ROLE_FORM: RoleFormState = {
  name: '',
  description: '',
  color: PRESET_COLORS[2].value,
  can_write: false,
  can_read_artifacts: true,
  can_change_own_password: true,
}

function CustomRoleForm({
  form, setForm, error, onCancel, onSave, saving, saveLabel,
}: {
  form: RoleFormState
  setForm: React.Dispatch<React.SetStateAction<RoleFormState>>
  error: unknown
  onCancel: () => void
  onSave: () => void
  saving: boolean
  saveLabel: string
}) {
  return (
    <div className="space-y-4">
      <div>
        <label className="label">Name *</label>
        <input className="input" value={form.name} placeholder="e.g. Senior Analyst"
          onChange={e => setForm(f => ({ ...f, name: e.target.value }))} />
      </div>
      <div>
        <label className="label">Description</label>
        <input className="input" value={form.description} placeholder="Brief description"
          onChange={e => setForm(f => ({ ...f, description: e.target.value }))} />
      </div>

      <div>
        <label className="label">Colour</label>
        <div className="flex flex-wrap gap-2 mt-1">
          {PRESET_COLORS.map(c => (
            <button key={c.value} onClick={() => setForm(f => ({ ...f, color: c.value }))}
              className={`text-label px-2 py-0.5 rounded-control border ${c.value} ${
                form.color === c.value ? 'ring-2 ring-accent' : ''}`}>
              {c.label}
            </button>
          ))}
        </div>
      </div>

      <div>
        <label className="label">Permissions</label>
        <div className="mt-1 border border-hairline rounded-control divide-y divide-hairline">
          {([
            ['can_read_artifacts',      'Read artifacts',      'Explorer, evidence, IOCs, timeline, etc.'],
            ['can_write',              'Write',               'Create, edit and delete cases and their content.'],
            ['can_change_own_password', 'Change own password', 'Disable to prevent demo accounts replacing their credential.'],
          ] as const).map(([key, label, hint]) => (
            <label key={key} className="flex items-start gap-3 px-3 py-2.5 cursor-pointer hover:bg-white/[0.03]">
              <div className={`mt-0.5 w-4 h-4 rounded border flex items-center justify-center shrink-0 transition-colors ${
                form[key] ? 'bg-accent border-accent' : 'border-hairline bg-transparent'}`}>
                {form[key] && <Check size={10} className="text-white" />}
              </div>
              <input type="checkbox" className="sr-only" checked={form[key]}
                onChange={() => setForm(f => ({ ...f, [key]: !f[key] }))} />
              <div>
                <p className="text-ui text-fg">{label}</p>
                <p className="text-label text-fg-muted">{hint}</p>
              </div>
            </label>
          ))}
        </div>
      </div>

      <div className="p-3 rounded-control bg-fg/[0.03] border border-hairline">
        <p className="text-label text-fg-secondary mb-1.5">Preview</p>
        <span className={`text-label font-mono px-2 py-0.5 rounded-control border flex items-center gap-1 w-fit ${form.color}`}>
          <Tag size={10} />
          {form.name || 'Role name'}
        </span>
      </div>

      <ErrorNote error={error} />
      <div className="flex justify-end gap-3 pt-2">
        <button className="btn-secondary" onClick={onCancel}>Cancel</button>
        <button className="btn-primary" onClick={onSave} disabled={!form.name.trim() || saving}>
          {saving ? 'Saving...' : saveLabel}
        </button>
      </div>
    </div>
  )
}

// ── Users tab ─────────────────────────────────────────────────────────────────

function UsersTab() {
  const { user: me } = useAuth()
  const qc = useQueryClient()
  const { data: users = [] } = useQuery({ queryKey: ['users'], queryFn: usersApi.list })
  const { data: customRoles = [] } = useQuery({ queryKey: ['custom-roles'], queryFn: customRolesApi.list })
  const { data: clients } = useQuery({ queryKey: ['clients'], queryFn: () => clientsApi.list() })

  const [createOpen, setCreateOpen] = useState(false)
  const [editTarget, setEditTarget]   = useState<AuthUser | null>(null)
  const [pwTarget,   setPwTarget]     = useState<AuthUser | null>(null)
  const [deleteTarget, setDeleteTarget] = useState<AuthUser | null>(null)
  const [mfaTarget, setMfaTarget]     = useState<AuthUser | null>(null)
  const [scopeTarget, setScopeTarget] = useState<AuthUser | null>(null)

  const [form,      setForm]      = useState({ username: '', email: '', password: '', role: 'analyst' })
  const [newPw,     setNewPw]     = useState('')
  const [scopeIds,  setScopeIds]  = useState<string[]>([])
  const [editRole,  setEditRole]  = useState<Role>('analyst')
  const [editCustom, setEditCustom] = useState('')

  const create = useMutation({
    mutationFn: () => usersApi.create({ ...form, email: form.email.trim() || undefined }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['users'] })
      setCreateOpen(false)
      setForm({ username: '', email: '', password: '', role: 'analyst' })
    },
  })

  const updateRole = useMutation({
    mutationFn: ({ id, role, custom_role_id }: { id: string; role: string; custom_role_id: string | null }) =>
      usersApi.update(id, { role, custom_role_id }),
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

  const resetMfa = useMutation({
    mutationFn: (id: string) => usersApi.resetMfa(id),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['users'] }); setMfaTarget(null) },
  })

  const setScope = useMutation({
    mutationFn: () => usersApi.setClients(scopeTarget!.id, scopeIds),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['users'] }); setScopeTarget(null) },
  })

  const openEdit = (u: AuthUser) => {
    updateRole.reset()
    setEditRole(u.role)
    setEditCustom(u.custom_role_id ?? '')
    setEditTarget(u)
  }

  const openScope = (u: AuthUser) => {
    setScope.reset()
    setScopeIds(u.clients?.map(c => c.id) ?? [])
    setScopeTarget(u)
  }

  const selectedCustomRole = customRoles.find(r => r.id === editCustom)

  return (
    <>
      <div className="flex justify-end mb-3">
        <button className="btn-primary flex items-center gap-1.5"
          onClick={() => { create.reset(); setCreateOpen(true) }}>
          <Plus size={13} /> New user
        </button>
      </div>

      <Panel className="overflow-hidden">
        <DataTable
          rows={users} rowKey={(u) => u.id} empty="No user yet."
          columns={[
            {
              key: 'username', header: 'User',
              render: (u) => (
                <>
                  <p className="font-medium text-fg flex items-center gap-1.5">
                    {u.username}
                    {u.mfa_enabled && <span title="MFA enabled"><ShieldCheck size={11} className="text-accent" /></span>}
                  </p>
                  {u.email && <p className="text-label text-fg-secondary">{u.email}</p>}
                  {u.id === me?.id && <span className="text-label text-accent">(you)</span>}
                </>
              ),
            },
            {
              key: 'role', header: 'Role', width: 'w-36',
              render: (u) => <RoleChip user={u} />,
            },
            {
              key: 'status', header: 'Status', width: 'w-24',
              render: (u) => (
                <button
                  onClick={() => u.id !== me?.id && toggleActive.mutate({ id: u.id, is_active: !u.is_active })}
                  disabled={u.id === me?.id}
                  className={`text-label px-2 py-0.5 rounded-control border transition-colors ${
                    u.is_active
                      ? 'bg-accent/10 text-accent border-accent/20 hover:bg-accent/20'
                      : 'bg-fg/5 text-fg-secondary border-hairline hover:bg-fg/10'
                  } disabled:cursor-default disabled:opacity-50`}>
                  {u.is_active ? 'Active' : 'Inactive'}
                </button>
              ),
            },
            {
              key: 'clients', header: 'Client access', width: 'w-48', hideBelow: 'lg',
              render: (u) => (
                u.clients?.length
                  ? <span className="text-label text-fg-secondary truncate block"
                      title={u.clients.map(c => c.name).join(', ')}>
                      {u.clients.map(c => c.name).join(', ')}
                    </span>
                  : <span className="text-label text-fg-muted">All clients</span>
              ),
            },
            {
              key: 'last_login', header: 'Last login', width: 'w-44', mono: true, hideBelow: 'md',
              render: (u) => <span className="text-fg-secondary">{fmtDateTimeShort(u.last_login)}</span>,
            },
          ]}
          trailing={{
            render: (u) => (
              <>
                {canManage(me, u) && (
                  <button onClick={() => openEdit(u)}
                    className="text-fg-secondary hover:text-accent transition-colors" title="Change role">
                    <Edit2 size={13} />
                  </button>
                )}
                {canManage(me, u) && (
                  <button onClick={() => openScope(u)}
                    className="text-fg-secondary hover:text-accent transition-colors" title="Client access">
                    <Building2 size={13} />
                  </button>
                )}
                {(u.id === me?.id || canManage(me, u)) && (
                  <button onClick={() => setPwTarget(u)}
                    className="text-fg-secondary hover:text-severity-medium transition-colors" title="Reset password">
                    <KeyRound size={13} />
                  </button>
                )}
                {u.id !== me?.id && canManage(me, u) && u.mfa_enabled && (
                  <button onClick={() => setMfaTarget(u)}
                    className="text-fg-secondary hover:text-severity-medium transition-colors" title="Reset MFA">
                    <ShieldOff size={13} />
                  </button>
                )}
                {u.id !== me?.id && canManage(me, u) && (
                  <button onClick={() => setDeleteTarget(u)}
                    className="text-fg-secondary hover:text-severity-critical transition-colors" title="Delete">
                    <Trash2 size={13} />
                  </button>
                )}
              </>
            ),
          }}
        />
      </Panel>

      {/* Create user */}
      <Modal open={createOpen} onClose={() => setCreateOpen(false)} title="New user" size="sm">
        <div className="space-y-4">
          <div><label className="label">Username *</label>
            <input className="input" value={form.username}
              onChange={e => setForm(f => ({ ...f, username: e.target.value }))} /></div>
          <div><label className="label">Email</label>
            <input className="input" type="email" value={form.email}
              onChange={e => setForm(f => ({ ...f, email: e.target.value }))} /></div>
          <div><label className="label">Password *</label>
            <input className="input" type="password" value={form.password}
              onChange={e => setForm(f => ({ ...f, password: e.target.value }))} /></div>
          <div>
            <label className="label">Role</label>
            <select className="input" value={form.role} onChange={e => setForm(f => ({ ...f, role: e.target.value }))}>
              {ALL_ROLES.filter(r => mayAssignRole(me?.role, r)).map(r => (
                <option key={r} value={r}>{ROLE_LABELS[r]}</option>
              ))}
            </select>
            <p className="text-label text-fg-muted mt-1">{ROLE_DESCRIPTIONS[form.role as Role]}</p>
          </div>
          <ErrorNote error={create.error} />
          <div className="flex justify-end gap-3 pt-2">
            <button className="btn-secondary" onClick={() => setCreateOpen(false)}>Cancel</button>
            <button className="btn-primary" onClick={() => create.mutate()}
              disabled={!form.username || !form.password || create.isPending}>
              {create.isPending ? 'Creating...' : 'Create'}
            </button>
          </div>
        </div>
      </Modal>

      {/* Edit role */}
      <Modal open={!!editTarget} onClose={() => setEditTarget(null)}
        title={`Role — ${editTarget?.username}`} size="sm">
        <div className="space-y-4">
          <div>
            <label className="label">Custom role</label>
            <select className="input" value={editCustom}
              onChange={e => setEditCustom(e.target.value)}>
              <option value="">— Use standard role —</option>
              {customRoles.map(cr => (
                <option key={cr.id} value={cr.id}>{cr.name}</option>
              ))}
            </select>
            {selectedCustomRole && (
              <div className="mt-2 space-y-1">
                <PermChips role={selectedCustomRole} />
                {selectedCustomRole.description && (
                  <p className="text-label text-fg-muted">{selectedCustomRole.description}</p>
                )}
                {!selectedCustomRole.can_change_own_password && (
                  <p className="flex items-center gap-1 text-label text-severity-medium">
                    <Lock size={10} /> This account will not be able to change its own password.
                  </p>
                )}
              </div>
            )}
          </div>

          {!editCustom && (
            <div>
              <label className="label">Standard role</label>
              <select className="input" value={editRole} onChange={e => setEditRole(e.target.value as Role)}>
                {ALL_ROLES.filter(r => mayAssignRole(me?.role, r)).map(r => (
                  <option key={r} value={r}>{ROLE_LABELS[r]}</option>
                ))}
              </select>
              <p className="text-label text-fg-muted mt-1">{ROLE_DESCRIPTIONS[editRole]}</p>
            </div>
          )}

          <ErrorNote error={updateRole.error} />
          <div className="flex justify-end gap-3">
            <button className="btn-secondary" onClick={() => setEditTarget(null)}>Cancel</button>
            <button className="btn-primary" disabled={updateRole.isPending}
              onClick={() => editTarget && updateRole.mutate({
                id: editTarget.id,
                role: editRole,
                custom_role_id: editCustom || null,
              })}>
              {updateRole.isPending ? 'Saving...' : 'Save'}
            </button>
          </div>
        </div>
      </Modal>

      {/* Client scope */}
      <Modal open={!!scopeTarget} onClose={() => setScopeTarget(null)}
        title={`Client access — ${scopeTarget?.username}`} size="sm">
        <div className="space-y-4">
          <p className="text-label text-fg-secondary">
            Restrict this account to specific clients. <strong>Selecting none means unrestricted.</strong>
          </p>
          <div className="max-h-60 overflow-y-auto border border-hairline rounded-control divide-y divide-hairline">
            {(clients ?? []).map(c => (
              <label key={c.id} className="flex items-center gap-2 px-3 py-1.5 cursor-pointer hover:bg-white/[0.03]">
                <input type="checkbox" checked={scopeIds.includes(c.id)}
                  onChange={e => setScopeIds(ids =>
                    e.target.checked ? [...ids, c.id] : ids.filter(i => i !== c.id))} />
                <span className="text-ui text-fg">{c.name}</span>
              </label>
            ))}
          </div>
          <p className="text-label text-fg-muted">
            {scopeIds.length === 0 ? 'Unrestricted — sees every case.' : `Restricted to ${scopeIds.length} client${scopeIds.length > 1 ? 's' : ''}.`}
          </p>
          <ErrorNote error={setScope.error} />
          <div className="flex justify-end gap-3">
            <button className="btn-secondary" onClick={() => setScopeTarget(null)}>Cancel</button>
            <button className="btn-primary" disabled={setScope.isPending} onClick={() => setScope.mutate()}>
              {setScope.isPending ? 'Saving...' : 'Save'}
            </button>
          </div>
        </div>
      </Modal>

      {/* Change password */}
      <Modal open={!!pwTarget} onClose={() => setPwTarget(null)}
        title={`Password — ${pwTarget?.username}`} size="sm">
        <div className="space-y-4">
          <div><label className="label">New password</label>
            <input className="input" type="password" value={newPw}
              onChange={e => setNewPw(e.target.value)} /></div>
          <ErrorNote error={changePw.error} />
          <div className="flex justify-end gap-3">
            <button className="btn-secondary" onClick={() => setPwTarget(null)}>Cancel</button>
            <button className="btn-primary" onClick={() => changePw.mutate()} disabled={!newPw || changePw.isPending}>
              {changePw.isPending ? 'Saving...' : 'Change'}
            </button>
          </div>
        </div>
      </Modal>

      <ConfirmDialog open={!!deleteTarget} onClose={() => setDeleteTarget(null)}
        onConfirm={() => deleteTarget && remove.mutate(deleteTarget.id)}
        title="Delete the user"
        message={`The account "${deleteTarget?.username}" will be permanently deleted.`} />

      <ConfirmDialog open={!!mfaTarget} onClose={() => setMfaTarget(null)}
        onConfirm={() => mfaTarget && resetMfa.mutate(mfaTarget.id)}
        title="Reset MFA"
        message={`This will disable MFA for "${mfaTarget?.username}". They will need to re-enrol.`} />
    </>
  )
}

// ── Custom roles tab ──────────────────────────────────────────────────────────

function CustomRolesTab() {
  const qc = useQueryClient()
  const { data: roles = [] } = useQuery({ queryKey: ['custom-roles'], queryFn: customRolesApi.list })

  const [createOpen,   setCreateOpen]   = useState(false)
  const [editTarget,   setEditTarget]   = useState<CustomRole | null>(null)
  const [deleteTarget, setDeleteTarget] = useState<CustomRole | null>(null)
  const [form, setForm] = useState<RoleFormState>(EMPTY_ROLE_FORM)

  const create = useMutation({
    mutationFn: () => customRolesApi.create({
      name: form.name.trim(),
      description: form.description || undefined,
      color: form.color,
      can_write: form.can_write,
      can_read_artifacts: form.can_read_artifacts,
      can_change_own_password: form.can_change_own_password,
    }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['custom-roles'] })
      setCreateOpen(false)
      setForm(EMPTY_ROLE_FORM)
    },
  })

  const update = useMutation({
    mutationFn: () => customRolesApi.update(editTarget!.id, {
      name: form.name.trim(),
      description: form.description || undefined,
      color: form.color,
      can_write: form.can_write,
      can_read_artifacts: form.can_read_artifacts,
      can_change_own_password: form.can_change_own_password,
    }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['custom-roles'] })
      qc.invalidateQueries({ queryKey: ['users'] })
      setEditTarget(null)
    },
  })

  const remove = useMutation({
    mutationFn: (id: string) => customRolesApi.delete(id),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['custom-roles'] })
      qc.invalidateQueries({ queryKey: ['users'] })
    },
  })

  const openEdit = (r: CustomRole) => {
    update.reset()
    setForm({
      name: r.name, description: r.description ?? '',
      color: r.color ?? PRESET_COLORS[2].value,
      can_write: r.can_write, can_read_artifacts: r.can_read_artifacts,
      can_change_own_password: r.can_change_own_password,
    })
    setEditTarget(r)
  }

  return (
    <>
      <div className="flex justify-end mb-3">
        <button className="btn-primary flex items-center gap-1.5"
          onClick={() => { create.reset(); setForm(EMPTY_ROLE_FORM); setCreateOpen(true) }}>
          <Plus size={13} /> New custom role
        </button>
      </div>

      <Panel className="overflow-hidden">
        {roles.length === 0 ? (
          <div className="py-8 text-center text-fg-muted text-ui">
            No custom roles yet. Create one to define a permission profile you can assign to users.
          </div>
        ) : (
          <DataTable
            rows={roles} rowKey={(r) => r.id} empty="No custom roles yet."
            columns={[
              {
                key: 'name', header: 'Role',
                render: (r) => (
                  <>
                    <span className={`text-label font-mono px-2 py-0.5 rounded-control border flex items-center gap-1 w-fit ${r.color ?? 'bg-fg/5 text-fg border-hairline'}`}>
                      <Tag size={10} />
                      {r.name}
                    </span>
                    {r.description && (
                      <p className="text-label text-fg-muted mt-0.5">{r.description}</p>
                    )}
                  </>
                ),
              },
              {
                key: 'permissions', header: 'Permissions',
                render: (r) => <PermChips role={r} />,
              },
            ]}
            trailing={{
              render: (r) => (
                <>
                  <button onClick={() => openEdit(r)}
                    className="text-fg-secondary hover:text-accent transition-colors" title="Edit">
                    <Edit2 size={13} />
                  </button>
                  <button onClick={() => setDeleteTarget(r)}
                    className="text-fg-secondary hover:text-severity-critical transition-colors" title="Delete">
                    <Trash2 size={13} />
                  </button>
                </>
              ),
            }}
          />
        )}
      </Panel>

      <Modal open={createOpen} onClose={() => setCreateOpen(false)} title="New custom role" size="sm">
        <CustomRoleForm form={form} setForm={setForm} error={create.error}
          onCancel={() => setCreateOpen(false)} onSave={() => create.mutate()}
          saving={create.isPending} saveLabel="Create" />
      </Modal>

      <Modal open={!!editTarget} onClose={() => setEditTarget(null)}
        title={`Edit — ${editTarget?.name}`} size="sm">
        <CustomRoleForm form={form} setForm={setForm} error={update.error}
          onCancel={() => setEditTarget(null)} onSave={() => update.mutate()}
          saving={update.isPending} saveLabel="Save" />
      </Modal>

      <ConfirmDialog open={!!deleteTarget} onClose={() => setDeleteTarget(null)}
        onConfirm={() => deleteTarget && remove.mutate(deleteTarget.id)}
        title="Delete custom role"
        message={`"${deleteTarget?.name}" will be removed. Users assigned to it revert to their standard role.`} />
    </>
  )
}

// ── Page ──────────────────────────────────────────────────────────────────────

type Tab = 'users' | 'roles'

export default function Users() {
  const { user: me } = useAuth()
  const isAdmin = me?.role === 'owner' || me?.role === 'admin'
  const [tab, setTab] = useState<Tab>('users')

  return (
    <PageShell route="/users" title="Users">
      <div className="max-w-4xl mx-auto space-y-4">

        {isAdmin && (
          <div className="flex gap-1 border-b border-hairline">
            {([
              ['users', 'Users',        Shield          ] as const,
              ['roles', 'Custom roles', SlidersHorizontal] as const,
            ]).map(([key, label, Icon]) => (
              <button key={key} onClick={() => setTab(key)}
                className={`flex items-center gap-1.5 px-3 py-2 text-ui border-b-2 -mb-px transition-colors ${
                  tab === key ? 'border-accent text-fg' : 'border-transparent text-fg-secondary hover:text-fg'}`}>
                <Icon size={13} />{label}
              </button>
            ))}
          </div>
        )}

        {tab === 'users' && <UsersTab />}
        {tab === 'roles' && <CustomRolesTab />}
      </div>
    </PageShell>
  )
}
