/**
 * ReportTab — a document with a section rail.
 *
 * Three columns:
 *
 *   left     numbered sections with their word counts, and the version history
 *            underneath. Clicking a section filters the document to it, which
 *            is what makes a long report writable: one thing on screen, full
 *            width, nothing competing. Clicking again brings everything back.
 *   centre   one measured column of prose. The section is the container, so the
 *            editor draws no frame of its own.
 *   right    executive summary, quick notes and the playbook reference,
 *            collapsible to a rail so the document can take the full width on a
 *            laptop.
 *
 * Sections are numbered in mono rather than colour-coded: a hue invented per
 * section means nothing and fights the single accent.
 *
 * Both shapes of report share one model. `sections` below is built either from
 * the case template's report_sections or from the three fixed boxes, so the
 * rail, the filter, the word counts and the editors have a single code path.
 */

import { useState }                                          from 'react'
import { useQuery, useMutation, useQueryClient }             from '@tanstack/react-query'
import {
  ReactFlow, Background, BackgroundVariant,
  type Node, type Edge,
}                                                            from '@xyflow/react'
import {
  FileDown, Save, RotateCcw,
  User, Hash, FileOutput, ChevronDown,
  Network, List, CheckCircle2, Circle,
  Sparkles, AlertCircle, Clipboard, ClipboardCheck, StickyNote,
}                                                            from '../../../ui/icons'
import { HelpExample, HelpPopover }                          from '../../../ui/HelpPopover'
import { SectionRail, type RailItem }                        from '../../../ui/SectionRail'
import { SidePanel, SidePanelBlock }                         from '../../../ui/SidePanel'
import { Toolbar, ToolbarGroup, ToolbarLabel, ToolbarSpacer } from '../../../ui/Toolbar'
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

// ── Fixed report boxes ────────────────────────────────────────────────────────
// Used when the case has no template, or the template defines no sections.
// No colour: sections are told apart by their numeral and their name.

interface BoxMeta {
  label: string
  tag: string
  placeholder: string
}

const BOX_META: BoxMeta[] = [
  {
    label: 'Technical Analysis',
    tag:   'report_analysis',
    placeholder:
      '## Root Cause\n\n*Describe how the incident started...*\n\n' +
      '## Attack Chain\n\n*Describe how the attack progressed.*\n\n' +
      '## Impact\n\n*Technical and business impact.*',
  },
  {
    label: 'Remediations',
    tag:   'report_remediation',
    placeholder:
      '*Remediation actions completed or in progress.*\n\n' +
      '- [ ] Action 1\n- [ ] Action 2',
  },
  {
    label: 'Conclusion & Recommendations',
    tag:   'report_conclusion',
    placeholder:
      '*Summary and long-term recommendations.*\n\n' +
      '- [ ] Recommendation 1\n- [ ] Recommendation 2',
  },
]

// ── Version row ───────────────────────────────────────────────────────────────
// Sized for the rail: version, age, line count, and a restore that only appears
// on hover so the column stays quiet while reading.

