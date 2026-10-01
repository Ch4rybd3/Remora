import { useState, useMemo } from 'react'
import type { ReactNode } from 'react'
import { PageShell } from '../ui/PageShell'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { useNavigate } from 'react-router-dom'
import {
  Plus, Search, FolderOpen, Building2,
  Check, ChevronDown, Loader2, Tag as TagIcon, Users, X,
} from '../ui/icons'
import { casesApi, type BulkCaseResult, type BulkCaseUpdate } from '../api/cases'
import { templatesApi } from '../api/templates'
import { usersApi } from '../api/auth'
import { clientsApi } from '../api/clients'
import { playbooksApi } from '../api/playbooks'
import { useAuth } from '../context/AuthContext'
import type { Case, CaseSeverity, CaseStatus, CaseType } from '../types'
import { SeverityBadge, StatusBadge, TLPBadge, Tag } from '../components/ui/Badge'
import { DataTable } from '../ui/DataTable'
import { Panel } from '../ui/Panel'
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

// ── Bulk action bar ───────────────────────────────────────────────────────────

const STATUS_CHOICES: CaseStatus[] = ['open', 'in_progress', 'closed', 'archived']
const SEVERITY_CHOICES: CaseSeverity[] = ['informational', 'low', 'medium', 'high', 'critical']

/** A dropdown that applies the moment a value is chosen. */
function BulkMenu({ icon, label, options, onPick, busy }: {
  icon: ReactNode
  label: string
  options: { value: string; label: string }[]
  onPick: (value: string) => void
  busy: boolean
}) {
  const [open, setOpen] = useState(false)

  return (
    <div className="relative">
      <button
        disabled={busy}
        onClick={() => setOpen(o => !o)}
        className="flex items-center gap-1.5 px-2.5 py-1.5 text-label rounded-control border border-hairline text-fg-secondary hover:text-fg hover:border-strong disabled:opacity-40 transition-colors"
      >
        {icon} {label} <ChevronDown size={10} />
      </button>
      {open && (
        <>
          {/* Clicking anywhere else closes it, including the bar behind. */}
          <div className="fixed inset-0 z-30" onClick={() => setOpen(false)} />
          <div className="absolute bottom-full mb-1 left-0 z-40 min-w-40 bg-panel border border-hairline rounded-control shadow-lg py-1">
            {options.map(option => (
              <button
                key={option.value}
                onClick={() => { setOpen(false); onPick(option.value) }}
                className="w-full text-left px-3 py-1.5 text-label text-fg-secondary hover:bg-hover hover:text-fg capitalize transition-colors"
              >
                {option.label}
              </button>
            ))}
          </div>
        </>
      )}
    </div>
  )
}

/**
 * What to do with the cases that are selected.
 *
 * Fixed to the bottom of the viewport rather than docked above the table: a
 * selection is usually made by scrolling, and a bar at the top of a long list is
 * off-screen by the time it is wanted.
 *
 * Every control applies immediately. Status and severity are reversible in the
 * same two clicks that set them, so a confirmation step would cost more than the
 * mistake does. There is deliberately no delete here.
 */
