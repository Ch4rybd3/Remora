/**
 * ReportTab — split into 3 analyst-authored boxes + playbook reference.
 *
 * LEFT (60%)  — 3 report boxes
 *   ① Technical Analysis   → {{report_analysis}}
 *   2. Remediations        -> {{report_remediation}}
 *   ③ Conclusion          → {{report_conclusion}}
 *   • Auto-generate button → fills all 3 from the case template in one click
 *   • Single Save saves all 3 + creates a version snapshot
 *   • Export MD / Export DOCX
 *   • Version history (collapsible)
 *
 * RIGHT (40%) — Playbook reference (read-only notes, step graph)
 */

import { useState }                                          from 'react'
import { useQuery, useMutation, useQueryClient }             from '@tanstack/react-query'
import {
  ReactFlow, Background, BackgroundVariant,
  type Node, type Edge,
}                                                            from '@xyflow/react'
import {
  FileDown, Save, History, RotateCcw,
  User, Hash, FileOutput, ChevronDown, ChevronRight,
  Network, List, StickyNote, CheckCircle2, Circle,
  Sparkles, BookOpen, AlertCircle, Clipboard, ClipboardCheck,
  FlaskConical, Wrench, Flag, FileText, AlignLeft,
}                                                            from 'lucide-react'
import { casesApi }                                          from '../../../api/cases'
import { reportVersionsApi, type ReportVersionMeta }        from '../../../api/reportVersions'
import { reportDocTemplatesApi }                             from '../../../api/reportDocTemplates'
import { playbooksApi, type CasePlaybook }                   from '../../../api/playbooks'
import { templatesApi }                                      from '../../../api/templates'
import { topoSortNodes }                                      from '../../../utils/playbookUtils'
import { NODE_TYPES, EDGE_TYPES }                            from '../../playbook/PlaybookNodes'
import MarkdownEditor                                        from '../../ui/MarkdownEditor'
import type { Case, Template }                               from '../../../types'
import { fmtRelative, fmtDateTime }                          from '../../../utils/dateUtils'

interface Props { case_: Case }

// ── Section slug (mirrors backend _section_slug) ────────────────────────────────

function sectionSlug(section: NonNullable<Template['report_sections']>[number]): string {
  if (section.tag) return section.tag.toLowerCase().trim()
  return section.name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_|_$/g, '') || 'section'
}

// ── Helpers ────────────────────────────────────────────────────────────────────

function stepNodes(cp: CasePlaybook) {
  const sorted = topoSortNodes(cp.playbook.nodes, cp.playbook.edges)
  return sorted.filter(n => n.type === 'step' || n.type === 'decision' || n.type === 'remediation')
}
function buildViewNodes(cp: CasePlaybook): Node[] {
  return cp.playbook.nodes.map(n => ({
    ...n,
    data: { ...n.data, done: cp.step_states[n.id]?.done ?? false },
  })) as Node[]
}
function doneCount(cp: CasePlaybook) {
  return stepNodes(cp).filter(n => cp.step_states[n.id]?.done).length
}

// ── Report box header ──────────────────────────────────────────────────────────

interface BoxMeta {
  icon: React.ReactNode
  label: string
  tag: string
  color: string
  placeholder: string
}

const BOX_META: BoxMeta[] = [
  {
    icon:  <FlaskConical size={12} />,
    label: 'Technical Analysis',
    tag:   '{{report_analysis}}',
    color: 'text-blue-400 border-blue-500/20 bg-blue-500/5',
    placeholder:
      '## Root Cause\n\n*Describe how the incident started...*\n\n' +
      '## Attack Chain\n\n*Describe how the attack progressed.*\n\n' +
      '## Impact\n\n*Technical and business impact.*',
  },
  {
    icon:  <Wrench size={12} />,
    label: 'Remediations',
    tag:   '{{report_remediation}}',
    color: 'text-orange-400 border-orange-500/20 bg-orange-500/5',
    placeholder:
      '*Remediation actions completed or in progress.*\n\n' +
      '- [ ] Action 1\n- [ ] Action 2',
  },
  {
    icon:  <Flag size={12} />,
    label: 'Conclusion & Recommandations',
    tag:   '{{report_conclusion}}',
    color: 'text-purple-300 border-purple-500/20 bg-purple-500/5',
    placeholder:
      '*Summary and long-term recommendations.*\n\n' +
      '- [ ] Recommandation 1\n- [ ] Recommandation 2',
  },
]