function VersionRow({
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
    <div className="group flex items-baseline gap-2 px-3.5 py-1.5 hover:bg-hover transition-colors">
      <span className="numeral text-accent shrink-0">v{v.version}</span>
      <span className="text-label text-fg-secondary flex-1 truncate" title={fmtDateTime(v.created_at)}>
        {fmtRelative(v.created_at)}
      </span>
      {v.created_by && (
        <span className="text-label font-mono text-fg-muted shrink-0 hidden group-hover:inline" title={v.created_by}>
          <User size={8} className="inline" /> {v.created_by}
        </span>
      )}
      <span className="text-label font-mono text-fg-muted shrink-0 group-hover:hidden">
        <Hash size={8} className="inline" />{v.line_count}
      </span>
      <button
        onClick={handleRestore}
        disabled={loading}
        title={`Restore version ${v.version}`}
        aria-label={`Restore version ${v.version}`}
        className="hidden group-hover:block text-fg-muted hover:text-accent transition-colors shrink-0"
      >
        <RotateCcw size={10} className={loading ? 'animate-spin' : ''} />
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
      className={`flex items-center gap-1.5 px-2.5 py-1 rounded-control text-label font-medium transition-colors border ${ copied
          ? 'text-accent bg-accent/10 border-accent/30'
          : 'text-fg-secondary hover:text-fg bg-white/[0.03] hover:bg-fg/8 border-hairline hover:border-strong'
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
    <div className="border-b border-strong/[0.05] last:border-b-0">
      <div className="flex items-start gap-2 px-3 pt-2.5 pb-1">
        <span className={`mt-0.5 shrink-0 ${done ? 'text-accent' : 'text-fg-secondary/25'}`}>
          {done ? <CheckCircle2 size={12} /> : <Circle size={12} />}
        </span>
        <p className={`text-label font-medium leading-snug flex-1 min-w-0 break-words ${done ? 'text-fg-secondary/40 line-through' : 'text-fg/80'}`}>
          <span className="text-fg-secondary/20 font-mono mr-1">{String(idx + 1).padStart(2, '0')}.</span>
          {(node.data as any).label}
        </p>
        <div className="flex items-center gap-1 shrink-0">
          {dirty && (
            <button
              onClick={() => save.mutate()}
              disabled={save.isPending}
              className="text-label px-1.5 py-0.5 rounded-control bg-accent/10 text-accent border border-accent/20 hover:bg-accent/20 transition-colors"
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
    return <p className="text-label text-fg-secondary/30 italic text-center py-8 animate-pulse">Loading...</p>
  }
  if (casePlaybooks.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center h-full gap-3 text-center px-6">
        <StickyNote size={28} className="text-fg-secondary/15" />
        <p className="text-label text-fg-secondary/40">No playbook attached to this case.</p>
        <p className="text-label text-fg-secondary/25">
          Attache un playbook depuis l'onglet Playbook pour voir tes notes ici.
        </p>
      </div>
    )
  }

  return (
    <div className="flex flex-col h-full overflow-hidden">
      <div className="px-3 py-2 border-b border-hairline flex items-center gap-2 shrink-0">
        <div className="flex gap-1 flex-1 flex-wrap">
          {casePlaybooks.map(cp => (
            <button
              key={cp.id}
              onClick={() => setActiveId(cp.id)}
              className={`flex items-center gap-1 text-label px-2 py-0.5 rounded-control border transition-colors ${ activeCp?.id === cp.id
                  ? 'bg-accent/10 text-accent border-accent/25'
                  : 'text-fg-secondary border-hairline hover:text-fg hover:bg-fg/5'
              }`}
            >
              {cp.playbook.name}
              <span className="opacity-40 text-label font-mono">{doneCount(cp)}/{stepNodes(cp).length}</span>
            </button>
          ))}
        </div>
        <div className="flex rounded-control border border-hairline overflow-hidden shrink-0">
          <button
            onClick={() => setPanelView('steps')}
            className={`flex items-center px-2 py-1 text-label transition-colors ${panelView === 'steps' ? 'bg-accent/10 text-accent' : 'text-fg-secondary hover:text-fg'}`}
          ><List size={10} /></button>
          <button
            onClick={() => setPanelView('graph')}
            disabled={!activeCp}
            className={`flex items-center px-2 py-1 text-label transition-colors ${panelView === 'graph' ? 'bg-accent/10 text-accent' : 'text-fg-secondary hover:text-fg disabled:opacity-30'}`}
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
            ? <p className="text-label text-fg-secondary/30 italic text-center py-8">No steps.</p>
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
  const [selectedTemplateId, setSelectedTemplateId]= useState<number | ''>('')
  const [exporting,          setExporting]         = useState(false)

  // null shows the whole document; an id filters to that section alone.
  const [activeSection, setActiveSection] = useState<string | null>(null)
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

  // ── One model for both shapes of report ──────────────────────────────────
  // Dynamic template sections and the three fixed boxes collapse into the same
  // list, so the rail, the filter, the word counts and the editors share a
  // single code path instead of two that drift apart.
  interface Section {
    id: string
    name: string
    tag: string
    value: string
    placeholder: string
    onChange: (v: string) => void
  }

  const sections: Section[] = dynamicSections
    ? dynamicSections.map((s) => {
        const slug = sectionSlug(s)
        return {
          id:          slug,
          name:        s.name,
          tag:         slug,
          value:       sectionsData[slug] ?? '',
          placeholder: s.template || `${s.name}...`,
          onChange:    (v: string) => {
            setSectionsData((prev) => ({ ...prev, [slug]: v }))
            markDirty()
          },
        }
      })
    : [
        { meta: BOX_META[0], value: analysis,    set: setAnalysis },
        { meta: BOX_META[1], value: remediation, set: setRemediation },
        { meta: BOX_META[2], value: conclusion,  set: setConclusion },
      ].map(({ meta, value, set }) => ({
        id:          meta.tag,
        name:        meta.label,
        tag:         meta.tag,
        value,
        placeholder: meta.placeholder,
        onChange:    (v: string) => { set(v); markDirty() },
      }))

  const wordCount = (text: string) => text.trim() ? text.trim().split(/\s+/).length : 0

  const railItems: RailItem[] = sections.map((s) => {
    const words = wordCount(s.value)
    return {
      id:    s.id,
      label: s.name,
      meta:  words ? `${words} words` : 'empty',
      empty: words === 0,
    }
  })

  const visible = activeSection
    ? sections.filter((s) => s.id === activeSection)
    : sections

  const totalWords = sections.reduce((sum, s) => sum + wordCount(s.value), 0)

  // ── Render ─────────────────────────────────────────────────────────────────

  return (
    <div className="flex h-full overflow-hidden">

      {/* ══ LEFT — section rail and version history ═══════════════════════════ */}
      <SectionRail
        items={railItems}
        selectedId={activeSection}
        onSelect={setActiveSection}
        footer={
          <div className="py-1">
            <div className="flex items-center gap-2 px-3.5 py-1.5">
              <span className="text-label font-mono uppercase tracking-label text-fg-muted">
                Versions
              </span>
              <span className="flex-1 border-t border-hairline" />
            </div>
            {versions.length === 0 ? (
              <p className="px-3.5 py-1.5 text-label text-fg-muted italic">
                None yet — save to snapshot.
              </p>
            ) : (
              <div className="max-h-48 overflow-y-auto">
                {versions.map((v) => (
                  <VersionRow key={v.id} v={v} caseId={case_.id} onRestore={handleRestore} />
                ))}
              </div>
            )}
            {dirty && (
              <p className="flex items-center gap-1 px-3.5 py-1.5 text-label text-severity-medium">
                <AlertCircle size={9} /> Unsaved
              </p>
            )}
          </div>
        }
      />

      {/* ══ CENTRE — the document ═════════════════════════════════════════════ */}
      <div className="flex-1 min-w-0 flex flex-col overflow-hidden">

        <Toolbar>
          <ToolbarLabel>Report</ToolbarLabel>
          <span className="text-label font-mono text-fg-muted">
            {sections.length} section{sections.length > 1 ? 's' : ''} · {totalWords} words
            {hasTemplate && !dynamicSections && ` · template ${case_.template_id}`}
          </span>
          {!hasTemplate && (
            <span className="flex items-center gap-1 text-label text-fg-muted">
              <AlertCircle size={9} /> no case template
            </span>
          )}

          <ToolbarSpacer />

          <ToolbarGroup>
            <button
              className="btn-ghost flex items-center gap-1.5"
              onClick={() => generate.mutate()}
              disabled={generate.isPending}
              title="Fill the sections from the case template"
            >
              <Sparkles size={12} className={generate.isPending ? 'animate-pulse' : ''} />
              {generate.isPending ? 'Generating...' : 'Auto-generate'}
            </button>
          </ToolbarGroup>

          <ToolbarGroup>
            <button
              className="btn-ghost flex items-center gap-1.5"
              onClick={handleExportMd}
              title="Export the combined content as Markdown"
            >
              <FileDown size={12} /> .md
            </button>
            <div className="relative">
              <select
                value={selectedTemplateId}
                onChange={(e) => setSelectedTemplateId(e.target.value === '' ? '' : Number(e.target.value))}
                className="appearance-none bg-transparent border border-hairline rounded-control
                           text-ui text-fg-secondary pl-2 pr-6 py-1 outline-none cursor-pointer
                           hover:border-strong focus:border-focus transition-colors"
              >
                <option value="">Report template...</option>
                {docTemplates.map((tpl) => (
                  <option key={tpl.id} value={tpl.id}>{tpl.name} ({tpl.format.toUpperCase()})</option>
                ))}
              </select>
              <ChevronDown size={10} className="absolute right-1.5 top-1/2 -translate-y-1/2 text-fg-muted pointer-events-none" />
            </div>
            <button
              className="btn-ghost flex items-center gap-1.5 disabled:opacity-40"
              disabled={!selectedTemplateId || exporting}
              onClick={handleExportDocx}
              title="Generate the full report through the report template"
            >
              <FileOutput size={12} className={exporting ? 'animate-pulse' : ''} />
              {exporting ? 'Exporting...' : 'Export'}
            </button>
          </ToolbarGroup>

          <button
            className={`flex items-center gap-1.5 ${dirty ? 'btn-primary' : 'btn-ghost opacity-50'}`}
            onClick={() => save.mutate()}
            disabled={save.isPending || !dirty}
          >
            <Save size={11} className={save.isPending ? 'animate-pulse' : ''} />
            {save.isPending ? 'Saving...' : dirty ? 'Save' : 'Saved'}
          </button>

          <HelpPopover title="Writing the report">
            <p>
              The rail on the left lists the sections of this report. Selecting one shows
              only that section; selecting it again brings the whole document back.
            </p>
            <p>
              Saving writes every section at once and snapshots a version. Versions are
              listed under the rail and can be restored from there.
            </p>
            <HelpExample
              label="What the analyst writes"
              code={'{{report_content}}  — injected into the report template at export'}
            />
            <p>
              The structural parts — IOC tables, MITRE coverage, the timeline — are added
              by the report template at export time, not written here.
            </p>
          </HelpPopover>
        </Toolbar>

        <div className="flex-1 overflow-y-auto">
          {visible.map((section) => {
            const index = sections.findIndex((s) => s.id === section.id)
            return (
              <article key={section.id} className="border-b border-hairline last:border-b-0">
                <header className="flex items-baseline gap-2.5 px-6 pt-5 pb-2">
                  <span className="numeral shrink-0">{String(index + 1).padStart(2, '0')}</span>
                  <h2 className="text-title font-semibold text-fg truncate min-w-0" title={section.name}>
                    {section.name}
                  </h2>
                  <span className="ml-auto shrink-0 text-label font-mono text-fg-muted">markdown</span>
                </header>
                {/* Borderless: the section is the container, so the editor draws
                    no frame of its own. The column is measured — prose past
                    ~70ch stops being readable. */}
                <div className="px-6 pb-6 min-w-0 overflow-hidden">
                  <div className="max-w-[72ch]">
                    <MarkdownEditor
                      value={section.value}
                      onChange={section.onChange}
                      caseId={case_.id}
                      minHeight={activeSection ? 420 : 180}
                      autoResize
                      placeholder={section.placeholder}
                    />
                  </div>
                </div>
              </article>
            )
          })}
        </div>
      </div>

      {/* ══ RIGHT — reference, collapsible to a rail ══════════════════════════ */}
      <SidePanel
        storageKey="report"
        tabs={[
          {
            id:    'summary',
            label: 'Summary',
            meta:  notesDirty ? 'unsaved' : undefined,
            content: (
              <>
                {notesDirty && (
                  <div className="px-3.5 py-2 border-b border-hairline">
                    <button
                      onClick={() => saveNotes.mutate()}
                      disabled={saveNotes.isPending}
                      className="btn-primary w-full flex items-center justify-center gap-1.5"
                    >
                      <Save size={11} className={saveNotes.isPending ? 'animate-pulse' : ''} />
                      {saveNotes.isPending ? 'Saving...' : 'Save notes'}
                    </button>
                  </div>
                )}
                <SidePanelBlock label="Executive summary" meta="non-technical">
                  <MarkdownEditor
                    value={execSummary}
                    onChange={(v) => { setExecSummary(v); setNotesDirty(true) }}
                    caseId={case_.id}
                    minHeight={140}
                    autoResize
                    placeholder="Non-technical overview of the incident, business impact, key actions..."
                  />
                </SidePanelBlock>
                <SidePanelBlock label="Quick notes">
                  <MarkdownEditor
                    value={quickNotes}
                    onChange={(v) => { setQuickNotes(v); setNotesDirty(true) }}
                    caseId={case_.id}
                    minHeight={120}
                    autoResize
                    placeholder="Investigation notes, IOCs to dig into, hypotheses..."
                  />
                </SidePanelBlock>
              </>
            ),
          },
          {
            id:    'playbook',
            label: 'Playbook',
            content: (
              <div className="h-full flex flex-col min-h-0">
                <p className="px-3.5 py-2 text-label text-fg-muted border-b border-hairline shrink-0">
                  Read-only — copy into the document
                </p>
                <div className="flex-1 min-h-0 overflow-hidden">
                  <PlaybookReference caseId={case_.id} />
                </div>
              </div>
            ),
          },
        ]}
      />
    </div>
  )
}
