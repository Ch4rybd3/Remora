import { useState, useMemo } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { useNavigate } from 'react-router-dom'
import { Plus, Search, FolderOpen } from 'lucide-react'
import { casesApi } from '../api/cases'
import { templatesApi } from '../api/templates'
import { usersApi } from '../api/auth'
import { useAuth } from '../context/AuthContext'
import type { Case, CaseSeverity, CaseStatus } from '../types'
import { SeverityBadge, StatusBadge, TLPBadge, Tag } from '../components/ui/Badge'
import Modal from '../components/ui/Modal'
import EmptyState from '../components/ui/EmptyState'
import TagInput, { type InputTag } from '../components/ui/TagInput'
import { format } from 'date-fns'

const USER_BADGE = 'bg-blue-500/10 text-blue-400 border-blue-500/20'

function toAssigneeTags(str: string): InputTag[] {
  return str.split(',').map(s => s.trim()).filter(Boolean).map(v => ({ value: v, badgeColor: USER_BADGE }))
}

function fromAssigneeTags(tags: InputTag[]): string {
  return tags.map(t => t.value).join(', ')
}

const empty = (): Partial<Case> => ({
  title: '', description: '', severity: 'medium', status: 'open',
  tags: '', tlp: 'TLP:AMBER', assigned_to: '', template_id: undefined,
})