// ── Version card ───────────────────────────────────────────────────────────────

function VersionCard({
  v, caseId, onRestore,
}: { v: ReportVersionMeta; caseId: string; onRestore: (c: string) => void }) {
  const [loading, setLoading] = useState(false)

  const handleRestore = async () => {
    if (!confirm(`Restore version ${v.version}? Unsaved changes will be lost.`)) return
    setLoading(true)
    try {
      const full = await reportVersionsApi.get(caseId, v.id)
      onRestore(full.content)
    } finally { setLoading(false) }
  }

  return (
    <div className="flex items-center gap-2 px-3 py-2 rounded-lg border border-white/8 bg-white/[0.015] hover:border-white/15 transition-colors group">
      <span className="text-[9px] font-mono font-bold px-1.5 py-0.5 rounded bg-accent-green/10 text-accent-green border border-accent-green/20 shrink-0">
        v{v.version}
      </span>
      <span className="text-[10px] text-white/60 flex-1 truncate" title={fmtDateTime(v.created_at)}>
        {fmtRelative(v.created_at)}
      </span>
      {v.created_by && (
        <span className="flex items-center gap-1 text-[9px] text-accent-muted/40">
          <User size={8} /> {v.created_by}
        </span>
      )}
      <span className="flex items-center gap-1 text-[9px] text-accent-muted/30">
        <Hash size={8} /> {v.line_count}
      </span>
      <button
        onClick={handleRestore} disabled={loading}
        className="opacity-0 group-hover:opacity-100 flex items-center gap-1 text-[9px] px-1.5 py-0.5 rounded border border-accent-green/20 text-accent-green/70 hover:bg-accent-green/10 transition-all"
      >
        <RotateCcw size={8} className={loading ? 'animate-spin' : ''} />
        Restaurer
      </button>
    </div>
  )
}

// ── Copy-to-clipboard button ───────────────────────────────────────────────────

function CopyBtn({ getText }: { getText: () => string }) {
  const [copied, setCopied] = useState(false)
  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(getText())
      setCopied(true)
      setTimeout(() => setCopied(false), 1800)
    } catch { /* ignore */ }
  }
  return (
    <button
      onClick={handleCopy}
      title="Copy this step's content"
      className={`flex items-center gap-1.5 px-2.5 py-1 rounded text-xs font-medium transition-colors border ${
        copied
          ? 'text-accent-green bg-accent-green/10 border-accent-green/30'
          : 'text-accent-muted hover:text-white bg-white/[0.03] hover:bg-white/8 border-white/10 hover:border-white/20'
      }`}
    >
      {copied
        ? <><ClipboardCheck size={13} /><span>Copied</span></>
        : <><Clipboard size={13} /><span>Copy</span></>
      }
    </button>
  )
}

// ── Playbook reference panel ───────────────────────────────────────────────────

