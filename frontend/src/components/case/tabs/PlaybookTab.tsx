import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { ReactFlow, Background, Controls, type Node, type Edge } from '@xyflow/react'
import '@xyflow/react/dist/style.css'
import { Plus, GitBranch, CheckCircle2, Circle, ChevronDown, ChevronUp, X, ExternalLink, AlertCircle } from '../../../ui/icons'
import { playbooksApi, type CasePlaybook, type StepAssignee } from '../../../api/playbooks'
import { usersApi } from '../../../api/auth'
import { topoSortNodes } from '../../../utils/playbookUtils'
import { NODE_TYPES, EDGE_TYPES } from '../../playbook/PlaybookNodes'
import StepAssigneePicker from '../../playbook/StepAssigneePicker'
import Modal from '../../ui/Modal'

interface Props { caseId: string }

export default function PlaybookTab({ caseId }: Props) {
  const qc = useQueryClient()
  const [addOpen, setAddOpen] = useState(false)
  const [activeTab, setActiveTab] = useState<string | null>(null)
  const [expandedStep, setExpandedStep] = useState<string | null>(null)
  const [commentDraft, setCommentDraft] = useState<Record<string, string>>({})

  const { data: casePlaybooks = [] } = useQuery({
    queryKey: ['case-playbooks', caseId],
    queryFn: () => playbooksApi.listCasePlaybooks(caseId),
  })

  const { data: allPlaybooks = [] } = useQuery({
    queryKey: ['playbooks'],
    queryFn: playbooksApi.list,
  })

  const { data: users = [] } = useQuery({
    queryKey: ['users'],
    queryFn: usersApi.list,
  })

  const attach = useMutation({
    mutationFn: (pbId: string) => playbooksApi.attachPlaybook(caseId, pbId),
    onSuccess: (cp) => {
      qc.invalidateQueries({ queryKey: ['case-playbooks', caseId] })
      setAddOpen(false)
      setActiveTab(cp.id)
    },
  })

  const detach = useMutation({
    mutationFn: (cpId: string) => playbooksApi.detachPlaybook(caseId, cpId),
    onSuccess: (_, cpId) => {
      qc.invalidateQueries({ queryKey: ['case-playbooks', caseId] })
      if (activeTab === cpId) setActiveTab(casePlaybooks.find(c => c.id !== cpId)?.id ?? null)
    },
  })

  const updateStep = useMutation({
    mutationFn: ({ cpId, nodeId, done, comment }: { cpId: string; nodeId: string; done: boolean; comment: string }) =>
      playbooksApi.updateStep(caseId, cpId, nodeId, done, comment),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['case-playbooks', caseId] }),
  })

  const assignStep = useMutation({
    mutationFn: ({ cpId, nodeId, assignee }: { cpId: string; nodeId: string; assignee: StepAssignee | null }) =>
      playbooksApi.assignStep(caseId, cpId, nodeId, assignee),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['case-playbooks', caseId] }),
  })

  const activeCp = casePlaybooks.find(cp => cp.id === activeTab) ?? casePlaybooks[0] ?? null

  // Key that changes whenever any step's done-state flips → forces ReactFlow remount
  // so the graph re-renders with the updated node styling.
  const graphKey = activeCp
    ? activeCp.id + '|' + Object.entries(activeCp.step_states)
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([id, s]) => `${id}=${s.done ? 1 : 0}:${s.assignee?.label ?? ''}`)
        .join(',')
    : 'empty'
  const availablePlaybooks = allPlaybooks.filter(pb => !casePlaybooks.find(cp => cp.playbook_id === pb.id))

  const stepNodes = (cp: CasePlaybook) => {
    const sorted = topoSortNodes(cp.playbook.nodes, cp.playbook.edges)
    return sorted.filter(n => n.type === 'step' || n.type === 'decision' || n.type === 'remediation' || n.type === 'playbook_ref')
  }

  const doneCount = (cp: CasePlaybook) =>
    stepNodes(cp).filter(n => cp.step_states[n.id]?.done).length

  return (
    <div className="space-y-4">
      {/* Playbook selector tabs */}
      <div className="flex items-center gap-2 flex-wrap">
        {casePlaybooks.map(cp => (
          <button
            key={cp.id}
            onClick={() => setActiveTab(cp.id)}
            className={`flex items-center gap-2 px-3 py-1.5 rounded-control text-label transition-colors ${ (activeCp?.id === cp.id)
                ? 'bg-accent/10 text-accent border border-accent/30'
                : 'bg-fg/5 text-fg-secondary border border-hairline hover:bg-fg/10'
            }`}
          >
            <GitBranch size={12} />
            {cp.playbook.name}
            <span className="text-label opacity-60">
              {doneCount(cp)}/{stepNodes(cp).length}
            </span>
            <span
              onClick={e => { e.stopPropagation(); detach.mutate(cp.id) }}
              className="ml-1 opacity-40 hover:opacity-100 hover:text-severity-critical transition-opacity"
            >
              <X size={10} />
            </span>
          </button>
        ))}
        <button
          onClick={() => setAddOpen(true)}
          className="flex items-center gap-1.5 px-3 py-1.5 rounded-control text-label border border-dashed border-strong text-fg-secondary hover:text-fg hover:border-strong transition-colors"
        >
          <Plus size={12} /> Add playbook
        </button>
      </div>

      {!activeCp && (
        <div className="card p-10 text-center">
          <GitBranch size={32} className="text-fg-secondary mx-auto mb-3 opacity-40" />
          <p className="text-fg-secondary text-ui">No playbook attached to this case.</p>
          <button className="btn-primary mt-4 inline-flex items-center gap-2 text-label" onClick={() => setAddOpen(true)}>
            <Plus size={12} /> Attach a playbook
          </button>
        </div>
      )}

      {activeCp && (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          {/* Graph view */}
          <div className="card overflow-hidden" style={{ height: 380 }}>
            <ReactFlow
              key={graphKey}
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
              <Background color="#1a2535" gap={20} />
              <Controls showInteractive={false} />
            </ReactFlow>
          </div>

          {/* Step checklist */}
          <div className="space-y-2">
            <div className="flex items-center justify-between mb-3">
              <p className="text-ui font-semibold text-fg">{activeCp.playbook.name}</p>
              <span className="text-label text-fg-secondary">
                {doneCount(activeCp)} / {stepNodes(activeCp).length} done
              </span>
            </div>
            <ProgressBar value={doneCount(activeCp)} max={stepNodes(activeCp).length} />
            <div className="space-y-1.5 mt-3 max-h-[280px] overflow-y-auto pr-1">
              {stepNodes(activeCp).map(node => {
                const state = activeCp.step_states[node.id]
                const done = state?.done ?? false
                const comment = state?.comment ?? ''
                const expanded = expandedStep === node.id
                const draft = commentDraft[node.id] ?? comment
                const nodeData = node.data as any

                if (node.type === 'playbook_ref') {
                  const linkedId: string | undefined = nodeData.linked_playbook_id
                  const linkedName: string = nodeData.linked_playbook_name || nodeData.label || 'Linked playbook'
                  const alreadyAttached = linkedId ? !!casePlaybooks.find(cp => cp.playbook_id === linkedId) : false
                  const pbExists = linkedId ? !!allPlaybooks.find(pb => pb.id === linkedId) : false

                  return (
                    <div key={node.id} className=" border border-data-2/20 bg-data-2/5 px-3 py-2.5">
                      <div className="flex items-start gap-3">
                        <ExternalLink size={14} className="text-data-2 shrink-0 mt-0.5" />
                        <div className="flex-1 min-w-0">
                          <p className="text-label font-medium text-data-2">{nodeData.label}</p>
                          <p className="text-label text-data-2/60 mt-0.5">→ {linkedName}</p>
                          {!linkedId ? (
                            <p className="text-label text-fg-secondary/50 mt-1 flex items-center gap-1">
                              <AlertCircle size={10} /> Not linked - no playbook configured
                            </p>
                          ) : alreadyAttached ? (
                            <p className="text-label text-accent/70 mt-1 flex items-center gap-1">
                              <CheckCircle2 size={10} /> Playbook already attached to the case
                            </p>
                          ) : !pbExists ? (
                            <p className="text-label text-fg-secondary/50 mt-1 flex items-center gap-1">
                              <AlertCircle size={10} /> Playbook introuvable
                            </p>
                          ) : (
                            <button
                              className="mt-1.5 text-label px-2.5 py-1 rounded-control border border-data-2/30 text-data-2 hover:bg-data-2/10 transition-colors"
                              onClick={() => attach.mutate(linkedId)}
                              disabled={attach.isPending}
                            >
                              + Attacher au case
                            </button>
                          )}
                        </div>
                      </div>
                    </div>
                  )
                }

                return (
                  <div key={node.id} className={` border transition-colors ${done ? 'border-accent/20 bg-accent/5' : 'border-hairline bg-white/[0.02]'}`}>
                    <div className="flex items-center gap-3 px-3 py-2.5">
                      <button
                        onClick={() => updateStep.mutate({ cpId: activeCp.id, nodeId: node.id, done: !done, comment })}
                        className={`shrink-0 transition-colors ${done ? 'text-accent' : 'text-fg-secondary hover:text-fg'}`}
                      >
                        {done ? <CheckCircle2 size={16} /> : <Circle size={16} />}
                      </button>
                      <div className="flex-1 min-w-0">
                        <p className={`text-label font-medium ${done ? 'line-through text-fg-secondary' : 'text-fg'}`}>
                          {nodeData.label}
                        </p>
                        {nodeData.description && !done && (
                          <p className="text-label text-fg-secondary mt-0.5 leading-snug">{nodeData.description}</p>
                        )}
                      </div>
                      <StepAssigneePicker
                        assignee={state?.assignee}
                        users={users}
                        onChange={assignee => assignStep.mutate({ cpId: activeCp.id, nodeId: node.id, assignee })}
                        disabled={assignStep.isPending}
                      />
                      <button
                        onClick={() => setExpandedStep(expanded ? null : node.id)}
                        className="text-fg-secondary hover:text-fg transition-colors shrink-0"
                      >
                        {expanded ? <ChevronUp size={12} /> : <ChevronDown size={12} />}
                      </button>
                    </div>
                    {expanded && (
                      <div className="px-3 pb-3 border-t border-hairline pt-2">
                        <textarea
                          className="input text-label min-h-[60px] resize-y w-full"
                          placeholder="Add a comment…"
                          value={draft}
                          onChange={e => setCommentDraft(d => ({ ...d, [node.id]: e.target.value }))}
                        />
                        <button
                          className="btn-primary text-label mt-2 py-1"
                          onClick={() => {
                            updateStep.mutate({ cpId: activeCp.id, nodeId: node.id, done, comment: draft })
                            setExpandedStep(null)
                          }}
                        >
                          Save comment
                        </button>
                      </div>
                    )}
                  </div>
                )
              })}
              {stepNodes(activeCp).length === 0 && (
                <p className="text-fg-secondary text-label text-center py-4">This playbook has no steps defined.</p>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Add playbook modal */}
      <Modal open={addOpen} onClose={() => setAddOpen(false)} title="Attach a playbook" size="sm">
        <div className="space-y-3">
          {availablePlaybooks.length === 0 ? (
            <p className="text-fg-secondary text-ui py-4 text-center">All playbooks are already attached, or no playbooks exist.</p>
          ) : (
            availablePlaybooks.map(pb => (
              <button
                key={pb.id}
                onClick={() => attach.mutate(pb.id)}
                className="w-full text-left px-4 py-3 border border-hairline hover:border-accent/40 hover:bg-accent/5 transition-colors group"
              >
                <p className="text-ui font-medium text-fg group-hover:text-accent">{pb.name}</p>
                {pb.description && <p className="text-label text-fg-secondary mt-0.5">{pb.description}</p>}
                <p className="text-label text-fg-secondary/60 mt-1">{pb.nodes.length} node(s)</p>
              </button>
            ))
          )}
          <div className="flex justify-end pt-2">
            <button className="btn-secondary text-label" onClick={() => setAddOpen(false)}>Cancel</button>
          </div>
        </div>
      </Modal>
    </div>
  )
}

function ProgressBar({ value, max }: { value: number; max: number }) {
  const pct = max === 0 ? 0 : Math.round((value / max) * 100)
  return (
    <div className="h-1.5 bg-fg/10 rounded-pill overflow-hidden">
      <div
        className="h-full bg-accent rounded-pill transition-all duration-500"
        style={{ width: `${pct}%` }}
      />
    </div>
  )
}

function buildViewNodes(cp: CasePlaybook): Node[] {
  return cp.playbook.nodes.map(n => ({
    ...n,
    data: {
      ...n.data,
      done: cp.step_states[n.id]?.done ?? false,
      assignee: cp.step_states[n.id]?.assignee ?? null,
      linked_playbook_id: (n.data as any).linked_playbook_id,
      linked_playbook_name: (n.data as any).linked_playbook_name,
    },
  })) as Node[]
}
