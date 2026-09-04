import { useState, useEffect, useRef } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import {
  ReactFlow, Background, BackgroundVariant, Controls, MiniMap,
  type Node, type Edge,
} from '@xyflow/react'
import {
  CheckCircle2, Circle, ChevronDown, ChevronUp,
  Plus, X, GitBranch, StickyNote, Save, List, Network,
} from '../../../ui/icons'
import { playbooksApi, type CasePlaybook, type StepAssignee } from '../../../api/playbooks'
import { topoSortNodes } from '../../../utils/playbookUtils'
import { casesApi } from '../../../api/cases'
import { usersApi } from '../../../api/auth'
import { NODE_TYPES, EDGE_TYPES } from '../../playbook/PlaybookNodes'
import StepAssigneePicker from '../../playbook/StepAssigneePicker'
import MarkdownEditor from '../../ui/MarkdownEditor'
import Modal from '../../ui/Modal'
import ConfirmDialog from '../../ui/ConfirmDialog'
import type { Case } from '../../../types'

interface Props { caseId: string; case_: Case }

// ── Helpers ───────────────────────────────────────────────────────────────────

function stepNodes(cp: CasePlaybook) {
  const sorted = topoSortNodes(cp.playbook.nodes, cp.playbook.edges)
  return sorted.filter(n => n.type === 'step' || n.type === 'decision' || n.type === 'remediation')
}
function doneCount(cp: CasePlaybook) {
  return stepNodes(cp).filter(n => cp.step_states[n.id]?.done).length
}
function buildViewNodes(cp: CasePlaybook): Node[] {
  return cp.playbook.nodes.map(n => ({
    ...n,
    data: {
      ...n.data,
      done: cp.step_states[n.id]?.done ?? false,
      assignee: cp.step_states[n.id]?.assignee ?? null,
    },
  })) as Node[]
}

// ── Main ─────────────────────────────────────────────────────────────────────