function BulkBar({ count, busy, assignees, onStatus, onSeverity, onAssign, onTags, onClear }: {
  count: number
  busy: boolean
  assignees: string[]
  onStatus:   (status: CaseStatus) => void
  onSeverity: (severity: CaseSeverity) => void
  onAssign:   (username: string) => void
  onTags:     (add: string[], remove: string[]) => void
  onClear:    () => void
}) {
  const [tagDraft, setTagDraft] = useState('')
  const [tagsOpen, setTagsOpen] = useState(false)

  const submitTags = (remove: boolean) => {
    const tags = tagDraft.split(',').map(t => t.trim()).filter(Boolean)
    if (tags.length === 0) return
    onTags(remove ? [] : tags, remove ? tags : [])
    setTagDraft('')
    setTagsOpen(false)
  }

  return (
    <div className="fixed bottom-6 left-1/2 -translate-x-1/2 z-40 flex items-center gap-3 px-4 py-2.5 bg-panel border border-strong rounded-control shadow-xl">
      <span className="text-ui text-fg font-medium whitespace-nowrap">
        {count} selected
      </span>
      <span className="w-px h-5 bg-hairline" />

      <BulkMenu
        busy={busy}
        icon={<Check size={11} />}
        label="Status"
        options={STATUS_CHOICES.map(s => ({ value: s, label: s.replace('_', ' ') }))}
        onPick={(value) => onStatus(value as CaseStatus)}
      />
      <BulkMenu
        busy={busy}
        icon={<ChevronDown size={11} />}
        label="Severity"
        options={SEVERITY_CHOICES.map(s => ({ value: s, label: s }))}
        onPick={(value) => onSeverity(value as CaseSeverity)}
      />
      <BulkMenu
        busy={busy}
        icon={<Users size={11} />}
        label="Assign"
        options={assignees.map(name => ({ value: name, label: name }))}
        onPick={onAssign}
      />

      <div className="relative">
        <button
          disabled={busy}
          onClick={() => setTagsOpen(o => !o)}
          className="flex items-center gap-1.5 px-2.5 py-1.5 text-label rounded-control border border-hairline text-fg-secondary hover:text-fg hover:border-strong disabled:opacity-40 transition-colors"
        >
          <TagIcon size={11} /> Tags <ChevronDown size={10} />
        </button>
        {tagsOpen && (
          <>
            <div className="fixed inset-0 z-30" onClick={() => setTagsOpen(false)} />
            <div className="absolute bottom-full mb-1 right-0 z-40 w-64 bg-panel border border-hairline rounded-control shadow-lg p-3 space-y-2">
              <input
                autoFocus
                className="input text-label"
                placeholder="phishing, qakbot"
                value={tagDraft}
                onChange={e => setTagDraft(e.target.value)}
                onKeyDown={e => { if (e.key === 'Enter') submitTags(false) }}
              />
              <div className="flex gap-2">
                <button onClick={() => submitTags(false)}
                  className="flex-1 text-label py-1.5 rounded-control border border-accent/30 text-accent bg-accent/5 hover:bg-accent/10 transition-colors">
                  Add to {count}
                </button>
                <button onClick={() => submitTags(true)}
                  className="flex-1 text-label py-1.5 rounded-control border border-hairline text-fg-secondary hover:text-fg hover:border-strong transition-colors">
                  Remove
                </button>
              </div>
              <p className="text-label text-fg-muted">
                Tags are added or removed, never replaced — each case keeps its own.
              </p>
            </div>
          </>
        )}
      </div>

      <span className="w-px h-5 bg-hairline" />
      {busy
        ? <Loader2 size={13} className="animate-spin text-accent" />
        : (
          <button onClick={onClear} title="Clear selection"
            className="p-1 rounded-control text-fg-secondary/50 hover:text-fg transition-colors">
            <X size={13} />
          </button>
        )}
    </div>
  )
}


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
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [bulkResult, setBulkResult] = useState<BulkCaseResult | null>(null)

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

  const bulk = useMutation({
    // The caller says what to change; the ids come from the selection, so no
    // control has to remember to pass them.
    mutationFn: (change: Omit<BulkCaseUpdate, 'case_ids'>) =>
      casesApi.bulkUpdate({ ...change, case_ids: [...selected] }),
    onSuccess: (result) => {
      setBulkResult(result)
      // The action is done, so the selection has served its purpose. Keeping it
      // invites a second accidental apply on the same rows.
      setSelected(new Set())
      qc.invalidateQueries({ queryKey: ['cases'] })
    },
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
    <PageShell
      route="/cases"
      title="Cases"
      meta={`${cases.length} total`}
      actions={(
        <button className="btn-primary flex items-center gap-1.5" onClick={openModal}>
          <Plus size={13} /> New Case
        </button>
      )}
    >
      <div className="max-w-6xl mx-auto">

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
                {t === 'all' ? 'All' : CASE_TYPE_META[t as CaseType]?.label ?? t}
              </button>
            ))}
          </div>
        </div>
      </div>

      {bulkResult && (
        <div className="flex items-center gap-2 mb-3 px-3 py-2 border border-accent/20 bg-accent/5 rounded-control">
          <Check size={12} className="text-accent shrink-0" />
          <p className="text-label text-fg-secondary flex-1">
            {bulkResult.updated.length} case{bulkResult.updated.length === 1 ? '' : 's'} updated
            {bulkResult.fields.length > 0 && ` — ${bulkResult.fields.join(', ')}`}
            {/* Reported rather than dropped: a case can be missing because
                another analyst deleted it, or because this account cannot see
                its client. Either way the analyst asked for it. */}
            {bulkResult.skipped.length > 0 &&
              `. ${bulkResult.skipped.length} not found or out of reach.`}
          </p>
          <button onClick={() => setBulkResult(null)}
            className="p-0.5 rounded-control text-fg-secondary/40 hover:text-fg transition-colors">
            <X size={11} />
          </button>
        </div>
      )}

      {isLoading ? (
        <div className="text-fg-secondary text-ui text-center py-16">Loading…</div>
      ) : filtered.length === 0 ? (
        <EmptyState
          icon={FolderOpen}
          message="No cases found"
          action={cases.length === 0 ? { label: '+ Create first case', onClick: () => setModalOpen(true) } : undefined}
        />
      ) : (
        <Panel className="overflow-hidden">
          <DataTable
            rows={filtered}
            rowKey={(c) => c.id}
            selection={{
              selected,
              onChange: setSelected,
              label: 'Select all cases shown',
            }}
            onRowClick={(c) => navigate(`/cases/${c.id}`)}
            empty="No case matches these filters."
            columns={[
              {
                key: 'title',
                header: 'Title',
                render: (c) => (
                  <>
                    <p className="font-medium text-fg">{c.title}</p>
                    {c.client_name && (
                      <p className="flex items-center gap-1 text-label text-fg-muted mt-0.5">
                        <Building2 size={9} />
                        {c.client_name}
                      </p>
                    )}
                    {c.tags && (
                      <div className="flex gap-1 mt-1 flex-wrap">
                        {c.tags.split(',').filter(Boolean).slice(0, 3).map((tag) => (
                          <Tag key={tag} label={tag.trim()} />
                        ))}
                      </div>
                    )}
                  </>
                ),
              },
              { key: 'type',     header: 'Type',     width: 'w-24', hideBelow: 'lg', render: (c) => <CaseTypeBadge type={c.case_type ?? 'ir'} /> },
              { key: 'severity', header: 'Severity', width: 'w-28', render: (c) => <SeverityBadge severity={c.severity} /> },
              { key: 'status',   header: 'Status',   width: 'w-32', render: (c) => <StatusBadge status={c.status} /> },
              { key: 'tlp',      header: 'TLP',      width: 'w-28', hideBelow: 'lg', render: (c) => <TLPBadge tlp={c.tlp} /> },
              {
                key: 'assigned',
                header: 'Assigned',
                width: 'w-40',
                hideBelow: 'md',
                render: (c) => (
                  <div className="flex gap-1 flex-wrap">
                    {c.assigned_to
                      ? c.assigned_to.split(',').map((s) => s.trim()).filter(Boolean).map((name) => (
                          <span key={name} className={`text-label font-mono px-1.5 py-0.5 rounded-control border ${USER_BADGE}`}>
                            {name}
                          </span>
                        ))
                      : <span className="text-label text-fg-muted">—</span>}
                  </div>
                ),
              },
              { key: 'iocs',    header: 'IOCs',    width: 'w-16', align: 'right', mono: true, hideBelow: 'md', render: (c) => <span className="text-fg-secondary">{c.ioc_count}</span> },
              { key: 'updated', header: 'Updated', width: 'w-32', mono: true, render: (c) => <span className="text-fg-secondary">{fmtDate(c.updated_at)}</span> },
            ]}
          />
        </Panel>
      )}

      {selected.size > 0 && (
        <BulkBar
          count={selected.size}
          busy={bulk.isPending}
          assignees={users.filter(u => u.is_active).map(u => u.username)}
          onStatus={(status) => bulk.mutate({ status })}
          onSeverity={(severity) => bulk.mutate({ severity })}
          onAssign={(assigned_to) => bulk.mutate({ assigned_to })}
          onTags={(add_tags, remove_tags) => bulk.mutate({ add_tags, remove_tags })}
          onClear={() => setSelected(new Set())}
        />
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
    </PageShell>
  )
}
