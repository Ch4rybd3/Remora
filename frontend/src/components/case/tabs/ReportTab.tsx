/**
 * ReportTab — split into 3 analyst-authored boxes + playbook reference.
 *
 * LEFT (60%)  — 3 report boxes
 *   ① Analyse Technique   → {{report_analysis}}
 *   ② Remédiations        → {{report_remediation}}
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
  FlaskConical, Wrench, Flag,
}                                                            from 'lucide-react'
import { casesApi }                                          from '../../../api/cases'
import { reportVersionsApi, type ReportVersionMeta }        from '../../../api/reportVersions'
import { reportDocTemplatesApi }                             from '../../../api/reportDocTemplates'
import { playbooksApi, type CasePlaybook }                   from '../../../api/playbooks'
import { topoSortNodes }                                      from '../../../utils/playbookUtils'
import { NODE_TYPES, EDGE_TYPES }                            from '../../playbook/PlaybookNodes'
import MarkdownEditor                                        from '../../ui/MarkdownEditor'
import type { Case }                                         from '../../../types'
import { fmtRelative, fmtDateTime }                          from '../../../utils/dateUtils'

interface Props { case_: Case }

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
    label: 'Analyse Technique',
    tag:   '{{report_analysis}}',
    color: 'text-blue-400 border-blue-500/20 bg-blue-500/5',
    placeholder:
      '## Cause Racine\n\n*Décrire l\'origine de l\'incident…*\n\n' +
      '## Chaîne d\'Attaque\n\n*Décrire la progression de l\'attaque.*\n\n' +
      '## Impact\n\n*Impact technique et métier.*',
  },
  {
    icon:  <Wrench size={12} />,
    label: 'Remédiations',
    tag:   '{{report_remediation}}',
    color: 'text-orange-400 border-orange-500/20 bg-orange-500/5',
    placeholder:
      '*Actions de remédiation réalisées ou en cours.*\n\n' +
      '- [ ] Action 1\n- [ ] Action 2',
  },
  {
    icon:  <Flag size={12} />,
    label: 'Conclusion & Recommandations',
    tag:   '{{report_conclusion}}',
    color: 'text-purple-300 border-purple-500/20 bg-purple-500/5',
    placeholder:
      '*Synthèse et recommandations long terme.*\n\n' +
      '- [ ] Recommandation 1\n- [ ] Recommandation 2',
  },
]

// ── Version card ───────────────────────────────────────────────────────────────

function VersionCard({
  v, caseId, onRestore,
}: { v: ReportVersionMeta; caseId: string; onRestore: (c: string) => void }) {
  const [loading, setLoading] = useState(false)

  const handleRestore = async () => {
    if (!confirm(`Restaurer la version ${v.version} ? Les modifications non sauvegardées seront perdues.`)) return
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
      title="Copier le contenu de cette étape"
      className={`flex items-center gap-1.5 px-2.5 py-1 rounded text-xs font-medium transition-colors border ${
        copied
          ? 'text-accent-green bg-accent-green/10 border-accent-green/30'
          : 'text-accent-muted hover:text-white bg-white/[0.03] hover:bg-white/8 border-white/10 hover:border-white/20'
      }`}
    >
      {copied
        ? <><ClipboardCheck size={13} /><span>Copié !</span></>
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
        <p className={`text-[11px] font-medium leading-snug flex-1 ${done ? 'text-accent-muted/40 line-through' : 'text-white/80'}`}>
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
      <div className="px-3 pb-2.5">
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
    return <p className="text-xs text-accent-muted/30 italic text-center py-8 animate-pulse">Chargement…</p>
  }
  if (casePlaybooks.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center h-full gap-3 text-center px-6">
        <StickyNote size={28} className="text-accent-muted/15" />
        <p className="text-xs text-accent-muted/40">Aucun playbook attaché à ce case.</p>
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
            ? <p className="text-[11px] text-accent-muted/30 italic text-center py-8">Aucune étape.</p>
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

  const [analysis,    setAnalysis]    = useState(case_.report_analysis    ?? '')
  const [remediation, setRemediation] = useState(case_.report_remediation ?? '')
  const [conclusion,  setConclusion]  = useState(case_.report_conclusion  ?? '')
  const [dirty,              setDirty]             = useState(false)
  const [versionsOpen,       setVersionsOpen]      = useState(false)
  const [selectedTemplateId, setSelectedTemplateId]= useState<number | ''>('')
  const [exporting,          setExporting]         = useState(false)

  const markDirty = () => setDirty(true)

  // ── Doc templates ──────────────────────────────────────────────────────────
  const { data: docTemplates = [] } = useQuery({
    queryKey: ['report-doc-templates'],
    queryFn:  reportDocTemplatesApi.list,
  })

  // ── Versions ───────────────────────────────────────────────────────────────
  const { data: versions = [] } = useQuery({
    queryKey: ['report-versions', case_.id],
    queryFn:  () => reportVersionsApi.list(case_.id),
  })

  // ── Save ───────────────────────────────────────────────────────────────────
  const save = useMutation({
    mutationFn: () => reportVersionsApi.save(case_.id, { analysis, remediation, conclusion }),
    onSuccess:  () => {
      qc.invalidateQueries({ queryKey: ['case', case_.id] })
      qc.invalidateQueries({ queryKey: ['report-versions', case_.id] })
      setDirty(false)
    },
  })

  // ── Auto-generate (fills all 3 boxes from case template) ──────────────────
  const generate = useMutation({
    mutationFn: () => casesApi.generateReport(case_.id),
    onSuccess:  (data) => {
      if (data.analysis)    { setAnalysis(prev    => prev.trim() ? prev + '\n\n---\n\n' + data.analysis    : data.analysis)    }
      if (data.remediation) { setRemediation(prev => prev.trim() ? prev + '\n\n---\n\n' + data.remediation : data.remediation) }
      if (data.conclusion)  { setConclusion(prev  => prev.trim() ? prev + '\n\n---\n\n' + data.conclusion  : data.conclusion)  }
      setDirty(true)
    },
  })

  // ── Restore from version (combined → split back by separator) ─────────────
  const handleRestore = (combined: string) => {
    // Try to split on section headers if present, else put all in analysis
    const parts = combined.split(/\n{1,2}---\n{1,2}/)
    setAnalysis(parts[0]?.trim()    ?? combined)
    setRemediation(parts[1]?.trim() ?? '')
    setConclusion(parts[2]?.trim()  ?? '')
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
    const combined = [analysis, remediation, conclusion]
      .filter(s => s.trim())
      .join('\n\n---\n\n')
    const blob = new Blob([combined], { type: 'text/markdown' })
    const url  = URL.createObjectURL(blob)
    const a    = document.createElement('a')
    a.href     = url
    a.download = `${case_.title.replace(/\s+/g, '_')}_report.md`
    a.click()
    URL.revokeObjectURL(url)
  }

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
            <span className="text-xs font-semibold text-accent-green tracking-wide">Rapport</span>
            {hasTemplate ? (
              <span className="text-[9px] font-mono px-1.5 py-0.5 rounded bg-accent-green/8 text-accent-green/60 border border-accent-green/15">
                template: {case_.template_id}
              </span>
            ) : (
              <span className="flex items-center gap-1 text-[9px] text-accent-muted/30">
                <AlertCircle size={9} />
                Aucun case template — structure par défaut
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
              title="Génère les 3 sections depuis le case template en un clic"
            >
              <Sparkles size={12} className={generate.isPending ? 'animate-pulse' : ''} />
              {generate.isPending ? 'Génération…' : 'Auto-générer'}
            </button>

            {/* Export MD */}
            <button
              className="btn-secondary text-xs flex items-center gap-1.5"
              onClick={handleExportMd}
              title="Exporter le contenu combiné en Markdown"
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
                title="Générer et télécharger le rapport complet via le report template"
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
              {save.isPending ? 'Sauvegarde…' : dirty ? 'Sauvegarder' : 'Sauvegardé'}
            </button>
          </div>
        </div>

        {/* ── Version history ────────────────────────────────────────────────── */}
        {versionsOpen && (
          <div className="shrink-0 border-b border-white/5 bg-bg-secondary/20 px-4 py-3">
            {versions.length === 0 ? (
              <p className="text-[10px] text-accent-muted/30 italic">
                Aucune version — sauvegardez pour créer le premier snapshot.
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
                <AlertCircle size={9} /> Modifications non sauvegardées — sauvegardez pour créer une version.
              </p>
            )}
          </div>
        )}

        {/* ── 3 report boxes ────────────────────────────────────────────────── */}
        <div className="flex-1 overflow-y-auto">
          {[
            { meta: BOX_META[0], value: analysis,    onChange: (v: string) => { setAnalysis(v);    markDirty() } },
            { meta: BOX_META[1], value: remediation,  onChange: (v: string) => { setRemediation(v); markDirty() } },
            { meta: BOX_META[2], value: conclusion,   onChange: (v: string) => { setConclusion(v);  markDirty() } },
          ].map(({ meta, value, onChange }) => (
            <div key={meta.tag} className="border-b border-white/5 last:border-b-0">
              {/* Box header */}
              <div className={`flex items-center gap-2 px-4 py-2 border-b border-white/5 ${meta.color}`}>
                <span className="shrink-0">{meta.icon}</span>
                <span className="text-[11px] font-semibold tracking-wide">{meta.label}</span>
                <code className="ml-auto text-[9px] font-mono opacity-40">{meta.tag}</code>
              </div>
              {/* Editor */}
              <div className="p-3">
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
          ))}
        </div>
      </div>

      {/* ══ RIGHT — Playbook reference ══════════════════════════════════════ */}
      <div className="flex-[2] min-w-0 flex flex-col overflow-hidden bg-bg-secondary/20">
        <div className="px-3 py-2.5 border-b border-white/5 shrink-0">
          <div className="flex items-center gap-2">
            <StickyNote size={12} className="text-accent-muted/50" />
            <span className="text-[10px] font-semibold tracking-widest uppercase text-accent-muted/40">
              Notes d'investigation
            </span>
          </div>
          <p className="text-[9px] text-accent-muted/20 mt-0.5">
            Lecture seule — copie-colle dans l'éditeur de gauche
          </p>
        </div>
        <div className="flex-1 overflow-hidden">
          <PlaybookReference caseId={case_.id} />
        </div>
      </div>

    </div>
  )
}
