import { useState, useMemo, useEffect } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { ArrowLeft, Edit2, Save, X, Trash2 } from 'lucide-react'
import { casesApi } from '../api/cases'
import { usersApi } from '../api/auth'
import type { Case, CaseSeverity, CaseStatus } from '../types'
import { SeverityBadge, StatusBadge, TLPBadge, Tag } from '../components/ui/Badge'
import TagInput, { type InputTag } from '../components/ui/TagInput'
import ConfirmDialog from '../components/ui/ConfirmDialog'
import SummaryTab from '../components/case/tabs/SummaryTab'
import PlaybookNotesTab from '../components/case/tabs/PlaybookNotesTab'
import ReportTab from '../components/case/tabs/ReportTab'
import IOCsTab from '../components/case/tabs/IOCsTab'
import AssetsTab from '../components/case/tabs/AssetsTab'
import EvidencesTab from '../components/case/tabs/EvidencesTab'
import TimelineTab from '../components/case/tabs/TimelineTab'
import AttackGraphTab from '../components/case/tabs/AttackGraphTab'
import { useCurrentCase } from '../context/CurrentCaseContext'
import { format } from 'date-fns'

type Tab = 'summary' | 'playbook' | 'report' | 'iocs' | 'assets' | 'evidences' | 'timeline' | 'attack_graph'

const TABS: { id: Tab; label: string }[] = [
  { id: 'summary',      label: 'Executive Summary' },
  { id: 'playbook',     label: 'Playbook' },
  { id: 'report',       label: 'Report' },
  { id: 'iocs',         label: 'IOCs' },
  { id: 'assets',       label: 'Assets' },
  { id: 'evidences',    label: 'Evidence' },
  { id: 'timeline',     label: 'Timeline' },
  { id: 'attack_graph', label: 'Attack Graph' },
]