export default function Cases() {
  const navigate = useNavigate()
  const qc = useQueryClient()
  const { user: me } = useAuth()
  const { data: cases = [], isLoading } = useQuery({ queryKey: ['cases'], queryFn: casesApi.list })
  const { data: templates = [] } = useQuery({ queryKey: ['templates'], queryFn: templatesApi.list })
  const { data: users = [] } = useQuery({ queryKey: ['users'], queryFn: usersApi.list })
  const [search, setSearch] = useState('')
  const [statusFilter, setStatusFilter] = useState<CaseStatus | 'all'>('all')
  const [modalOpen, setModalOpen] = useState(false)
  const [form, setForm] = useState<Partial<Case>>(empty())
  const [assigneeTags, setAssigneeTags] = useState<InputTag[]>([])

  const userSuggestions = useMemo(() => users.filter(u => u.is_active).map(u => ({
    value: u.username,
    label: u.username,
    sublabel: u.email ?? undefined,
    badge: u.role,
    badgeColor: USER_BADGE,
  })), [users])

  const openModal = () => {
    setForm(empty())
    setAssigneeTags(me ? [{ value: me.username, badgeColor: USER_BADGE }] : [])
    setModalOpen(true)
  }

  const create = useMutation({
    mutationFn: () => casesApi.create({ ...form, assigned_to: fromAssigneeTags(assigneeTags) }),
    onSuccess: (c) => { qc.invalidateQueries({ queryKey: ['cases'] }); setModalOpen(false); navigate(`/cases/${c.id}`) },
  })

  const filtered = cases.filter(c => {
    const matchSearch = c.title.toLowerCase().includes(search.toLowerCase())
    const matchStatus = statusFilter === 'all' || c.status === statusFilter
    return matchSearch && matchStatus
  })

  const statusTabs: (CaseStatus | 'all')[] = ['all', 'open', 'in_progress', 'closed', 'archived']

  return (
    <div className="p-6 max-w-6xl mx-auto">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold text-accent-green">Cases</h1>
          <p className="text-accent-muted text-sm mt-1">{cases.length} total</p>
        </div>
        <button className="btn-primary flex items-center gap-2" onClick={openModal}>
          <Plus size={16} /> New Case
        </button>
      </div>

      <div className="flex items-center gap-4 mb-6">
        <div className="relative flex-1 max-w-sm">
          <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-accent-muted" />
          <input
            className="input pl-9"
            placeholder="Search cases…"
            value={search}
            onChange={e => setSearch(e.target.value)}
          />
        </div>
        <div className="flex gap-1 border border-white/10 rounded-lg p-1">
          {statusTabs.map(s => (
            <button
              key={s}
              onClick={() => setStatusFilter(s)}
              className={`px-3 py-1 text-xs rounded-md capitalize transition-colors ${
                statusFilter === s ? 'bg-accent-green text-bg-primary font-semibold' : 'text-accent-muted hover:text-white'
              }`}
            >
              {s.replace('_', ' ')}
            </button>
          ))}
        </div>
      </div>

      {isLoading ? (
        <div className="text-accent-muted text-sm text-center py-16">Loading…</div>
      ) : filtered.length === 0 ? (
        <EmptyState
          icon={FolderOpen}
          message="No cases found"
          action={cases.length === 0 ? { label: '+ Create first case', onClick: () => setModalOpen(true) } : undefined}
        />
      ) : (
        <div className="card overflow-hidden">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-white/5 text-accent-muted text-xs uppercase tracking-wide">
                <th className="text-left px-4 py-3">Title</th>
                <th className="text-left px-4 py-3">Severity</th>
                <th className="text-left px-4 py-3">Status</th>
                <th className="text-left px-4 py-3">TLP</th>
                <th className="text-left px-4 py-3">Assigned</th>
                <th className="text-left px-4 py-3">IOCs</th>
                <th className="text-left px-4 py-3">Updated</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map(c => (
                <tr
                  key={c.id}
                  className="border-b border-white/5 last:border-0 hover:bg-white/[0.02] cursor-pointer"
                  onClick={() => navigate(`/cases/${c.id}`)}
                >
                  <td className="px-4 py-3">
                    <div>
                      <p className="font-medium">{c.title}</p>
                      {c.tags && (
                        <div className="flex gap-1 mt-1 flex-wrap">
                          {c.tags.split(',').filter(Boolean).slice(0, 3).map(t => (
                            <Tag key={t} label={t.trim()} />
                          ))}
                        </div>
                      )}
                    </div>
                  </td>
                  <td className="px-4 py-3"><SeverityBadge severity={c.severity} /></td>
                  <td className="px-4 py-3"><StatusBadge status={c.status} /></td>
                  <td className="px-4 py-3"><TLPBadge tlp={c.tlp} /></td>
                  <td className="px-4 py-3">
                    <div className="flex gap-1 flex-wrap">
                      {c.assigned_to
                        ? c.assigned_to.split(',').map(s => s.trim()).filter(Boolean).map(name => (
                            <span key={name} className={`text-[10px] font-mono px-1.5 py-0.5 rounded border ${USER_BADGE}`}>{name}</span>
                          ))
                        : <span className="text-xs text-accent-muted">—</span>
                      }
                    </div>
                  </td>
                  <td className="px-4 py-3 font-mono text-xs text-accent-muted">{c.ioc_count}</td>
                  <td className="px-4 py-3 text-xs text-accent-muted">
                    {format(new Date(c.updated_at), 'dd MMM yyyy')}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <Modal open={modalOpen} onClose={() => { setModalOpen(false) }} title="New Case" size="lg">
        <div className="space-y-4">
          <div>
            <label className="label">Title *</label>
            <input className="input" placeholder="e.g. Ransomware incident — FinanceServer01" value={form.title} onChange={e => setForm(f => ({ ...f, title: e.target.value }))} />
          </div>
          <div className="grid grid-cols-3 gap-4">
            <div>
              <label className="label">Severity</label>
              <select className="input" value={form.severity} onChange={e => setForm(f => ({ ...f, severity: e.target.value as CaseSeverity }))}>
                {['informational', 'low', 'medium', 'high', 'critical'].map(s => (
                  <option key={s} value={s}>{s}</option>
                ))}
              </select>
            </div>
            <div>
              <label className="label">TLP</label>
              <select className="input" value={form.tlp} onChange={e => setForm(f => ({ ...f, tlp: e.target.value }))}>
                {['TLP:RED', 'TLP:AMBER', 'TLP:GREEN', 'TLP:CLEAR'].map(t => <option key={t}>{t}</option>)}
              </select>
            </div>
            <div>
              <label className="label">Template</label>
              <select
                className="input"
                value={form.template_id ?? ''}
                onChange={e => {
                  const id = e.target.value || undefined
                  const tpl = templates.find(t => t.id === id)
                  setForm(f => ({
                    ...f,
                    template_id: id,
                    severity: tpl?.severity ?? f.severity,
                    tlp: tpl?.tlp ?? f.tlp,
                    tags: tpl?.tags?.join(', ') ?? f.tags,
                    executive_summary: tpl?.executive_summary_template ?? f.executive_summary,
                  }))
                }}
              >
                <option value="">None</option>
                {templates.map(t => <option key={t.id} value={t.id}>{t.name}</option>)}
              </select>
            </div>
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="label">Assigned To</label>
              <TagInput
                tags={assigneeTags}
                onChange={setAssigneeTags}
                suggestions={userSuggestions}
                placeholder="Assign users…"
              />
            </div>
            <div>
              <label className="label">Tags</label>
              <input className="input" placeholder="ransomware, finance, ..." value={form.tags} onChange={e => setForm(f => ({ ...f, tags: e.target.value }))} />
            </div>
          </div>
          <div>
            <label className="label">Description</label>
            <textarea className="input resize-none h-24" placeholder="Brief description of the incident…" value={form.description} onChange={e => setForm(f => ({ ...f, description: e.target.value }))} />
          </div>
          <div className="flex justify-end gap-3 pt-2">
            <button className="btn-secondary" onClick={() => setModalOpen(false)}>Cancel</button>
            <button className="btn-primary" onClick={() => create.mutate()} disabled={!form.title || create.isPending}>
              {create.isPending ? 'Creating…' : 'Create Case'}
            </button>
          </div>
        </div>
      </Modal>
    </div>
  )
}
