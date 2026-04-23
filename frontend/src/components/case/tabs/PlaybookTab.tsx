import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { ReactFlow, Background, Controls, type Node, type Edge } from '@xyflow/react'
import '@xyflow/react/dist/style.css'
import { Plus, Trash2, GitBranch, CheckCircle2, Circle, ChevronDown, ChevronUp, X } from 'lucide-react'
import { playbooksApi, type CasePlaybook, type Playbook } from '../../../api/playbooks'
import { NODE_TYPES } from '../../playbook/PlaybookNodes'
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
    enabled: addOpen,
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

  const activeCp = casePlaybooks.find(cp => cp.id === activeTab) ?? casePlaybooks[0] ?? null
  const availablePlaybooks = allPlaybooks.filter(pb => !casePlaybooks.find(cp => cp.playbook_id === pb.id))

  const stepNodes = (cp: CasePlaybook) =>
    cp.playbook.nodes.filter(n => n.type === 'step' || n.type === 'decision')

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
            className={`flex items-center gap-2 px-3 py-1.5 rounded text-xs transition-colors ${
              (activeCp?.id === cp.id)
                ? 'bg-accent-green/10 text-accent-green border border-accent-green/30'
                : 'bg-white/5 text-accent-muted border border-white/10 hover:bg-white/10'
            }`}
          >
            <GitBranch size={12} />
            {cp.playbook.name}
            <span className="text-[10px] opacity-60">
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
          className="flex items-center gap-1.5 px-3 py-1.5 rounded text-xs border border-dashed border-white/20 text-accent-muted hover:text-white hover:border-white/40 transition-colors"
        >
          <Plus size={12} /> Add playbook
        </button>
      </div>

      {!activeCp && (
        <div className="card p-10 text-center">
          <GitBranch size={32} className="text-accent-muted mx-auto mb-3 opacity-40" />
          <p className="text-accent-muted text-sm">No playbook attached to this case.</p>
          <button className="btn-primary mt-4 inline-flex items-center gap-2 text-xs" onClick={() => setAddOpen(true)}>
            <Plus size={12} /> Attach a playbook
          </button>
        </div>
      )}

      {activeCp && (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          {/* Graph view */}
          <div className="card overflow-hidden" style={{ height: 380 }}>
            <ReactFlow
              nodes={buildViewNodes(activeCp)}
              edges={activeCp.playbook.edges as Edge[]}
              nodeTypes={NODE_TYPES}
              fitView
              nodesDraggable={false}
              nodesConnectable={false}
              elementsSelectable={false}
              style={{ background: '#0B121F' }}
            >
              <Background color="#1a2535" gap={20} />
              <Controls showInteractive={false} style={{ background: '#111b2b', border: '1px solid rgba(255,255,255,0.1)' }} />
            </ReactFlow>
          </div>

          {/* Step checklist */}
          <div className="space-y-2">
            <div className="flex items-center justify-between mb-3">
              <p className="text-sm font-semibold text-white">{activeCp.playbook.name}</p>
              <span className="text-xs text-accent-muted">
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

                return (
                  <div key={node.id} className={`rounded-lg border transition-colors ${done ? 'border-accent-green/20 bg-accent-green/5' : 'border-white/10 bg-white/[0.02]'}`}>
                    <div className="flex items-center gap-3 px-3 py-2.5">
                      <button
                        onClick={() => updateStep.mutate({ cpId: activeCp.id, nodeId: node.id, done: !done, comment })}
                        className={`shrink-0 transition-colors ${done ? 'text-accent-green' : 'text-accent-muted hover:text-white'}`}
                      >
                        {done ? <CheckCircle2 size={16} /> : <Circle size={16} />}
                      </button>
                      <div className="flex-1 min-w-0">
                        <p className={`text-xs font-medium ${done ? 'line-through text-accent-muted' : 'text-white'}`}>
                          {(node.data as any).label}
                        </p>
                        {(node.data as any).description && !done && (
                          <p className="text-[10px] text-accent-muted mt-0.5 leading-snug">{(node.data as any).description}</p>
                        )}
                      </div>
                      <button
                        onClick={() => setExpandedStep(expanded ? null : node.id)}
                        className="text-accent-muted hover:text-white transition-colors shrink-0"
                      >
                        {expanded ? <ChevronUp size={12} /> : <ChevronDown size={12} />}
                      </button>
                    </div>
                    {expanded && (
                      <div className="px-3 pb-3 border-t border-white/5 pt-2">
                        <textarea
                          className="input text-xs min-h-[60px] resize-y w-full"
                          placeholder="Add a comment…"
                          value={draft}
                          onChange={e => setCommentDraft(d => ({ ...d, [node.id]: e.target.value }))}
                        />
                        <button
                          className="btn-primary text-[10px] mt-2 py-1"
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
                <p className="text-accent-muted text-xs text-center py-4">This playbook has no steps defined.</p>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Add playbook modal */}
      <Modal open={addOpen} onClose={() => setAddOpen(false)} title="Attach a playbook" size="sm">
        <div className="space-y-3">
          {availablePlaybooks.length === 0 ? (
            <p className="text-accent-muted text-sm py-4 text-center">All playbooks are already attached, or no playbooks exist.</p>
          ) : (
            availablePlaybooks.map(pb => (
              <button
                key={pb.id}
                onClick={() => attach.mutate(pb.id)}
                className="w-full text-left px-4 py-3 rounded-lg border border-white/10 hover:border-accent-green/40 hover:bg-accent-green/5 transition-colors group"
              >
                <p className="text-sm font-medium text-white group-hover:text-accent-green">{pb.name}</p>
                {pb.description && <p className="text-xs text-accent-muted mt-0.5">{pb.description}</p>}
                <p className="text-[10px] text-accent-muted/60 mt-1">{pb.nodes.length} node(s)</p>
              </button>
            ))
          )}
          <div className="flex justify-end pt-2">
            <button className="btn-secondary text-xs" onClick={() => setAddOpen(false)}>Cancel</button>
          </div>
        </div>
      </Modal>
    </div>
  )
}

function ProgressBar({ value, max }: { value: number; max: number }) {
  const pct = max === 0 ? 0 : Math.round((value / max) * 100)
  return (
    <div className="h-1.5 bg-white/10 rounded-full overflow-hidden">
      <div
        className="h-full bg-accent-green rounded-full transition-all duration-500"
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
    },
  })) as Node[]
}
