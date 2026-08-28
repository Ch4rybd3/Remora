import { useState, useCallback, useEffect, useRef } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import {
  ReactFlow, Background, BackgroundVariant, Controls, MiniMap,
  addEdge, applyNodeChanges, applyEdgeChanges,
  type Node, type Edge, type OnConnect, type OnNodesChange, type OnEdgesChange,
  type Connection, type ReactFlowInstance,
} from '@xyflow/react'
import {
  ImageDown, Save, Plus, Trash2, Skull, SquareDashed, StickyNote, Wand2,
  Clock, Monitor, Shield, Edit2, ChevronDown, ChevronRight,
} from '../../../ui/icons'
import { fmtDateTime, fmtCompactShort } from '../../../utils/dateUtils'

import { exportGraphPng, renderGraphBlob } from '../../graph/exportGraphImage'
import { FRAME_COLORS } from '../../graph/FrameNode'
import { color } from '../../../styles/tokens'
import { attackGraphApi } from '../../../api/attackGraph'
import { timelineApi } from '../../../api/timeline'
import { assetsApi } from '../../../api/assets'
import { iocsApi } from '../../../api/iocs'
import type { TimelineEvent, Asset, IOC } from '../../../types'
import { AG_NODE_TYPES, NODE_WIDTH, type AGNodeData } from '../../attack_graph/AttackGraphNodes'
import Modal from '../../ui/Modal'
import { applyElkLayout } from '../../../utils/elkLayout'
import { EDGE_TYPES, EdgeEditContext } from '../../graph/ReshapableEdge'
import { EdgeShapePicker, useEdgeShaping } from '../../graph/useEdgeShaping'
import {
  CANVAS_INTERACTION, GRAPH_GRID, useGraphClipboard,
} from '../../graph/useGraphClipboard'

interface Props { caseId: string }

