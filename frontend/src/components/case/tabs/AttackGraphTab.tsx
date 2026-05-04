import { useState, useCallback, useEffect, useRef } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import {
  ReactFlow, Background, BackgroundVariant, Controls, MiniMap,
  addEdge, applyNodeChanges, applyEdgeChanges,
  type Node, type Edge, type OnConnect, type OnNodesChange, type OnEdgesChange,
  type Connection, type ReactFlowInstance,
} from '@xyflow/react'
import {
  Save, Plus, Trash2, Skull, StickyNote, Wand2,
  Clock, Monitor, Shield, Edit2, ChevronDown, ChevronRight,
} from 'lucide-react'
import { format } from 'date-fns'

import { attackGraphApi } from '../../../api/attackGraph'
import { timelineApi } from '../../../api/timeline'
import { assetsApi } from '../../../api/assets'
import { iocsApi } from '../../../api/iocs'
import type { TimelineEvent, Asset, IOC } from '../../../types'
import { AG_NODE_TYPES, NODE_WIDTH, type AGNodeData } from '../../attack_graph/AttackGraphNodes'
import Modal from '../../ui/Modal'
import { applyElkLayout } from '../../../utils/elkLayout'

interface Props { caseId: string }

// ── IOC color map ─────────────────────────────────────────────────────────────
const IOC_BADGE: Record<string, string> = {
  ip:          'text-red-400',
  domain:      'text-orange-400',
  url:         'text-orange-300',
  hash_md5:    'text-purple-400',
  hash_sha1:   'text-purple-400',
  hash_sha256: 'text-purple-400',
  email:       'text-blue-400',
  filename:    'text-yellow-400',
  registry:    'text-pink-400',
}

// ── Helpers ───────────────────────────────────────────────────────────────────
let _counter = 1
const nextId = () => `ag-${Date.now()}-${_counter++}`
const GRID   = 20
const snap   = (v: number) => Math.round(v / GRID) * GRID
/** Snap height UP to the next grid multiple so handles land on grid lines. */
const snapH  = (h: number) => Math.ceil(h / GRID) * GRID

// ── Collapsible section ───────────────────────────────────────────────────────
function Section({ title, count, children }: {
  title: string; count: number; children: React.ReactNode
}) {
  const [open, setOpen] = useState(true)
  return (
    <div>
      <button
        onClick={() => setOpen(o => !o)}
        className="flex items-center gap-1.5 w-full px-3 py-2 text-[10px] font-semibold uppercase tracking-widest text-accent-muted/50 hover:text-accent-muted transition-colors border-b border-white/5"
      >
        {open ? <ChevronDown size={10} /> : <ChevronRight size={10} />}
        {title}
        <span className="ml-auto font-mono">{count}</span>
      </button>
      {open && <div className="py-1">{children}</div>}
    </div>
  )
}

// ── Side-panel item with +ADD ─────────────────────────────────────────────────
function SideItem({ icon: Icon, label, sub, textCls = 'text-white/80', onAdd }: {
  icon: React.ElementType
  label: string
  sub?: string
  textCls?: string
  onAdd: () => void
}) {
  return (
    <div className="group flex items-start gap-2 px-3 py-2 hover:bg-white/[0.04] transition-colors">
      <Icon size={12} className="text-accent-muted/50 mt-0.5 shrink-0" />
      <div className="flex-1 min-w-0">
        <p className={`text-[11px] font-medium truncate leading-tight ${textCls}`}>{label}</p>
        {sub && <p className="text-[10px] text-accent-muted/40 truncate mt-0.5">{sub}</p>}
      </div>
      <button
        onClick={onAdd}
        className="opacity-0 group-hover:opacity-100 flex items-center gap-0.5 px-1.5 py-0.5 rounded text-[10px] font-medium text-accent-green border border-accent-green/40 hover:bg-accent-green/10 transition-all shrink-0"
      >
        <Plus size={9} />ADD
      </button>
    </div>
  )
}

// ── Edit form ─────────────────────────────────────────────────────────────────
interface EditForm { label: string; notes: string }

