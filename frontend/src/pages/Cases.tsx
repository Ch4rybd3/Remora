import { useState, useMemo } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { useNavigate } from 'react-router-dom'
import { Plus, Search, FolderOpen, Building2 } from '../ui/icons'
import { casesApi } from '../api/cases'
import { templatesApi } from '../api/templates'
import { usersApi } from '../api/auth'
import { clientsApi } from '../api/clients'
import { playbooksApi } from '../api/playbooks'
import { useAuth } from '../context/AuthContext'
import type { Case, CaseSeverity, CaseStatus, CaseType } from '../types'
import { SeverityBadge, StatusBadge, TLPBadge, Tag } from '../components/ui/Badge'
import Modal from '../components/ui/Modal'
import EmptyState from '../components/ui/EmptyState'
import TagInput, { type InputTag } from '../components/ui/TagInput'
import { GitBranch } from '../ui/icons'
import { fmtDate } from '../utils/dateUtils'

const USER_BADGE = 'bg-severity-low/10 text-severity-low border-severity-low/20'

const CASE_TYPE_META: Record<CaseType, { label: string; color: string }> = {
  ir:      { label: 'IR',      color: 'bg-severity-critical/10 text-severity-critical border-severity-critical/20' },
  ctf:     { label: 'CTF',     color: 'bg-data-2/10 text-data-2 border-data-2/20' },
  pentest: { label: 'Pentest', color: 'bg-severity-high/10 text-severity-high border-severity-high/20' },
  sample:  { label: 'Sample',  color: 'bg-fg/5 text-fg-secondary border-hairline' },
}

function CaseTypeBadge({ type }: { type: CaseType }) {
  const m = CASE_TYPE_META[type] ?? CASE_TYPE_META.ir
  return (
    <span className={`text-label font-mono font-bold px-1.5 py-0.5 rounded-control border ${m.color}`}>
      {m.label}
    </span>
  )
}

function fromAssigneeTags(tags: InputTag[]): string {
  return tags.map(t => t.value).join(', ')
}

const empty = (): Partial<Case> => ({
  title: '', description: '', severity: 'medium', status: 'open',
  tags: '', tlp: 'TLP:AMBER', assigned_to: '', template_id: undefined,
  case_type: 'ir', client_id: null,
})