function PlaybookStepEditor({
  cp, node, idx, caseId,
}: {
  cp:     CasePlaybook
  node:   CasePlaybook['playbook']['nodes'][number]
  idx:    number
  caseId: string
}) {
  const qc          = useQueryClient()
  const state       = cp.step_states[node.id]
  const done        = state?.done ?? false
  const [draft, setDraft] = useState(state?.notes ?? '')
  const [dirty, setDirty] = useState(false)

  const save = useMutation({
    mutationFn: () =>
      playbooksApi.updateStep(caseId, cp.id, node.id, done, state?.comment ?? '', draft),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['case-playbooks', caseId] })
      setDirty(false)
    },
  })

  return (
    <div className="border-b border-white/[0.05] last:border-b-0">
      <div className="flex items-start gap-2 px-3 pt-2.5 pb-1">
        <span className={`mt-0.5 shrink-0 ${done ? 'text-accent-green' : 'text-accent-muted/25'}`}>
          {done ? <CheckCircle2 size={12} /> : <Circle size={12} />}
        </span>
        <p className={`text-[11px] font-medium leading-snug flex-1 min-w-0 break-words ${done ? 'text-accent-muted/40 line-through' : 'text-white/80'}`}>
          <span className="text-accent-muted/20 font-mono mr-1">{String(idx + 1).padStart(2, '0')}.</span>
          {(node.data as any).label}
        </p>
        <div className="flex items-center gap-1 shrink-0">
          {dirty && (
            <button
              onClick={() => save.mutate()}
              disabled={save.isPending}
              className="text-[9px] px-1.5 py-0.5 rounded bg-accent-green/10 text-accent-green border border-accent-green/20 hover:bg-accent-green/20 transition-colors"
            >
              <Save size={9} className="inline mr-0.5" />
              {save.isPending ? '…' : 'Sauv.'}
            </button>
          )}
          <CopyBtn getText={() => draft} />
        </div>
      </div>
      <div className="px-3 pb-2.5 min-w-0 overflow-hidden">
        <MarkdownEditor
          value={draft}
          onChange={v => { setDraft(v); setDirty(v !== (state?.notes ?? '')) }}
          caseId={caseId}
          minHeight={80}
          withToggle={false}
          defaultMode="live"
          placeholder={`Notes — ${(node.data as any).label}`}
        />
      </div>
    </div>
  )
}

function PlaybookReference({ caseId }: { caseId: string }) {
  const [activeId,  setActiveId]  = useState<string | null>(null)
  const [panelView, setPanelView] = useState<'steps' | 'graph'>('steps')

  const { data: casePlaybooks = [], isLoading } = useQuery({
    queryKey: ['case-playbooks', caseId],
    queryFn:  () => playbooksApi.listCasePlaybooks(caseId),
  })

  const activeCp = casePlaybooks.find(cp => cp.id === activeId) ?? casePlaybooks[0] ?? null

  if (isLoading) {
    return <p className="text-xs text-accent-muted/30 italic text-center py-8 animate-pulse">Loading...</p>
  }
  if (casePlaybooks.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center h-full gap-3 text-center px-6">
        <StickyNote size={28} className="text-accent-muted/15" />
        <p className="text-xs text-accent-muted/40">No playbook attached to this case.</p>
        <p className="text-[10px] text-accent-muted/25">
          Attache un playbook depuis l'onglet Playbook pour voir tes notes ici.
        </p>
      </div>
    )
  }

  return (
    <div className="flex flex-col h-full overflow-hidden">
      <div className="px-3 py-2 border-b border-white/5 flex items-center gap-2 shrink-0">
        <div className="flex gap-1 flex-1 flex-wrap">
          {casePlaybooks.map(cp => (
            <button
              key={cp.id}
              onClick={() => setActiveId(cp.id)}
              className={`flex items-center gap-1 text-[10px] px-2 py-0.5 rounded border transition-colors ${
                activeCp?.id === cp.id
                  ? 'bg-accent-green/10 text-accent-green border-accent-green/25'
                  : 'text-accent-muted border-white/10 hover:text-white hover:bg-white/5'
              }`}
            >
              {cp.playbook.name}
              <span className="opacity-40 text-[8px] font-mono">{doneCount(cp)}/{stepNodes(cp).length}</span>
            </button>
          ))}
        </div>
        <div className="flex rounded border border-white/10 overflow-hidden shrink-0">
          <button
            onClick={() => setPanelView('steps')}
            className={`flex items-center px-2 py-1 text-[10px] transition-colors ${panelView === 'steps' ? 'bg-accent-green/10 text-accent-green' : 'text-accent-muted hover:text-white'}`}
          ><List size={10} /></button>
          <button
            onClick={() => setPanelView('graph')}
            disabled={!activeCp}
            className={`flex items-center px-2 py-1 text-[10px] transition-colors ${panelView === 'graph' ? 'bg-accent-green/10 text-accent-green' : 'text-accent-muted hover:text-white disabled:opacity-30'}`}
          ><Network size={10} /></button>
        </div>
      </div>

      {activeCp && panelView === 'graph' && (
        <div className="flex-1 overflow-hidden">
          <ReactFlow
            nodes={buildViewNodes(activeCp)}
            edges={activeCp.playbook.edges as Edge[]}
            nodeTypes={NODE_TYPES}
            edgeTypes={EDGE_TYPES}
            fitView
            nodesDraggable={false}
            nodesConnectable={false}
            elementsSelectable={false}
            panOnDrag
            zoomOnScroll
            preventScrolling={false}
            proOptions={{ hideAttribution: true }}
            style={{ background: '#080e18' }}
          >
            <Background variant={BackgroundVariant.Dots} gap={20} size={1} color="#1a2535" />
          </ReactFlow>
        </div>
      )}

      {activeCp && panelView === 'steps' && (
        <div className="flex-1 overflow-y-auto">
          {stepNodes(activeCp).length === 0
            ? <p className="text-[11px] text-accent-muted/30 italic text-center py-8">No steps.</p>
            : stepNodes(activeCp).map((node, idx) => (
                <PlaybookStepEditor
                  key={node.id}
                  cp={activeCp}
                  node={node as any}
                  idx={idx}
                  caseId={caseId}
                />
              ))
          }
        </div>
      )}
    </div>
  )
}