// ── IOC color map ─────────────────────────────────────────────────────────────
const IOC_BADGE: Record<string, string> = {
  ip:          'text-severity-critical',
  domain:      'text-severity-high',
  url:         'text-severity-high',
  hash_md5:    'text-data-2',
  hash_sha1:   'text-data-2',
  hash_sha256: 'text-data-2',
  email:       'text-severity-low',
  filename:    'text-severity-medium',
  registry:    'text-data-3',
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
        className="flex items-center gap-1.5 w-full px-3 py-2 text-label font-semibold uppercase tracking-widest text-fg-secondary/50 hover:text-fg-secondary transition-colors border-b border-hairline"
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
function SideItem({ icon: Icon, label, sub, textCls = 'text-fg/80', onAdd }: {
  icon: React.ElementType
  label: string
  sub?: string
  textCls?: string
  onAdd: () => void
}) {
  return (
    <div className="group flex items-start gap-2 px-3 py-2 hover:bg-white/[0.04] transition-colors">
      <Icon size={12} className="text-fg-secondary/50 mt-0.5 shrink-0" />
      <div className="flex-1 min-w-0">
        <p className={`text-label font-medium truncate leading-tight ${textCls}`}>{label}</p>
        {sub && <p className="text-label text-fg-secondary/40 truncate mt-0.5">{sub}</p>}
      </div>
      <button
        onClick={onAdd}
        className="opacity-0 group-hover:opacity-100 flex items-center gap-0.5 px-1.5 py-0.5 rounded-control text-label font-medium text-accent border border-accent/40 hover:bg-accent/10 transition-all shrink-0"
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
  const [selectedEdges, setSelectedEdges] = useState<Edge[]>([])
  const [selectedNodes, setSelectedNodes] = useState<Node[]>([])
  const [frameColor, setFrameColor] = useState<string>(FRAME_COLORS[0])
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

  // The canvas snaps to a 20px grid, so a dragged waypoint should land on it too.
  const snapToGridStep = useCallback((v: number) => Math.round(v / 20) * 20, [])
  const { edgeEditApi, currentShape, waypointCount, applyShape, clearWaypoints } =
    useEdgeShaping(setEdges, selectedEdges, snapToGridStep)
  const onConnect: OnConnect = useCallback((p: Connection) =>
    setEdges(es => addEdge({ ...p, type: 'reshapable', animated: true }, es)), [])

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
        subLabel: fmtDateTime(ev.event_ts),
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

  /**
   * A grouping zone. It goes behind everything else and is not selectable by a
   * rubber-band drag, or dragging across the canvas would pick up the zone
   * instead of the nodes inside it.
   */
  const addFrame = () => {
    const center = getViewportCenter()
    pushNode({
      id: nextId(), type: 'frame',
      position: { x: snap(center.x - 160), y: snap(center.y - 100) },
      style: { width: 360, height: 220, zIndex: -1 },
      selectable: true,
      draggable: true,
      data: { label: 'Zone', color: frameColor, nodeKind: 'free' } as unknown as AGNodeData,
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

  // ── PNG export ────────────────────────────────────────────────────────────
  // Rasterises the real canvas, so the image is the graph as arranged: same
  // node shapes, same edge waypoints, same zone colours, same theme. The
  // server-side renderer redrew it from the stored coordinates and never quite
  // matched.
  const [exportingPng, setExportingPng] = useState(false)
  const exportPng = useCallback(async () => {
    setExportingPng(true)
    try {
      await exportGraphPng(rfInstance.current?.getNodes() ?? nodes, 'attack-graph.png')
    } finally {
      setExportingPng(false)
    }
  }, [nodes])

  // ── Copy / paste ──────────────────────────────────────────────────────────
  useGraphClipboard({
    selectedNodes,
    edges,
    setNodes,
    setEdges,
    makeNodeId: () => `ag-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    enabled: !editOpen,
  })

  // ── Save ──────────────────────────────────────────────────────────────────
  const doSave = useCallback(async () => {
    setSaveState('saving')
    try {
      await attackGraphApi.save(caseId, nodes, edges)

      // Snapshot the canvas alongside the coordinates, so the report embeds the
      // graph as arranged rather than a server-side redrawing of it. A failure
      // here must not fail the save: the graph is the data, the picture is a
      // convenience, and the report falls back to rendering server-side.
      try {
        const blob = await renderGraphBlob(rfInstance.current?.getNodes() ?? nodes)
        if (blob) await attackGraphApi.saveSnapshot(caseId, blob)
      } catch {
        // Snapshot unavailable — the report will render from coordinates.
      }

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
      <div className="shrink-0 flex items-center gap-2 px-4 py-2 bg-panel border-b border-hairline">

        {/* Left cluster: add free nodes */}
        <span className="text-label text-fg-secondary/40 uppercase tracking-widest">Add</span>
        <button
          onClick={addAttacker}
          className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-control text-label text-severity-critical border border-severity-critical/30 hover:bg-severity-critical/10 transition-colors"
        >
          <Skull size={12} /> Attacker
        </button>
        <button
          onClick={addNote}
          className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-control text-label text-fg-secondary border border-hairline hover:bg-fg/5 hover:text-fg transition-colors"
        >
          <StickyNote size={12} /> Note
        </button>

        {/* Grouping zone, with its colour — the same control the playbook has */}
        <div className="flex items-center gap-1.5 px-2 py-1 rounded-control border border-hairline">
          <SquareDashed size={11} className="text-fg-muted shrink-0" />
          {FRAME_COLORS.map(c => (
            <button
              key={c}
              onClick={() => setFrameColor(c)}
              title={`Zone colour ${c}`}
              aria-label={`Zone colour ${c}`}
              className="w-3.5 h-3.5 rounded-control transition-all"
              style={{
                backgroundColor: c,
                outline: frameColor === c ? `2px solid ${c}` : '2px solid transparent',
                outlineOffset: 2,
              }}
            />
          ))}
          <button
            onClick={addFrame}
            className="ml-1 text-label text-fg-secondary hover:text-fg border border-hairline
                       hover:border-strong px-2 py-0.5 rounded-control transition-colors"
          >
            + Zone
          </button>
        </div>

        {/* Selected node actions */}
        {selected && (
          <>
            <div className="h-5 w-px bg-fg/10 mx-1" />
            <span className="text-label text-fg-secondary/40 uppercase tracking-widest">Selected</span>
            <button
              onClick={() => openEdit(selected)}
              className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-control text-label text-fg/70 border border-hairline hover:bg-fg/5 transition-colors"
            >
              <Edit2 size={12} /> Edit
            </button>
            <button
              onClick={deleteSelected}
              className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-control text-label text-severity-critical border border-severity-critical/20 hover:bg-severity-critical/10 transition-colors"
            >
              <Trash2 size={12} /> Delete
            </button>
          </>
        )}

        {/* Right: edge shaping, auto-layout, save */}
        <div className="ml-auto flex items-center gap-2">
          <EdgeShapePicker
            currentShape={currentShape}
            waypointCount={waypointCount}
            onApply={applyShape}
            onClear={clearWaypoints}
          />
          <button
            onClick={exportPng}
            disabled={exportingPng || nodes.length === 0}
            className="btn-ghost flex items-center gap-1.5 disabled:opacity-40"
            title="Download the graph as a PNG — the same image the report embeds"
          >
            <ImageDown size={12} />
            {exportingPng ? 'Exporting...' : 'Export PNG'}
          </button>
          <button
            onClick={runLayout}
            disabled={laying || nodes.length === 0}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-control border border-hairline text-label text-fg-secondary hover:text-fg hover:border-strong disabled:opacity-40 transition-colors"
            title="Arrange nodes automatically with ELK layered layout"
          >
            <Wand2 size={12} />
            {laying ? 'Laying out…' : 'Auto layout'}
          </button>
          <button
            onClick={doSave}
            disabled={saveState === 'saving'}
            className={`flex items-center gap-1.5 px-3 py-1.5 rounded-control text-label font-medium border transition-colors ${ saveState === 'saved'
                ? 'bg-accent/10 text-accent border-accent/40'
                : 'bg-accent/10 text-fg border-accent/50 hover:bg-accent/20'
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
        <div className="w-52 shrink-0 flex flex-col overflow-hidden border-r border-hairline bg-panel">
          <div className="px-3 py-2.5 border-b border-hairline shrink-0">
            <p className="text-label font-semibold uppercase tracking-widest text-fg-secondary/70">
              Assets &amp; IOCs
            </p>
          </div>
          <div className="flex-1 overflow-y-auto">
            <Section title="Assets" count={assets.length}>
              {assets.length === 0
                ? <p className="px-3 py-2 text-label italic text-fg-secondary/30">No assets in this case</p>
                : assets.map(a => (
                  <SideItem
                    key={a.id}
                    icon={Monitor}
                    label={a.name}
                    sub={[a.ip_address, a.hostname].filter(Boolean).join(' · ') || a.type}
                    textCls={a.compromised ? 'text-severity-critical/80' : 'text-fg/80'}
                    onAdd={() => addAsset(a)}
                  />
                ))
              }
            </Section>
            <Section title="IOCs" count={iocs.length}>
              {iocs.length === 0
                ? <p className="px-3 py-2 text-label italic text-fg-secondary/30">No IOCs in this case</p>
                : iocs.map(ioc => (
                  <SideItem
                    key={ioc.id}
                    icon={Shield}
                    label={ioc.value.length > 28 ? ioc.value.slice(0, 28) + '…' : ioc.value}
                    sub={ioc.type.replace('hash_', '').toUpperCase()}
                    textCls={IOC_BADGE[ioc.type] ?? 'text-fg-secondary'}
                    onAdd={() => addIOC(ioc)}
                  />
                ))
              }
            </Section>
          </div>
        </div>

        {/* Canvas */}
        <div ref={canvasRef} className="flex-1 min-w-0">
          <EdgeEditContext.Provider value={edgeEditApi}>
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
            onSelectionChange={({ nodes: selN, edges: selE }) => { setSelectedNodes(selN); setSelectedEdges(selE) }}
            nodeTypes={AG_NODE_TYPES}
            edgeTypes={EDGE_TYPES}
            defaultEdgeOptions={{ type: 'reshapable', animated: true }}
            {...CANVAS_INTERACTION}
            fitView
            fitViewOptions={{ padding: 0.25 }}
            style={{ width: '100%', height: '100%' }}
          >
            <Background variant={BackgroundVariant.Dots} gap={GRAPH_GRID} size={1} color={color('--border-hairline')} />
            <Controls
              showInteractive={false}
              style={{ background: 'rgba(15,22,36,0.9)', border: '1px solid rgba(255,255,255,0.07)', borderRadius: 8 }}
            />
            <MiniMap
              nodeColor={(n) => {
                const k = (n.data as AGNodeData)?.nodeKind
                return k === 'timeline' ? '#2DD4BF' : k === 'asset' ? '#3b82f6'
                  : k === 'ioc' ? '#a855f7' : k === 'attacker' ? '#ef4444' : '#4b5563'
              }}
              maskColor="rgba(11,18,31,0.75)"
              style={{ background: '#111827', border: '1px solid rgba(255,255,255,0.07)', borderRadius: 8 }}
            />
          </ReactFlow>
          </EdgeEditContext.Provider>
        </div>

        {/* Right panel — Timeline */}
        <div className="w-56 shrink-0 flex flex-col overflow-hidden border-l border-hairline bg-panel">
          <div className="px-3 py-2.5 border-b border-hairline shrink-0">
            <p className="text-label font-semibold uppercase tracking-widest text-fg-secondary/70">
              Timeline
            </p>
          </div>
          <div className="flex-1 overflow-y-auto divide-y divide-hairline">
            {events.length === 0 && (
              <p className="px-3 py-3 text-label italic text-fg-secondary/30">No timeline events</p>
            )}
            {events.map(ev => (
              <div key={ev.id} className="group flex items-start gap-2 px-3 py-2.5 hover:bg-white/[0.04] transition-colors">
                <Clock size={11} className="text-accent/50 mt-0.5 shrink-0" />
                <div className="flex-1 min-w-0">
                  <p className="text-label font-mono text-accent/60 mb-0.5 leading-none">
                    {fmtCompactShort(ev.event_ts)}
                  </p>
                  <p className="text-label font-medium text-fg/90 leading-snug line-clamp-2">{ev.title}</p>
                  {ev.actor && (
                    <p className="text-label text-fg-secondary/40 truncate mt-0.5">{ev.actor}</p>
                  )}
                </div>
                <button
                  onClick={() => addTimeline(ev)}
                  className="opacity-0 group-hover:opacity-100 flex items-center gap-0.5 px-1.5 py-0.5 rounded-control text-label font-medium text-accent border border-accent/40 hover:bg-accent/10 transition-all shrink-0 mt-0.5"
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