export default function Cases() {
  const navigate = useNavigate()
  const qc = useQueryClient()
  const { user: me } = useAuth()
  const { data: cases = [], isLoading } = useQuery({ queryKey: ['cases'], queryFn: casesApi.list })
  const { data: templates = [] } = useQuery({ queryKey: ['templates'], queryFn: templatesApi.list })
  const { data: users = [] } = useQuery({ queryKey: ['users'], queryFn: usersApi.list })
  const { data: clients = [] } = useQuery({ queryKey: ['clients'], queryFn: clientsApi.list })
  const [search, setSearch] = useState('')
  const [statusFilter, setStatusFilter] = useState<CaseStatus | 'all'>('all')
  const [typeFilter, setTypeFilter] = useState<CaseType | 'all'>('all')
  const [modalOpen, setModalOpen] = useState(false)
  const [form, setForm] = useState<Partial<Case>>(empty())
  const [assigneeTags, setAssigneeTags] = useState<InputTag[]>([])
  const [selectedPlaybooks, setSelectedPlaybooks] = useState<string[]>([])

  const { data: allPlaybooks = [] } = useQuery({
    queryKey: ['playbooks'],
    queryFn: playbooksApi.list,
    enabled: modalOpen,
  })

  const userSuggestions = useMemo(() => users.filter(u => u.is_active).map(u => ({
    value: u.username,
    label: u.username,
    sublabel: u.email ?? undefined,
    badge: u.role,
    badgeColor: USER_BADGE,
  })), [users])

  const openModal = () => {
    const defaultClient = clients.find(c => c.is_default)
    setForm({ ...empty(), client_id: defaultClient?.id ?? null })
    setAssigneeTags(me ? [{ value: me.username, badgeColor: USER_BADGE }] : [])
    setSelectedPlaybooks([])
    setModalOpen(true)
  }

  const create = useMutation({
    mutationFn: async () => {
      const c = await casesApi.create({ ...form, assigned_to: fromAssigneeTags(assigneeTags) })
      await Promise.all(selectedPlaybooks.map(pbId => playbooksApi.attachPlaybook(c.id, pbId)))
      return c
    },
    onSuccess: (c) => { qc.invalidateQueries({ queryKey: ['cases'] }); setModalOpen(false); navigate(`/cases/${c.id}`) },
  })

  const filtered = cases.filter(c => {
    const matchSearch = c.title.toLowerCase().includes(search.toLowerCase()) ||
                        c.client_name?.toLowerCase().includes(search.toLowerCase())
    const matchStatus = statusFilter === 'all' || c.status === statusFilter
    const matchType   = typeFilter   === 'all' || c.case_type === typeFilter
    return matchSearch && matchStatus && matchType
  })

  const statusTabs: (CaseStatus | 'all')[] = ['all', 'open', 'in_progress', 'closed', 'archived']
  const typeTabs: (CaseType | 'all')[] = ['all', 'ir', 'ctf', 'pentest', 'sample']

  return (
    <div className="p-6 max-w-6xl mx-auto">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-title font-bold text-accent">Cases</h1>
          <p className="text-fg-secondary text-ui mt-1">{cases.length} total</p>
        </div>
        <button className="btn-primary flex items-center gap-2" onClick={openModal}>
          <Plus size={16} /> New Case
        </button>
      </div>

      {/* Search + filters */}
      <div className="space-y-3 mb-6">
        <div className="flex items-center gap-4">
          <div className="relative flex-1 max-w-sm">
            <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-fg-secondary" />
            <input
              className="input pl-9"
              placeholder="Search cases or client…"
              value={search}
              onChange={e => setSearch(e.target.value)}
            />
          </div>
          {/* Status filter */}
          <div className="flex gap-1 border border-hairline p-1">
            {statusTabs.map(s => (
              <button
                key={s}
                onClick={() => setStatusFilter(s)}
                className={`px-3 py-1 text-label rounded-control capitalize transition-colors ${ statusFilter === s ? 'bg-accent text-canvas font-semibold' : 'text-fg-secondary hover:text-fg'
                }`}
              >
                {s.replace('_', ' ')}
              </button>
            ))}
          </div>
        </div>

        {/* Type filter */}
        <div className="flex items-center gap-2">
          <span className="text-label text-fg-secondary/40 uppercase tracking-widest">Type</span>
          <div className="flex gap-1">
            {typeTabs.map(t => (
              <button
                key={t}
                onClick={() => setTypeFilter(t)}
                className={`px-2.5 py-1 text-label rounded-control font-mono capitalize transition-colors border ${ typeFilter === t
                    ? 'bg-accent/15 text-accent border-accent/30 font-semibold'
                    : 'text-fg-secondary/50 border-transparent hover:text-fg hover:border-hairline'
                }`}
              >
                {t === 'all' ? 'Tous' : CASE_TYPE_META[t as CaseType]?.label ?? t}
              </button>
            ))}
          </div>
        </div>
      </div>

      {isLoading ? (
        <div className="text-fg-secondary text-ui text-center py-16">Loading…</div>
      ) : filtered.length === 0 ? (
        <EmptyState
          icon={FolderOpen}
          message="No cases found"
          action={cases.length === 0 ? { label: '+ Create first case', onClick: () => setModalOpen(true) } : undefined}
        />
      ) : (
        <div className="card overflow-hidden">
          <table className="w-full text-ui">
            <thead>
              <tr className="border-b border-hairline text-fg-secondary text-label uppercase tracking-wide">
                <th className="text-left px-4 py-3">Title</th>
                <th className="text-left px-4 py-3">Type</th>
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
                  className="border-b border-hairline last:border-0 hover:bg-white/[0.02] cursor-pointer"
                  onClick={() => navigate(`/cases/${c.id}`)}
                >
                  <td className="px-4 py-3">
                    <div>
                      <p className="font-medium">{c.title}</p>
                      {c.client_name && (
                        <p className="flex items-center gap-1 text-label text-fg-secondary/50 mt-0.5">
                          <Building2 size={9} />
                          {c.client_name}
                        </p>
                      )}
                      {c.tags && (
                        <div className="flex gap-1 mt-1 flex-wrap">
                          {c.tags.split(',').filter(Boolean).slice(0, 3).map(t => (
                            <Tag key={t} label={t.trim()} />
                          ))}
                        </div>
                      )}
                    </div>
                  </td>
                  <td className="px-4 py-3">
                    <CaseTypeBadge type={c.case_type ?? 'ir'} />
                  </td>
                  <td className="px-4 py-3"><SeverityBadge severity={c.severity} /></td>
                  <td className="px-4 py-3"><StatusBadge status={c.status} /></td>
                  <td className="px-4 py-3"><TLPBadge tlp={c.tlp} /></td>
                  <td className="px-4 py-3">
                    <div className="flex gap-1 flex-wrap">
                      {c.assigned_to
                        ? c.assigned_to.split(',').map(s => s.trim()).filter(Boolean).map(name => (
                            <span key={name} className={`text-label font-mono px-1.5 py-0.5 rounded-control border ${USER_BADGE}`}>{name}</span>
                          ))
                        : <span className="text-label text-fg-secondary">—</span>
                      }
                    </div>
                  </td>
                  <td className="px-4 py-3 font-mono text-label text-fg-secondary">{c.ioc_count}</td>
                  <td className="px-4 py-3 text-label text-fg-secondary">{fmtDate(c.updated_at)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* New Case modal */}
      <Modal open={modalOpen} onClose={() => setModalOpen(false)} title="New Case" size="lg">
        <div className="space-y-4">
          <div>
            <label className="label">Title *</label>
            <input className="input" placeholder="e.g. Ransomware incident — FinanceServer01" value={form.title} onChange={e => setForm(f => ({ ...f, title: e.target.value }))} />
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="label">Type</label>
              <select className="input" value={form.case_type ?? 'ir'} onChange={e => setForm(f => ({ ...f, case_type: e.target.value as CaseType }))}>
                <option value="ir">IR — Incident Response</option>
                <option value="ctf">CTF — Capture The Flag</option>
                <option value="pentest">Pentest</option>
                <option value="sample">Sample / Test</option>
              </select>
            </div>
            <div>
              <label className="label flex items-center gap-1.5"><Building2 size={11} /> Client / Organisation</label>
              <select className="input" value={form.client_id ?? ''} onChange={e => setForm(f => ({ ...f, client_id: e.target.value || null }))}>
                <option value="">-- None (default client) --</option>
                {clients.map(c => <option key={c.id} value={c.id}>{c.name}{c.is_default ? ' (default)' : ''}</option>)}
              </select>
            </div>
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

          {/* Playbook selection */}
          {allPlaybooks.length > 0 && (
            <div>
              <label className="label flex items-center gap-1.5">
                <GitBranch size={11} /> Playbooks
                <span className="normal-case font-normal text-fg-secondary/50">(optionnel)</span>
              </label>
              <div className="flex flex-wrap gap-2 mt-1">
                {allPlaybooks.map(pb => {
                  const selected = selectedPlaybooks.includes(pb.id)
                  return (
                    <button
                      key={pb.id}
                      type="button"
                      onClick={() => setSelectedPlaybooks(prev =>
                        selected ? prev.filter(id => id !== pb.id) : [...prev, pb.id]
                      )}
                      className={`flex items-center gap-1.5 px-3 py-1.5 rounded-control border text-label transition-colors ${ selected
                          ? 'bg-accent/10 text-accent border-accent/30'
                          : 'bg-fg/5 text-fg-secondary border-hairline hover:bg-fg/10 hover:text-fg'
                      }`}
                    >
                      <GitBranch size={10} />
                      {pb.name}
                    </button>
                  )
                })}
              </div>
            </div>
          )}

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