// ── Main ───────────────────────────────────────────────────────────────────────

export default function ReportTab({ case_ }: Props) {
  const qc = useQueryClient()

  // ── Fixed 3-box state (used when no template or template has no dynamic sections) ──
  const [analysis,    setAnalysis]    = useState(case_.report_analysis    ?? '')
  const [remediation, setRemediation] = useState(case_.report_remediation ?? '')
  const [conclusion,  setConclusion]  = useState(case_.report_conclusion  ?? '')

  // ── Dynamic per-section state ──────────────────────────────────────────────
  const initSectionsData = (): Record<string, string> => {
    try { return JSON.parse(case_.report_sections_data || '{}') } catch { return {} }
  }
  const [sectionsData,    setSectionsData]    = useState<Record<string, string>>(initSectionsData)

  const [dirty,              setDirty]             = useState(false)
  const [versionsOpen,       setVersionsOpen]      = useState(false)
  const [selectedTemplateId, setSelectedTemplateId]= useState<number | ''>('')
  const [exporting,          setExporting]         = useState(false)

  const [rightTab,    setRightTab]    = useState<'summary' | 'playbook'>('summary')
  const [quickNotes,  setQuickNotes]  = useState(case_.quick_notes        ?? '')
  const [execSummary, setExecSummary] = useState(case_.executive_summary  ?? '')
  const [notesDirty,  setNotesDirty]  = useState(false)

  const markDirty = () => setDirty(true)

  // ── Doc templates ──────────────────────────────────────────────────────────
  const { data: docTemplates = [] } = useQuery({
    queryKey: ['report-doc-templates'],
    queryFn:  reportDocTemplatesApi.list,
  })

  // ── Case template (for dynamic sections) ──────────────────────────────────
  const { data: caseTemplate } = useQuery({
    queryKey: ['template', case_.template_id],
    queryFn:  () => templatesApi.get(case_.template_id!),
    enabled:  !!case_.template_id,
    staleTime: 60_000,
  })

  const dynamicSections = caseTemplate?.report_sections?.length
    ? caseTemplate.report_sections
    : null

  // ── Versions ───────────────────────────────────────────────────────────────
  const { data: versions = [] } = useQuery({
    queryKey: ['report-versions', case_.id],
    queryFn:  () => reportVersionsApi.list(case_.id),
  })

  // ── Save ───────────────────────────────────────────────────────────────────
  const save = useMutation({
    mutationFn: () => dynamicSections
      ? reportVersionsApi.save(case_.id, { sections_data: sectionsData })
      : reportVersionsApi.save(case_.id, { analysis, remediation, conclusion }),
    onSuccess:  () => {
      qc.invalidateQueries({ queryKey: ['case', case_.id] })
      qc.invalidateQueries({ queryKey: ['report-versions', case_.id] })
      setDirty(false)
    },
  })

  // ── Auto-generate (fills sections from case template) ─────────────────────
  const generate = useMutation({
    mutationFn: () => casesApi.generateReport(case_.id),
    onSuccess:  (data: { analysis: string; remediation: string; conclusion: string; sections_data?: Record<string, string> }) => {
      if (dynamicSections && data.sections_data) {
        setSectionsData(prev => {
          const merged = { ...prev }
          for (const [k, v] of Object.entries(data.sections_data!)) {
            merged[k] = merged[k]?.trim() ? merged[k] + '\n\n---\n\n' + v : v
          }
          return merged
        })
      } else {
        if (data.analysis)    { setAnalysis(prev    => prev.trim() ? prev + '\n\n---\n\n' + data.analysis    : data.analysis)    }
        if (data.remediation) { setRemediation(prev => prev.trim() ? prev + '\n\n---\n\n' + data.remediation : data.remediation) }
        if (data.conclusion)  { setConclusion(prev  => prev.trim() ? prev + '\n\n---\n\n' + data.conclusion  : data.conclusion)  }
      }
      setDirty(true)
    },
  })

  // ── Restore from version (combined → split back by separator) ─────────────
  const handleRestore = (combined: string) => {
    if (dynamicSections) {
      // For dynamic sections, put everything in the first section
      const sections = dynamicSections
      if (sections.length > 0) {
        const slug = sectionSlug(sections[0])
        setSectionsData(prev => ({ ...prev, [slug]: combined }))
      }
    } else {
      // Try to split on section headers if present, else put all in analysis
      const parts = combined.split(/\n{1,2}---\n{1,2}/)
      setAnalysis(parts[0]?.trim()    ?? combined)
      setRemediation(parts[1]?.trim() ?? '')
      setConclusion(parts[2]?.trim()  ?? '')
    }
    setDirty(true)
  }

  // ── Export DOCX ───────────────────────────────────────────────────────────
  const handleExportDocx = async () => {
    if (!selectedTemplateId) return
    setExporting(true)
    try {
      const blob = await reportDocTemplatesApi.generate(Number(selectedTemplateId), case_.id)
      const tpl  = docTemplates.find(t => t.id === Number(selectedTemplateId))
      const ext  = tpl?.format === 'docx' ? 'docx' : 'md'
      const url  = URL.createObjectURL(blob)
      const a    = document.createElement('a')
      a.href     = url
      a.download = `${case_.title.replace(/\s+/g, '_')}_report.${ext}`
      a.click()
      URL.revokeObjectURL(url)
    } finally { setExporting(false) }
  }

  // ── Export MD (combined) ──────────────────────────────────────────────────
  const handleExportMd = () => {
    const combined = dynamicSections
      ? dynamicSections
          .map(s => {
            const slug = sectionSlug(s)
            const content = sectionsData[slug]?.trim()
            return content ? `## ${s.name}\n\n${content}` : ''
          })
          .filter(Boolean)
          .join('\n\n---\n\n')
      : [analysis, remediation, conclusion].filter(s => s.trim()).join('\n\n---\n\n')
    const blob = new Blob([combined], { type: 'text/markdown' })
    const url  = URL.createObjectURL(blob)
    const a    = document.createElement('a')
    a.href     = url
    a.download = `${case_.title.replace(/\s+/g, '_')}_report.md`
    a.click()
    URL.revokeObjectURL(url)
  }

  // ── Save quick notes + executive summary ─────────────────────────────────
  const saveNotes = useMutation({
    mutationFn: () => casesApi.update(case_.id, {
      quick_notes:       quickNotes,
      executive_summary: execSummary,
    }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['case', case_.id] })
      setNotesDirty(false)
    },
  })

  const hasTemplate = !!case_.template_id

  // ── Render ─────────────────────────────────────────────────────────────────

  return (
    <div className="flex h-full overflow-hidden">

      {/* ══ LEFT — 3 report boxes ═══════════════════════════════════════════ */}
      <div className="flex-[3] min-w-0 flex flex-col overflow-hidden border-r border-white/5">

        {/* ── Toolbar ──────────────────────────────────────────────────────── */}
        <div className="px-4 py-2.5 border-b border-white/5 bg-bg-secondary/40 shrink-0 space-y-2">

          {/* Row 1 — title + badge */}
          <div className="flex items-center gap-2">
            <BookOpen size={13} className="text-accent-green/60" />
            <span className="text-xs font-semibold text-accent-green tracking-wide">Report</span>
            {hasTemplate ? (
              <span className="text-[9px] font-mono px-1.5 py-0.5 rounded bg-accent-green/8 text-accent-green/60 border border-accent-green/15">
                {dynamicSections
                  ? `${dynamicSections.length} sections dynamiques`
                  : `template: ${case_.template_id}`}
              </span>
            ) : (
              <span className="flex items-center gap-1 text-[9px] text-accent-muted/30">
                <AlertCircle size={9} />
                No case template - default structure
              </span>
            )}
          </div>

          {/* Row 2 — actions */}
          <div className="flex items-center gap-2 flex-wrap">

            {/* Auto-generate */}
            <button
              className="btn-secondary text-xs flex items-center gap-1.5"
              onClick={() => generate.mutate()}
              disabled={generate.isPending}
              title="Generate the three sections from the case template in one click"
            >
              <Sparkles size={12} className={generate.isPending ? 'animate-pulse' : ''} />
              {generate.isPending ? 'Generating...' : 'Auto-generate'}
            </button>

            {/* Export MD */}
            <button
              className="btn-secondary text-xs flex items-center gap-1.5"
              onClick={handleExportMd}
              title="Export the combined content as Markdown"
            >
              <FileDown size={12} />
              .md
            </button>

            {/* Report template + DOCX export */}
            <div className="flex items-center gap-1">
              <div className="relative">
                <select
                  value={selectedTemplateId}
                  onChange={e => setSelectedTemplateId(e.target.value === '' ? '' : Number(e.target.value))}
                  className="appearance-none bg-bg-secondary border border-white/10 rounded-md
                    text-xs text-accent-muted pl-2 pr-6 py-1.5 outline-none
                    hover:border-white/20 focus:border-accent-green/40 transition-colors cursor-pointer"
                >
                  <option value="">Report template…</option>
                  {docTemplates.map(t => (
                    <option key={t.id} value={t.id}>{t.name} ({t.format.toUpperCase()})</option>
                  ))}
                </select>
                <ChevronDown size={10} className="absolute right-1.5 top-1/2 -translate-y-1/2 text-accent-muted/40 pointer-events-none" />
              </div>
              <button
                className="btn-secondary text-xs flex items-center gap-1.5 disabled:opacity-40"
                disabled={!selectedTemplateId || exporting}
                onClick={handleExportDocx}
                title="Generate and download the full report through the report template"
              >
                <FileOutput size={12} className={exporting ? 'animate-pulse' : ''} />
                {exporting ? 'Export…' : 'Exporter'}
              </button>
            </div>

            <div className="flex-1" />

            {/* Versions toggle */}
            <button
              onClick={() => setVersionsOpen(o => !o)}
              className={`flex items-center gap-1.5 text-xs transition-colors ${
                versionsOpen ? 'text-accent-green' : 'text-accent-muted/50 hover:text-white'
              }`}
            >
              {versionsOpen ? <ChevronDown size={11} /> : <ChevronRight size={11} />}
              <History size={11} />
              {versions.length > 0 ? `v${versions[0]?.version ?? 1}` : 'Versions'}
            </button>

            {/* Save */}
            <button
              className={`text-xs flex items-center gap-1.5 ${dirty ? 'btn-primary' : 'btn-secondary opacity-50'}`}
              onClick={() => save.mutate()}
              disabled={save.isPending || !dirty}
            >
              <Save size={11} className={save.isPending ? 'animate-pulse' : ''} />
              {save.isPending ? 'Saving...' : dirty ? 'Save' : 'Saved'}
            </button>
          </div>
        </div>

        {/* ── Version history ────────────────────────────────────────────────── */}
        {versionsOpen && (
          <div className="shrink-0 border-b border-white/5 bg-bg-secondary/20 px-4 py-3">
            {versions.length === 0 ? (
              <p className="text-[10px] text-accent-muted/30 italic">
                No version yet - save to create the first snapshot.
              </p>
            ) : (
              <div className="space-y-1.5">
                {versions.map(v => (
                  <VersionCard
                    key={v.id}
                    v={v}
                    caseId={case_.id}
                    onRestore={handleRestore}
                  />
                ))}
              </div>
            )}
            {dirty && (
              <p className="text-[9px] text-yellow-400/60 mt-2 flex items-center gap-1">
                <AlertCircle size={9} /> Unsaved changes - save to create a version.
              </p>
            )}
          </div>
        )}

        {/* ── Report boxes ──────────────────────────────────────────────────── */}
        <div className="flex-1 overflow-y-auto">
          {dynamicSections ? (
            /* Dynamic sections from case template */
            dynamicSections.map((section) => {
              const slug = sectionSlug(section)
              const catColor =
                (section.category || '').includes('anal') ? 'text-blue-400 border-blue-500/20 bg-blue-500/5' :
                (section.category || '').includes('remed') ? 'text-orange-400 border-orange-500/20 bg-orange-500/5' :
                (section.category || '').includes('concl') ? 'text-purple-300 border-purple-500/20 bg-purple-500/5' :
                'text-accent-green/70 border-accent-green/20 bg-accent-green/5'
              return (
                <div key={slug} className="border-b border-white/5 last:border-b-0">
                  <div className={`flex items-center gap-2 px-4 py-2 border-b border-white/5 ${catColor}`}>
                    <FlaskConical size={12} className="shrink-0" />
                    <span className="text-[11px] font-semibold tracking-wide truncate min-w-0" title={section.name}>
                      {section.name}
                    </span>
                    <code className="ml-auto shrink-0 text-[9px] font-mono opacity-40">{`{{${slug}}}`}</code>
                  </div>
                  <div className="p-3 min-w-0 overflow-hidden">
                    <MarkdownEditor
                      value={sectionsData[slug] ?? ''}
                      onChange={v => { setSectionsData(prev => ({ ...prev, [slug]: v })); markDirty() }}
                      caseId={case_.id}
                      minHeight={160}
                      autoResize
                      placeholder={section.template || `${section.name}…`}
                    />
                  </div>
                </div>
              )
            })
          ) : (
            /* Fixed 3 boxes (no template or template has no sections) */
            [
              { meta: BOX_META[0], value: analysis,    onChange: (v: string) => { setAnalysis(v);    markDirty() } },
              { meta: BOX_META[1], value: remediation,  onChange: (v: string) => { setRemediation(v); markDirty() } },
              { meta: BOX_META[2], value: conclusion,   onChange: (v: string) => { setConclusion(v);  markDirty() } },
            ].map(({ meta, value, onChange }) => (
              <div key={meta.tag} className="border-b border-white/5 last:border-b-0">
                <div className={`flex items-center gap-2 px-4 py-2 border-b border-white/5 ${meta.color}`}>
                  <span className="shrink-0">{meta.icon}</span>
                  <span className="text-[11px] font-semibold tracking-wide truncate min-w-0">{meta.label}</span>
                  <code className="ml-auto shrink-0 text-[9px] font-mono opacity-40">{meta.tag}</code>
                </div>
                <div className="p-3 min-w-0 overflow-hidden">
                  <MarkdownEditor
                    value={value}
                    onChange={onChange}
                    caseId={case_.id}
                    minHeight={160}
                    autoResize
                    placeholder={meta.placeholder}
                  />
                </div>
              </div>
            ))
          )}
        </div>
      </div>

      {/* ══ RIGHT - Summary + Playbook tabs ═════════════════════════════════ */}
      <div className="flex-[2] min-w-0 flex flex-col overflow-hidden bg-bg-secondary/20">

        {/* Tab bar */}
        <div className="flex items-center gap-0 border-b border-white/5 shrink-0">
          <button
            onClick={() => setRightTab('summary')}
            className={`flex items-center gap-1.5 px-3 py-2.5 text-[10px] font-medium border-b-2 transition-colors ${
              rightTab === 'summary'
                ? 'border-accent-green text-accent-green'
                : 'border-transparent text-accent-muted/40 hover:text-white'
            }`}
          >
            <AlignLeft size={11} />
            Summary &amp; Notes
          </button>
          <button
            onClick={() => setRightTab('playbook')}
            className={`flex items-center gap-1.5 px-3 py-2.5 text-[10px] font-medium border-b-2 transition-colors ${
              rightTab === 'playbook'
                ? 'border-accent-green text-accent-green'
                : 'border-transparent text-accent-muted/40 hover:text-white'
            }`}
          >
            <StickyNote size={11} />
            Notes Playbook
          </button>
          {notesDirty && (
            <button
              onClick={() => saveNotes.mutate()}
              disabled={saveNotes.isPending}
              className="ml-auto mr-3 flex items-center gap-1 text-[10px] px-2 py-1 rounded bg-accent-green/10 text-accent-green border border-accent-green/25 hover:bg-accent-green/20 transition-colors"
            >
              <Save size={10} className={saveNotes.isPending ? 'animate-pulse' : ''} />
              {saveNotes.isPending ? '…' : 'Sauv.'}
            </button>
          )}
        </div>

        {/* Summary tab */}
        {rightTab === 'summary' && (
          <div className="flex-1 overflow-y-auto">

            {/* Executive Summary */}
            <div className="border-b border-white/5">
              <div className="flex items-center gap-2 px-3 py-2 bg-accent-green/[0.04] border-b border-accent-green/10">
                <FileText size={11} className="text-accent-green/60" />
                <span className="text-[11px] font-semibold text-accent-green/80 tracking-wide">Executive Summary</span>
                <code className="ml-auto text-[9px] font-mono text-accent-muted/30">case.executive_summary</code>
              </div>
              <div className="p-3 min-w-0 overflow-hidden">
                <MarkdownEditor
                  value={execSummary}
                  onChange={v => { setExecSummary(v); setNotesDirty(true) }}
                  caseId={case_.id}
                  minHeight={140}
                  autoResize
                  placeholder="Executive summary - non-technical overview of the incident, business impact, key actions..."
                />
              </div>
            </div>

            {/* Quick Notes */}
            <div>
              <div className="flex items-center gap-2 px-3 py-2 bg-white/[0.02] border-b border-white/5">
                <StickyNote size={11} className="text-accent-muted/50" />
                <span className="text-[11px] font-semibold text-accent-muted/60 tracking-wide">Notes rapides</span>
                <code className="ml-auto text-[9px] font-mono text-accent-muted/30">case.quick_notes</code>
              </div>
              <div className="p-3 min-w-0 overflow-hidden">
                <MarkdownEditor
                  value={quickNotes}
                  onChange={v => { setQuickNotes(v); setNotesDirty(true) }}
                  caseId={case_.id}
                  minHeight={120}
                  autoResize
                  placeholder="Quick investigation notes, IOCs to dig into, hypotheses..."
                />
              </div>
            </div>

          </div>
        )}

        {/* Playbook tab */}
        {rightTab === 'playbook' && (
          <div className="flex-1 overflow-hidden">
            <div className="px-3 py-2 border-b border-white/5 shrink-0">
              <p className="text-[9px] text-accent-muted/20">
                Read-only - copy and paste into the editor on the left
              </p>
            </div>
            <div className="h-full overflow-hidden">
              <PlaybookReference caseId={case_.id} />
            </div>
          </div>
        )}

      </div>

    </div>
  )
}