export default function PlaybookNotesTab({ caseId, case_ }: Props) {
  const qc = useQueryClient()

  /* ── Playbook data ── */
  const { data: casePlaybooks = [] } = useQuery({
    queryKey: ['case-playbooks', caseId],
    queryFn: () => playbooksApi.listCasePlaybooks(caseId),
  })
  const [activePlaybookId, setActivePlaybookId] = useState<string | null>(null)
  const activeCp = casePlaybooks.find(cp => cp.id === activePlaybookId) ?? casePlaybooks[0] ?? null

  /* ── Panel view: steps list vs graph ── */
  type PanelView = 'steps' | 'graph'
  const [panelView, setPanelView] = useState<PanelView>('steps')

  /* ── Step expansion & draft notes ── */
  const [expanded, setExpanded] = useState<Record<string, boolean>>({})
  const [draftNotes, setDraftNotes] = useState<Record<string, string>>({})
  const draftNotesRef = useRef(draftNotes)
  draftNotesRef.current = draftNotes

  // Pre-populate drafts whenever the active playbook changes so that
  // steps expanded by default already have their saved notes loaded.
  useEffect(() => {
    if (!activeCp) return
    const drafts: Record<string, string> = {}
    stepNodes(activeCp).forEach(n => {
      drafts[n.id] = activeCp.step_states[n.id]?.notes ?? ''
    })
    setDraftNotes(drafts)
  }, [activeCp?.id])

  // isExpanded defaults to true (open) unless the user explicitly closed a step
  const toggleExpand = (nodeId: string, cp: CasePlaybook) => {
    if (!expanded[nodeId]) {
      setDraftNotes(d => ({ ...d, [nodeId]: cp.step_states[nodeId]?.notes ?? '' }))
    }
    setExpanded(e => ({ ...e, [nodeId]: !(e[nodeId] ?? true) }))
  }

  /* ── Step mutations ── */
  const updateStep = useMutation({
    mutationFn: ({ cpId, nodeId, done, notes }: { cpId: string; nodeId: string; done: boolean; notes?: string }) => {
      const existing = activeCp?.step_states[nodeId]
      return playbooksApi.updateStep(
        caseId, cpId, nodeId, done,
        existing?.comment ?? '',
        notes ?? existing?.notes ?? '',
      )
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['case-playbooks', caseId] }),
  })

  /* ── Step assignment ── */
  const { data: users = [] } = useQuery({
    queryKey: ['users'],
    queryFn: usersApi.list,
  })

  const assignStep = useMutation({
    mutationFn: ({ cpId, nodeId, assignee }: { cpId: string; nodeId: string; assignee: StepAssignee | null }) =>
      playbooksApi.assignStep(caseId, cpId, nodeId, assignee),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['case-playbooks', caseId] }),
  })

  const saveStepNotes = (cpId: string, nodeId: string) => {
    const existing = activeCp?.step_states[nodeId]
    updateStep.mutate({ cpId, nodeId, done: existing?.done ?? false, notes: draftNotesRef.current[nodeId] ?? '' })
    // Chevrons stay open — don't close after save
  }

  /* ── Autosave ── */
  const [autoSave, setAutoSave] = useState(() => localStorage.getItem('playbook-autosave') !== 'false')
  useEffect(() => { localStorage.setItem('playbook-autosave', String(autoSave)) }, [autoSave])

  useEffect(() => {
    if (!autoSave || !activeCp) return
    const timer = setTimeout(() => {
      stepNodes(activeCp).forEach(n => {
        const saved = activeCp.step_states[n.id]?.notes ?? ''
        const draft = draftNotesRef.current[n.id] ?? ''
        if (draft !== saved) {
          updateStep.mutate({ cpId: activeCp.id, nodeId: n.id, done: activeCp.step_states[n.id]?.done ?? false, notes: draft })
        }
      })
    }, 1500)
    return () => clearTimeout(timer)
   
  }, [draftNotes, autoSave, activeCp?.id])

  /* ── Ctrl+S — save all dirty steps ── */
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (!(e.ctrlKey || e.metaKey) || e.key !== 's') return
      e.preventDefault()
      if (!activeCp) return
      stepNodes(activeCp).forEach(n => {
        const saved = activeCp.step_states[n.id]?.notes ?? ''
        const draft = draftNotesRef.current[n.id] ?? ''
        if (draft !== saved) {
          updateStep.mutate({ cpId: activeCp.id, nodeId: n.id, done: activeCp.step_states[n.id]?.done ?? false, notes: draft })
        }
      })
    }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
   
  }, [activeCp?.id])

  /* ── Detach confirmation ── */
  const [detachTarget, setDetachTarget] = useState<string | null>(null)

  /* ── Add/remove playbook modal ── */
  const [addOpen, setAddOpen] = useState(false)
  const { data: allPlaybooks = [] } = useQuery({
    queryKey: ['playbooks'],
    queryFn: playbooksApi.list,
    enabled: addOpen,
  })
  const availablePlaybooks = allPlaybooks.filter(pb => !casePlaybooks.find(cp => cp.playbook_id === pb.id))

  const attach = useMutation({
    mutationFn: (pbId: string) => playbooksApi.attachPlaybook(caseId, pbId),
    onSuccess: (cp) => {
      qc.invalidateQueries({ queryKey: ['case-playbooks', caseId] })
      setAddOpen(false)
      setActivePlaybookId(cp.id)
    },
  })
  const detach = useMutation({
    mutationFn: (cpId: string) => playbooksApi.detachPlaybook(caseId, cpId),
    onSuccess: (_, cpId) => {
      qc.invalidateQueries({ queryKey: ['case-playbooks', caseId] })
      if (activeCp?.id === cpId) setActivePlaybookId(null)
    },
  })

  /* ── Quick notes ── */
  const [quickNotes, setQuickNotes] = useState(case_.quick_notes)
  const [notesDirty, setNotesDirty] = useState(false)
  const saveNotes = useMutation({
    mutationFn: () => casesApi.update(caseId, { quick_notes: quickNotes }),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['case', caseId] }); setNotesDirty(false) },
  })

  // ── Render ────────────────────────────────────────────────────────────────

  return (
    <div className="flex gap-0" style={{ minHeight: 'calc(100vh - 260px)' }}>

      {/* ══ LEFT : Playbook 2/3 ══════════════════════════════════════════════ */}
      <div className="flex-[2] min-w-0 flex flex-col pr-5 border-r border-hairline">

        {/* Header */}
        <div className="flex items-center gap-3 mb-4 shrink-0">
          {/* View toggle */}
          <div className="flex rounded-control border border-hairline overflow-hidden">
            <button
              onClick={() => setPanelView('steps')}
              className={`flex items-center gap-1.5 text-label px-3 py-1.5 transition-colors ${panelView === 'steps' ? 'bg-accent/10 text-accent' : 'text-fg-secondary hover:text-fg'}`}
            >
              <List size={12} /> Étapes
            </button>
            <button
              onClick={() => setPanelView('graph')}
              className={`flex items-center gap-1.5 text-label px-3 py-1.5 transition-colors ${panelView === 'graph' ? 'bg-accent/10 text-accent' : 'text-fg-secondary hover:text-fg'}`}
              disabled={!activeCp}
            >
              <Network size={12} /> Graphe
            </button>
          </div>

          {/* Playbook selector */}
          <div className="flex gap-1.5 flex-wrap flex-1">
            {casePlaybooks.map(cp => (
              <div
                key={cp.id}
                onClick={() => setActivePlaybookId(cp.id)}
                className={`flex items-center gap-1.5 px-2.5 py-1 rounded-control border text-label cursor-pointer transition-colors ${ activeCp?.id === cp.id
                    ? 'bg-accent/10 text-accent border-accent/30'
                    : 'bg-fg/5 text-fg-secondary border-hairline hover:bg-fg/10'
                }`}
              >
                <span className="truncate max-w-[120px]">{cp.playbook.name}</span>
                <span className="opacity-50 text-label tabular-nums">{doneCount(cp)}/{stepNodes(cp).length}</span>
                <button
                  onMouseDown={e => { e.stopPropagation(); setDetachTarget(cp.id) }}
                  className="opacity-40 hover:opacity-100 hover:text-severity-critical ml-0.5"
                  title="Retirer ce playbook du case"
                ><X size={9} /></button>
              </div>
            ))}
          </div>

          <button
            onClick={() => setAddOpen(true)}
            className="flex items-center gap-1 text-label text-fg-secondary hover:text-fg border border-dashed border-strong hover:border-strong px-2.5 py-1 rounded-control transition-colors shrink-0"
          >
            <Plus size={11} />
          </button>

          {/* Autosave toggle */}
          <label className="flex items-center gap-1.5 text-label text-fg-secondary cursor-pointer select-none ml-auto shrink-0">
            <input
              type="checkbox"
              checked={autoSave}
              onChange={e => setAutoSave(e.target.checked)}
              className="w-3 h-3 accent-accent"
            />
            Autosave
          </label>
        </div>

        {/* Empty state */}
        {!activeCp && (
          <div className="flex-1 flex flex-col items-center justify-center text-center py-16">
            <GitBranch size={28} className="text-fg-secondary/20 mb-3" />
            <p className="text-fg-secondary text-ui">No playbook attached</p>
            <button className="btn-primary mt-4 text-label flex items-center gap-1.5" onClick={() => setAddOpen(true)}>
              <Plus size={12} /> Attacher un playbook
            </button>
          </div>
        )}

        {/* ── GRAPH VIEW ── */}
        {activeCp && panelView === 'graph' && (
          <div className="flex-1 overflow-hidden border border-hairline" style={{ minHeight: 400 }}>
            <ReactFlow
              nodes={buildViewNodes(activeCp)}
              edges={activeCp.playbook.edges as Edge[]}
              nodeTypes={NODE_TYPES}
              edgeTypes={EDGE_TYPES}
              fitView
              nodesDraggable={false}
              nodesConnectable={false}
              elementsSelectable={false}
              style={{ background: '#0B121F' }}
            >
              <Background variant={BackgroundVariant.Dots} gap={20} size={1.5} color="#1e2e42" />
              <Controls />
              <MiniMap nodeColor={() => '#2DD4BF'} />
            </ReactFlow>
          </div>
        )}

        {/* ── STEPS VIEW ── */}
        {activeCp && panelView === 'steps' && (
          <>
            {/* Progress */}
            <div className="mb-3 shrink-0">
              <div className="flex justify-between text-label text-fg-secondary mb-1">
                <span className="font-mono">{activeCp.playbook.name}</span>
                <span>{doneCount(activeCp)} / {stepNodes(activeCp).length}</span>
              </div>
              <div className="h-1 bg-fg/8 rounded-pill overflow-hidden">
                <div
                  className="h-full bg-accent rounded-pill transition-all duration-500"
                  style={{ width: stepNodes(activeCp).length === 0 ? '0%' : `${(doneCount(activeCp) / stepNodes(activeCp).length) * 100}%` }}
                />
              </div>
            </div>

            {/* Steps */}
            <div className="space-y-1.5 overflow-y-auto flex-1">
              {stepNodes(activeCp).length === 0 && (
                <p className="text-fg-secondary text-label text-center py-8">No step in this playbook.</p>
              )}
              {stepNodes(activeCp).map((node, idx) => {
                const state = activeCp.step_states[node.id]
                const done = state?.done ?? false
                const savedNotes = state?.notes ?? ''
                const isExpanded = expanded[node.id] ?? true
                const draft = draftNotes[node.id] ?? savedNotes
                const hasNotes = savedNotes.trim().length > 0

                return (
                  <div key={node.id} className={` border transition-colors ${ done ? 'border-accent/15 bg-accent/[0.025]' : 'border-hairline bg-white/[0.015]'
                  }`}>
                    {/* Row */}
                    <div className="flex items-start gap-2.5 px-3 py-2">
                      <button
                        onClick={() => updateStep.mutate({ cpId: activeCp.id, nodeId: node.id, done: !done })}
                        className={`mt-0.5 shrink-0 transition-colors ${done ? 'text-accent' : 'text-fg-secondary/40 hover:text-fg-secondary'}`}
                      >
                        {done ? <CheckCircle2 size={15} /> : <Circle size={15} />}
                      </button>
                      <div className="flex-1 min-w-0">
                        <p className={`text-label font-medium leading-snug ${done ? 'line-through text-fg-secondary/50' : 'text-fg'}`}>
                          <span className="text-fg-secondary/30 font-mono mr-1">{String(idx + 1).padStart(2, '0')}.</span>
                          {(node.data as any).label}
                        </p>
                        {(node.data as any).description && !isExpanded && (
                          <p className="text-label text-fg-secondary/40 mt-0.5 leading-snug">{(node.data as any).description}</p>
                        )}
                        {hasNotes && !isExpanded && (
                          <p className="text-label text-accent/50 mt-0.5 font-mono italic line-clamp-1">
                            ↳ {savedNotes.split('\n').find(l => l.trim()) ?? ''}
                          </p>
                        )}
                      </div>
                      <div className="flex items-center gap-1 shrink-0">
                        {hasNotes && !isExpanded && (
                          <span className="text-label bg-accent/8 text-accent/60 border border-accent/15 px-1.5 py-0.5 rounded-control">note</span>
                        )}
                        <StepAssigneePicker
                          assignee={state?.assignee}
                          users={users}
                          onChange={assignee => assignStep.mutate({ cpId: activeCp.id, nodeId: node.id, assignee })}
                          disabled={assignStep.isPending}
                        />
                        <button
                          onClick={() => toggleExpand(node.id, activeCp)}
                          className={`flex items-center gap-1 text-label px-2 py-0.5 rounded-control border transition-colors ${ isExpanded
                              ? 'bg-fg/10 text-fg border-strong'
                              : 'text-fg-secondary border-hairline hover:text-fg hover:bg-fg/5'
                          }`}
                        >
                          {isExpanded ? <ChevronUp size={10} /> : <ChevronDown size={10} />}
                          Notes
                        </button>
                      </div>
                    </div>

                    {/* Expanded editor */}
                    {isExpanded && (
                      <div className="px-3 pb-3 pt-1 border-t border-hairline">
                        {(node.data as any).description && (
                          <p className="text-label text-fg-secondary/40 mb-2">{(node.data as any).description}</p>
                        )}
                        <MarkdownEditor
                          value={draft}
                          onChange={v => setDraftNotes(d => ({ ...d, [node.id]: v }))}
                          caseId={caseId}
                          minHeight={100}
                          placeholder={`## Notes — ${(node.data as any).label}\n\n- Observation…\n- Commande : \`\``}
                        />
                        <div className="flex justify-end gap-2 mt-2">
                          <button
                            className="text-label text-fg-secondary hover:text-fg transition-colors"
                            onClick={() => setExpanded(e => ({ ...e, [node.id]: false }))}
                          >Cancel</button>
                          <button
                            className="btn-primary text-label py-1 px-3 flex items-center gap-1"
                            onClick={() => saveStepNotes(activeCp.id, node.id)}
                            disabled={updateStep.isPending}
                          >
                            <Save size={10} /> Sauvegarder
                          </button>
                        </div>
                      </div>
                    )}
                  </div>
                )
              })}
            </div>
          </>
        )}
      </div>

      {/* ══ RIGHT : Mini-graph + Quick Notes 1/3 ══════════════════════════════ */}
      <div className="flex-1 min-w-0 flex flex-col pl-5">

        {/* ── Mini playbook graph ─────────────────────────────────────────── */}
        {activeCp && (
          <div className="mb-4 shrink-0">
            <p className="text-label font-semibold tracking-widest uppercase text-fg-secondary/30 mb-1.5 flex items-center gap-1">
              <Network size={9} /> {activeCp.playbook.name}
            </p>
            <div
              className="w-full border border-hairline overflow-hidden"
              style={{ height: 148 }}
            >
              <ReactFlow
                nodes={buildViewNodes(activeCp)}
                edges={activeCp.playbook.edges as Edge[]}
                nodeTypes={NODE_TYPES}
                edgeTypes={EDGE_TYPES}
                fitView
                fitViewOptions={{ padding: 0.15 }}
                nodesDraggable={false}
                nodesConnectable={false}
                elementsSelectable={false}
                panOnDrag={true}
                zoomOnScroll={true}
                zoomOnPinch={true}
                zoomOnDoubleClick={false}
                preventScrolling={true}
                proOptions={{ hideAttribution: true }}
                style={{ background: '#080e18' }}
              >
                <Background variant={BackgroundVariant.Dots} gap={18} size={1} color="#1a2535" />
              </ReactFlow>
            </div>
          </div>
        )}

        {/* ── Notes libres ────────────────────────────────────────────────── */}
        <div className="flex items-center justify-between mb-3 shrink-0">
          <h3 className="text-fg-secondary font-semibold text-label uppercase tracking-wide flex items-center gap-1.5">
            <StickyNote size={12} /> Notes libres
          </h3>
          {notesDirty && (
            <button
              className="btn-primary text-label py-0.5 px-2.5 flex items-center gap-1"
              onClick={() => saveNotes.mutate()}
              disabled={saveNotes.isPending}
            >
              <Save size={10} /> {saveNotes.isPending ? '…' : 'Sauv.'}
            </button>
          )}
        </div>
        <p className="text-label text-fg-secondary/30 mb-2 shrink-0">
          Verbal context, hypotheses, field intel...
        </p>
        <div className="flex-1">
          <MarkdownEditor
            value={quickNotes}
            onChange={v => { setQuickNotes(v); setNotesDirty(true) }}
            caseId={caseId}
            minHeight={300}
            placeholder={'# Free notes\n\n- Information given verbally...'}
          />
        </div>
      </div>

      {/* ══ Add playbook modal ════════════════════════════════════════════════ */}
      <Modal open={addOpen} onClose={() => setAddOpen(false)} title="Attacher un playbook" size="sm">
        <div className="space-y-3">
          {availablePlaybooks.length === 0 ? (
            <p className="text-fg-secondary text-ui text-center py-4">
              Every playbook is already attached, or none exists.
            </p>
          ) : availablePlaybooks.map(pb => (
            <button
              key={pb.id}
              onClick={() => attach.mutate(pb.id)}
              disabled={attach.isPending}
              className="w-full text-left px-4 py-3 border border-hairline hover:border-accent/40 hover:bg-accent/5 transition-colors group"
            >
              <p className="text-ui font-medium text-fg group-hover:text-accent">{pb.name}</p>
              {pb.description && <p className="text-label text-fg-secondary mt-0.5">{pb.description}</p>}
              <p className="text-label text-fg-secondary/40 mt-1">{pb.nodes.length} node(s)</p>
            </button>
          ))}
          <div className="flex justify-end pt-1">
            <button className="btn-secondary text-label" onClick={() => setAddOpen(false)}>Close</button>
          </div>
        </div>
      </Modal>

      {/* ══ Detach confirmation ══════════════════════════════════════════════ */}
      <ConfirmDialog
        open={detachTarget !== null}
        onClose={() => setDetachTarget(null)}
        onConfirm={() => { if (detachTarget) detach.mutate(detachTarget) }}
        title="Retirer le playbook"
        message="Every note and step state for this playbook will be lost for this case. Continue?"
        confirmLabel="Retirer"
      />
    </div>
  )
}