// ── Component ─────────────────────────────────────────────────────────────────
export default function AttackGraphTab({ caseId }: Props) {
  const qc = useQueryClient()

  const { data: graphData } = useQuery({ queryKey: ['attack-graph', caseId], queryFn: () => attackGraphApi.get(caseId) })
  const { data: events = [] } = useQuery({ queryKey: ['timeline', caseId], queryFn: () => timelineApi.list(caseId) })
  const { data: assets = [] } = useQuery({ queryKey: ['assets',   caseId], queryFn: () => assetsApi.list(caseId)  })
  const { data: iocs   = [] } = useQuery({ queryKey: ['iocs',     caseId], queryFn: () => iocsApi.list(caseId)    })

  // ── Graph state ───────────────────────────────────────────────────────────
  const [nodes, setNodes]         = useState<Node[]>([])
  const [edges, setEdges]         = useState<Edge[]>([])
  const [initialized, setInit]    = useState(false)
  const [selected, setSelected]   = useState<Node | null>(null)
  const [editOpen, setEditOpen]   = useState(false)
  const [editForm, setEditForm]   = useState<EditForm>({ label: '', notes: '' })
  const [saveState, setSaveState] = useState<'idle' | 'saving' | 'saved'>('idle')
  const [laying,    setLaying]    = useState(false)
  const saveTimer  = useRef<ReturnType<typeof setTimeout> | null>(null)
  /** Captured ReactFlow instance — used to get viewport center for new nodes. */
  const rfInstance = useRef<ReactFlowInstance | null>(null)
  /** Ref to the canvas wrapper div — needed for getBoundingClientRect. */
  const canvasRef  = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (graphData && !initialized) {
      // Ensure all persisted nodes have the correct fixed width
      const normalised = (graphData.nodes as Node[]).map(n => ({
        ...n,
        style: { ...((n.style as object | undefined) ?? {}), width: NODE_WIDTH },
      }))
      setNodes(normalised)
      setEdges(graphData.edges as Edge[])
      setInit(true)
    }
  }, [graphData, initialized])

  // ── RF handlers ───────────────────────────────────────────────────────────

  /**
   * When ReactFlow measures a node and its height is not already a grid
   * multiple, snap it up to the next multiple by setting style.height.
   * This ensures every handle lands exactly on a 20 px grid line.
   */
  const onNodesChange: OnNodesChange = useCallback((changes) => {
    const hasDim = changes.some(c => c.type === 'dimensions')
    setNodes(nds => {
      const updated = applyNodeChanges(changes, nds)
      if (!hasDim) return updated
      return updated.map(n => {
        const h = n.measured?.height
        if (!h) return n
        const sh = snapH(h)
        if ((n.style as Record<string, unknown>)?.height === sh) return n
        return { ...n, style: { ...(n.style ?? {}), height: sh } }
      })
    })
  }, [])

  const onEdgesChange: OnEdgesChange = useCallback(ch => setEdges(es => applyEdgeChanges(ch, es)), [])
  const onConnect: OnConnect = useCallback((p: Connection) =>
    setEdges(es => addEdge({ ...p, type: 'smoothstep', animated: true, style: { stroke: '#9FEF0080', strokeWidth: 1.5 } }, es)), [])

  // ── Viewport center helper ────────────────────────────────────────────────
  /** Convert the canvas center (screen px) to flow-space coordinates. */
  const getViewportCenter = useCallback((): { x: number; y: number } => {
    const rect = canvasRef.current?.getBoundingClientRect()
    if (!rfInstance.current || !rect) return { x: 200, y: 200 }
    return rfInstance.current.screenToFlowPosition({
      x: rect.left + rect.width  / 2,
      y: rect.top  + rect.height / 2,
    })
  }, [])

  // ── Add helpers ───────────────────────────────────────────────────────────
  const pushNode = useCallback((n: Node) => {
    setNodes(ns => [...ns, n])
  }, [])

  // NODE_WIDTH is exported from AttackGraphNodes — all nodes share the same width
  // so that React Flow knows the handle positions before layout.
  const W = NODE_WIDTH

  const addTimeline = (ev: TimelineEvent) => {
    const center = getViewportCenter()
    pushNode({
      id: nextId(), type: 'timeline',
      position: { x: snap(center.x), y: snap(center.y) },
      style: { width: W },
      data: {
        label: ev.title,
        subLabel: format(new Date(ev.event_ts), 'yyyy-MM-dd HH:mm'),
        nodeKind: 'timeline',
        notes: ev.actor ? `Actor: ${ev.actor}` : (ev.description || undefined),
        sourceId: ev.id,
      } satisfies AGNodeData,
    })
  }

  const addAsset = (a: Asset) => {
    const center = getViewportCenter()
    pushNode({
      id: nextId(), type: 'asset',
      position: { x: snap(center.x), y: snap(center.y) },
      style: { width: W },
      data: {
        label: a.name,
        subLabel: [a.ip_address, a.hostname].filter(Boolean).join(' · ') || a.type,
        nodeKind: 'asset', compromised: a.compromised, iocType: a.type, sourceId: a.id,
      } satisfies AGNodeData,
    })
  }

  const addIOC = (ioc: IOC) => {
    const center = getViewportCenter()
    pushNode({
      id: nextId(), type: 'ioc',
      position: { x: snap(center.x), y: snap(center.y) },
      style: { width: W },
      data: {
        label: ioc.value.length > 48 ? ioc.value.slice(0, 48) + '…' : ioc.value,
        subLabel: ioc.type.replace('hash_', '').toUpperCase(),
        nodeKind: 'ioc', iocType: ioc.type,
        notes: ioc.description || undefined, sourceId: ioc.id,
      } satisfies AGNodeData,
    })
  }

  const addAttacker = () => {
    const center = getViewportCenter()
    pushNode({
      id: nextId(), type: 'attacker',
      position: { x: snap(center.x), y: snap(center.y) },
      style: { width: W },
      data: { label: 'Attacker', nodeKind: 'attacker' } satisfies AGNodeData,
    })
  }

  const addNote = () => {
    const center = getViewportCenter()
    pushNode({
      id: nextId(), type: 'free',
      position: { x: snap(center.x), y: snap(center.y) },
      style: { width: W },
      data: { label: 'Note', nodeKind: 'free' } satisfies AGNodeData,
    })
  }

  // ── Edit / delete ─────────────────────────────────────────────────────────
  const openEdit = (node: Node) => {
    setSelected(node)
    const d = node.data as AGNodeData
    setEditForm({ label: d.label ?? '', notes: d.notes ?? '' })
    setEditOpen(true)
  }

  const applyEdit = () => {
    if (!selected) return
    setNodes(ns => ns.map(n =>
      n.id === selected.id
        ? {
            ...n,
            data:  { ...n.data, label: editForm.label, notes: editForm.notes },
            // Clear height so ReactFlow re-measures the new content size,
            // then the onNodesChange handler snaps it back to the grid.
            style: { ...(n.style ?? {}), height: undefined },
          }
        : n
    ))
    setEditOpen(false)
  }

  const deleteSelected = () => {
    if (!selected) return
    setNodes(ns => ns.filter(n => n.id !== selected.id))
    setEdges(es => es.filter(e => e.source !== selected.id && e.target !== selected.id))
    setSelected(null)
  }

  // ── Save ──────────────────────────────────────────────────────────────────
  const doSave = useCallback(async () => {
    setSaveState('saving')
    try {
      await attackGraphApi.save(caseId, nodes, edges)
      qc.invalidateQueries({ queryKey: ['attack-graph', caseId] })
      setSaveState('saved')
      if (saveTimer.current) clearTimeout(saveTimer.current)
      saveTimer.current = setTimeout(() => setSaveState('idle'), 2500)
    } catch { setSaveState('idle') }
  }, [caseId, nodes, edges, qc])

  // ── ELK auto-layout ───────────────────────────────────────────────────────
  const runLayout = async () => {
    setLaying(true)
    try {
      const laid = await applyElkLayout(nodes, edges, {
        direction:    'DOWN',
        layerSpacing: 60,
        nodeSpacing:  40,
      })
      setNodes(laid)
      setTimeout(() => rfInstance.current?.fitView({ padding: 0.2, duration: 300 }), 50)
    } finally {
      setLaying(false)
    }
  }

  // ─────────────────────────────────────────────────────────────────────────
  return (
    <div className="flex flex-col h-full overflow-hidden">

      {/* ── Toolbar ── proper header bar, same visual language as the rest ── */}
      <div className="shrink-0 flex items-center gap-2 px-4 py-2 bg-bg-secondary border-b border-white/5">

        {/* Left cluster: add free nodes */}
        <span className="text-[10px] text-accent-muted/40 uppercase tracking-widest">Add</span>
        <button
          onClick={addAttacker}
          className="flex items-center gap-1.5 px-2.5 py-1.5 rounded text-xs text-severity-critical border border-severity-critical/30 hover:bg-severity-critical/10 transition-colors"
        >
          <Skull size={12} /> Attacker
        </button>
        <button
          onClick={addNote}
          className="flex items-center gap-1.5 px-2.5 py-1.5 rounded text-xs text-accent-muted border border-white/10 hover:bg-white/5 hover:text-white transition-colors"
        >
          <StickyNote size={12} /> Note
        </button>

        {/* Selected node actions */}
        {selected && (
          <>
            <div className="h-5 w-px bg-white/10 mx-1" />
            <span className="text-[10px] text-accent-muted/40 uppercase tracking-widest">Selected</span>
            <button
              onClick={() => openEdit(selected)}
              className="flex items-center gap-1.5 px-2.5 py-1.5 rounded text-xs text-white/70 border border-white/10 hover:bg-white/5 transition-colors"
            >
              <Edit2 size={12} /> Edit
            </button>
            <button
              onClick={deleteSelected}
              className="flex items-center gap-1.5 px-2.5 py-1.5 rounded text-xs text-severity-critical border border-severity-critical/20 hover:bg-severity-critical/10 transition-colors"
            >
              <Trash2 size={12} /> Delete
            </button>
          </>
        )}

        {/* Right: auto-layout + save */}
        <div className="ml-auto flex items-center gap-2">
          <button
            onClick={runLayout}
            disabled={laying || nodes.length === 0}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded border border-white/10 text-xs text-accent-muted hover:text-white hover:border-white/25 disabled:opacity-40 transition-colors"
            title="Arrange nodes automatically with ELK layered layout"
          >
            <Wand2 size={12} />
            {laying ? 'Laying out…' : 'Auto layout'}
          </button>
          <button
            onClick={doSave}
            disabled={saveState === 'saving'}
            className={`flex items-center gap-1.5 px-3 py-1.5 rounded text-xs font-medium border transition-colors ${
              saveState === 'saved'
                ? 'bg-accent-green/10 text-accent-green border-accent-green/40'
                : 'bg-accent-green/10 text-white border-accent-green/50 hover:bg-accent-green/20'
            }`}
          >
            <Save size={12} />
            {saveState === 'saving' ? 'Saving…' : saveState === 'saved' ? 'Saved ✓' : 'Save graph'}
          </button>
        </div>
      </div>

      {/* ── Body: left panel | canvas | right panel ── */}
      <div className="flex flex-1 overflow-hidden">

        {/* Left panel — Assets & IOCs */}
        <div className="w-52 shrink-0 flex flex-col overflow-hidden border-r border-white/5 bg-bg-secondary">
          <div className="px-3 py-2.5 border-b border-white/5 shrink-0">
            <p className="text-[10px] font-semibold uppercase tracking-widest text-accent-muted/70">
              Assets &amp; IOCs
            </p>
          </div>
          <div className="flex-1 overflow-y-auto">
            <Section title="Assets" count={assets.length}>
              {assets.length === 0
                ? <p className="px-3 py-2 text-[11px] italic text-accent-muted/30">No assets in this case</p>
                : assets.map(a => (
                  <SideItem
                    key={a.id}
                    icon={Monitor}
                    label={a.name}
                    sub={[a.ip_address, a.hostname].filter(Boolean).join(' · ') || a.type}
                    textCls={a.compromised ? 'text-severity-critical/80' : 'text-white/80'}
                    onAdd={() => addAsset(a)}
                  />
                ))
              }
            </Section>
            <Section title="IOCs" count={iocs.length}>
              {iocs.length === 0
                ? <p className="px-3 py-2 text-[11px] italic text-accent-muted/30">No IOCs in this case</p>
                : iocs.map(ioc => (
                  <SideItem
                    key={ioc.id}
                    icon={Shield}
                    label={ioc.value.length > 28 ? ioc.value.slice(0, 28) + '…' : ioc.value}
                    sub={ioc.type.replace('hash_', '').toUpperCase()}
                    textCls={IOC_BADGE[ioc.type] ?? 'text-accent-muted'}
                    onAdd={() => addIOC(ioc)}
                  />
                ))
              }
            </Section>
          </div>
        </div>

        {/* Canvas */}
        <div ref={canvasRef} className="flex-1 min-w-0">
          <ReactFlow
            nodes={nodes}
            edges={edges}
            onNodesChange={onNodesChange}
            onEdgesChange={onEdgesChange}
            onConnect={onConnect}
            onInit={inst => { rfInstance.current = inst }}
            onNodeClick={(_, node) => setSelected(prev => prev?.id === node.id ? null : node)}
            onPaneClick={() => setSelected(null)}
            onNodeDoubleClick={(_, node) => openEdit(node)}
            nodeTypes={AG_NODE_TYPES}
            defaultEdgeOptions={{ type: 'smoothstep', animated: true, style: { stroke: '#9FEF0060', strokeWidth: 1.5 } }}
            snapToGrid
            snapGrid={[20, 20]}
            fitView
            fitViewOptions={{ padding: 0.25 }}
            style={{ background: '#0B121F', width: '100%', height: '100%' }}
            deleteKeyCode={null}
          >
            <Background variant={BackgroundVariant.Dots} gap={20} size={1} color="#1a2535" />
            <Controls
              showInteractive={false}
              style={{ background: 'rgba(15,22,36,0.9)', border: '1px solid rgba(255,255,255,0.07)', borderRadius: 8 }}
            />
            <MiniMap
              nodeColor={(n) => {
                const k = (n.data as AGNodeData)?.nodeKind
                return k === 'timeline' ? '#9FEF00' : k === 'asset' ? '#3b82f6'
                  : k === 'ioc' ? '#a855f7' : k === 'attacker' ? '#ef4444' : '#4b5563'
              }}
              maskColor="rgba(11,18,31,0.75)"
              style={{ background: '#111827', border: '1px solid rgba(255,255,255,0.07)', borderRadius: 8 }}
            />
          </ReactFlow>
        </div>

        {/* Right panel — Timeline */}
        <div className="w-56 shrink-0 flex flex-col overflow-hidden border-l border-white/5 bg-bg-secondary">
          <div className="px-3 py-2.5 border-b border-white/5 shrink-0">
            <p className="text-[10px] font-semibold uppercase tracking-widest text-accent-muted/70">
              Timeline
            </p>
          </div>
          <div className="flex-1 overflow-y-auto divide-y divide-white/5">
            {events.length === 0 && (
              <p className="px-3 py-3 text-[11px] italic text-accent-muted/30">No timeline events</p>
            )}
            {events.map(ev => (
              <div key={ev.id} className="group flex items-start gap-2 px-3 py-2.5 hover:bg-white/[0.04] transition-colors">
                <Clock size={11} className="text-accent-green/50 mt-0.5 shrink-0" />
                <div className="flex-1 min-w-0">
                  <p className="text-[10px] font-mono text-accent-green/60 mb-0.5 leading-none">
                    {format(new Date(ev.event_ts), 'MM-dd HH:mm')}
                  </p>
                  <p className="text-[11px] font-medium text-white/90 leading-snug line-clamp-2">{ev.title}</p>
                  {ev.actor && (
                    <p className="text-[10px] text-accent-muted/40 truncate mt-0.5">{ev.actor}</p>
                  )}
                </div>
                <button
                  onClick={() => addTimeline(ev)}
                  className="opacity-0 group-hover:opacity-100 flex items-center gap-0.5 px-1.5 py-0.5 rounded text-[10px] font-medium text-accent-green border border-accent-green/40 hover:bg-accent-green/10 transition-all shrink-0 mt-0.5"
                >
                  <Plus size={9} />ADD
                </button>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* ── Edit node modal ── */}
      <Modal open={editOpen} onClose={() => setEditOpen(false)} title="Edit node" size="sm">
        <div className="space-y-4">
          <div>
            <label className="label">Label</label>
            <input
              className="input"
              value={editForm.label}
              onChange={e => setEditForm(f => ({ ...f, label: e.target.value }))}
              onKeyDown={e => e.key === 'Enter' && applyEdit()}
              autoFocus
            />
          </div>
          <div>
            <label className="label">Notes</label>
            <textarea
              className="input resize-none h-20"
              placeholder="Additional context, description…"
              value={editForm.notes}
              onChange={e => setEditForm(f => ({ ...f, notes: e.target.value }))}
            />
          </div>
          <div className="flex justify-end gap-3 pt-1">
            <button className="btn-secondary" onClick={() => setEditOpen(false)}>Cancel</button>
            <button className="btn-primary" onClick={applyEdit}>Apply</button>
          </div>
        </div>
      </Modal>
    </div>
  )
}