export default function CaseDetail() {
  const { id } = useParams<{ id: string }>()
  const navigate = useNavigate()
  const qc = useQueryClient()
  const [activeTab, setActiveTab] = useState<Tab>('summary')
  const [editing, setEditing] = useState(false)
  const [deleteOpen, setDeleteOpen] = useState(false)
  const [editForm, setEditForm] = useState<Partial<Case>>({})
  const [assigneeTags, setAssigneeTags] = useState<InputTag[]>([])

  const USER_BADGE = 'bg-blue-500/10 text-blue-400 border-blue-500/20'
  const { data: users = [] } = useQuery({ queryKey: ['users'], queryFn: usersApi.list })
  const userSuggestions = useMemo(() => users.filter(u => u.is_active).map(u => ({
    value: u.username, label: u.username, sublabel: u.email ?? undefined,
    badge: u.role, badgeColor: USER_BADGE,
  })), [users])

  const { setCurrentCase } = useCurrentCase()

  const { data: case_, isLoading } = useQuery({
    queryKey: ['case', id],
    queryFn: () => casesApi.get(id!),
    enabled: !!id,
  })

  // Définit ce case comme "case courant" dès qu'on le charge
  useEffect(() => {
    if (case_) setCurrentCase({ id: case_.id, title: case_.title })
  }, [case_?.id, case_?.title])

  const update = useMutation({
    mutationFn: (data: Partial<Case>) => casesApi.update(id!, {
      ...data,
      assigned_to: assigneeTags.map(t => t.value).join(', '),
    }),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['case', id] }); qc.invalidateQueries({ queryKey: ['cases'] }); setEditing(false) },
  })

  const remove = useMutation({
    mutationFn: () => casesApi.delete(id!),
    onSuccess: () => navigate('/cases'),
  })

  if (isLoading) return <div className="p-8 text-accent-muted text-sm">Loading…</div>
  if (!case_) return <div className="p-8 text-severity-critical text-sm">Case not found.</div>

  const startEdit = () => {
    setEditForm({
      title: case_.title, description: case_.description, severity: case_.severity,
      status: case_.status, tlp: case_.tlp, tags: case_.tags,
    })
    setAssigneeTags(
      case_.assigned_to.split(',').map(s => s.trim()).filter(Boolean)
        .map(v => ({ value: v, badgeColor: USER_BADGE }))
    )
    setEditing(true)
  }

  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <div className="border-b border-white/5 px-6 py-4">
        <div className="flex items-start gap-4">
          <button onClick={() => navigate('/cases')} className="text-accent-muted hover:text-white mt-1 transition-colors">
            <ArrowLeft size={18} />
          </button>
          <div className="flex-1 min-w-0">
            {editing ? (
              <input
                className="input text-lg font-bold mb-2 w-full"
                value={editForm.title}
                onChange={e => setEditForm(f => ({ ...f, title: e.target.value }))}
              />
            ) : (
              <h1 className="text-xl font-bold text-white truncate">{case_.title}</h1>
            )}
            <div className="flex items-center gap-2 mt-1 flex-wrap">
              {editing ? (
                <>
                  <select className="input text-xs py-0.5 w-32" value={editForm.severity} onChange={e => setEditForm(f => ({ ...f, severity: e.target.value as CaseSeverity }))}>
                    {['informational', 'low', 'medium', 'high', 'critical'].map(s => <option key={s} value={s}>{s}</option>)}
                  </select>
                  <select className="input text-xs py-0.5 w-32" value={editForm.status} onChange={e => setEditForm(f => ({ ...f, status: e.target.value as CaseStatus }))}>
                    {['open', 'in_progress', 'closed', 'archived'].map(s => <option key={s} value={s}>{s.replace('_', ' ')}</option>)}
                  </select>
                  <select className="input text-xs py-0.5 w-28" value={editForm.tlp} onChange={e => setEditForm(f => ({ ...f, tlp: e.target.value }))}>
                    {['TLP:RED', 'TLP:AMBER', 'TLP:GREEN', 'TLP:CLEAR'].map(t => <option key={t}>{t}</option>)}
                  </select>
                  <div className="w-52">
                    <TagInput
                      tags={assigneeTags}
                      onChange={setAssigneeTags}
                      suggestions={userSuggestions}
                      placeholder="Assign users…"
                    />
                  </div>
                  <input className="input text-xs py-0.5 flex-1 min-w-32" placeholder="tags, comma, separated" value={editForm.tags} onChange={e => setEditForm(f => ({ ...f, tags: e.target.value }))} />
                </>
              ) : (
                <>
                  <SeverityBadge severity={case_.severity} />
                  <StatusBadge status={case_.status} />
                  <TLPBadge tlp={case_.tlp} />
                  {case_.assigned_to && case_.assigned_to.split(',').map(s => s.trim()).filter(Boolean).map(name => (
                    <span key={name} className="text-[10px] font-mono px-1.5 py-0.5 rounded border bg-blue-500/10 text-blue-400 border-blue-500/20">{name}</span>
                  ))}
                  {case_.tags && case_.tags.split(',').filter(Boolean).map(t => <Tag key={t} label={t.trim()} />)}
                </>
              )}
            </div>
            <p className="text-xs text-accent-muted/60 mt-1">
              Created {format(new Date(case_.created_at), 'dd MMM yyyy HH:mm')} ·
              Updated {format(new Date(case_.updated_at), 'dd MMM yyyy HH:mm')}
            </p>
          </div>
          <div className="flex items-center gap-2 shrink-0">
            {editing ? (
              <>
                <button onClick={() => setEditing(false)} className="btn-secondary text-xs flex items-center gap-1.5"><X size={12} /> Cancel</button>
                <button onClick={() => update.mutate(editForm)} disabled={update.isPending} className="btn-primary text-xs flex items-center gap-1.5">
                  <Save size={12} />{update.isPending ? 'Saving…' : 'Save'}
                </button>
              </>
            ) : (
              <>
                <button onClick={startEdit} className="btn-secondary text-xs flex items-center gap-1.5"><Edit2 size={12} /> Edit</button>
                <button onClick={() => setDeleteOpen(true)} className="btn-danger text-xs flex items-center gap-1.5"><Trash2 size={12} /> Delete</button>
              </>
            )}
          </div>
        </div>
      </div>

      {/* Tabs */}
      <div className="border-b border-white/5 px-6">
        <div className="flex gap-1">
          {TABS.map(tab => (
            <button
              key={tab.id}
              onClick={() => setActiveTab(tab.id)}
              className={`px-4 py-3 text-xs font-medium transition-colors ${
                activeTab === tab.id ? 'tab-active' : 'tab-inactive'
              }`}
            >
              {tab.label}
            </button>
          ))}
        </div>
      </div>

      {/* Tab content */}
      <div className="flex-1 overflow-hidden">
        {/* Attack Graph: needs full height without padding */}
        {activeTab === 'attack_graph' && (
          <div className="h-full">
            <AttackGraphTab caseId={case_.id} />
          </div>
        )}

        {activeTab !== 'attack_graph' && (
          <div className="h-full overflow-auto p-6">
            {activeTab === 'playbook' && (
              <PlaybookNotesTab caseId={case_.id} case_={case_} />
            )}
            {/* Text-heavy tabs: capped width for readability */}
            {activeTab === 'summary' && (
              <div className="max-w-4xl mx-auto">
                <SummaryTab case_={case_} />
              </div>
            )}
            {activeTab === 'report' && <ReportTab case_={case_} />}
            {/* Data tabs: full width */}
            {activeTab === 'iocs'      && <IOCsTab caseId={case_.id} />}
            {activeTab === 'assets'    && <AssetsTab caseId={case_.id} />}
            {activeTab === 'evidences' && <EvidencesTab caseId={case_.id} />}
            {activeTab === 'timeline'  && <TimelineTab caseId={case_.id} />}
          </div>
        )}
      </div>

      <ConfirmDialog
        open={deleteOpen}
        onClose={() => setDeleteOpen(false)}
        onConfirm={() => remove.mutate()}
        title="Delete Case"
        message={`"${case_.title}" and all associated data will be permanently deleted.`}
      />
    </div>
  )
}
