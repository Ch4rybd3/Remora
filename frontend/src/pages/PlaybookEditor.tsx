import { useState, useCallback, useMemo, useRef, useEffect } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import {
  ReactFlow, Background, BackgroundVariant, Controls, MiniMap,
  addEdge, applyNodeChanges, applyEdgeChanges, useUpdateNodeInternals,
  type Node, type Edge, type OnConnect, type OnNodesChange, type OnEdgesChange,
  type Connection, type ReactFlowInstance, type OnSelectionChangeFunc,
} from '@xyflow/react'

// Must be rendered inside <ReactFlow> so the hook has access to the RF context.
function NodeInternalsSync({ trigger, nodeIds }: { trigger: number; nodeIds: string[] }) {
  const updateNodeInternals = useUpdateNodeInternals()
  useEffect(() => {
    if (trigger > 0) requestAnimationFrame(() => updateNodeInternals(nodeIds))
  }, [trigger])  
  return null
}
import { ArrowLeft, Save, Plus, Trash2, GitBranch, Wand2, Link2Off, ArrowDown, ArrowRight, ImageDown, SquareDashed, Spline } from 'lucide-react'
import { playbooksApi, type PlaybookNode, type PlaybookEdge } from '../api/playbooks'
import { NODE_TYPES, LayoutDirContext } from '../components/playbook/PlaybookNodes'
import {
  EDGE_TYPES, EDGE_SHAPES, PlaybookEdgeEditContext,
  edgeShape, edgeWaypoints,
  type EdgeShape, type PlaybookEdgeData,
} from '../components/playbook/PlaybookEdges'
import { applyElkLayout } from '../utils/elkLayout'
import { renderPlaybookToCanvas } from '../utils/playbookExport'
import Modal from '../components/ui/Modal'

// ── Constants ─────────────────────────────────────────────────────────────────

const GRID      = 20        // visual grid dots + dimension snap (20 px)
const MOVE_SNAP = GRID / 2  // 10 px — position snap (finer movement)

/** Snap a POSITION coordinate to the movement grid (10 px). */
const snap  = (v: number) => Math.round(v / MOVE_SNAP) * MOVE_SNAP
/** Snap a height UP to the next 20 px multiple (auto-measured nodes). */
const snapH = (h: number) => Math.ceil(h / GRID) * GRID
/** Snap an explicit DIMENSION (resize) to the nearest 20 px. */
const snapR = (v: number) => Math.round(v / GRID) * GRID

/** Default widths so all nodes have the same handle alignment as Decision (160 px). */
const NODE_DEFAULT_WIDTH: Partial<Record<string, number>> = {
  step:         160,
  remediation:  160,
  decision:     160,
  start:        160,
  end:          160,
  playbook_ref: 160,
}

const NODE_PALETTE = [
  { type: 'start',        label: 'Start',        color: 'text-accent-green' },
  { type: 'step',         label: 'Analyse',      color: 'text-white' },
  { type: 'decision',     label: 'Decision',     color: 'text-severity-medium' },
  { type: 'remediation',  label: 'Remediation',  color: 'text-blue-400' },
  { type: 'playbook_ref', label: 'Playbook →',   color: 'text-purple-400' },
  { type: 'end',          label: 'End',          color: 'text-severity-critical' },
] as const

/**
 * Strip ReactFlow runtime-only properties before saving/exporting a node.
 * `measured`, `positionAbsolute`, `selected`, `dragging`, `initialized` are
 * set at runtime and must not be persisted — they confuse ReactFlow on reload.
 */
function cleanNode(n: Node): Omit<Node, 'measured' | 'positionAbsolute' | 'selected' | 'dragging' | 'initialized'> {
   
  const { measured, positionAbsolute, selected, dragging, initialized, ...rest } = n as Node & {
    positionAbsolute?: unknown; initialized?: unknown
  }
  return rest
}

/**
 * Same idea for edges: `selected` is transient UI state and must not be
 * persisted, or a reloaded playbook comes back with links pre-highlighted.
 * `data` (shape + waypoints) is authored content and is kept.
 */
function cleanEdge(e: Edge): Omit<Edge, 'selected'> {
   
  const { selected, ...rest } = e
  return rest
}

const FRAME_COLORS: string[] = [
  '#3b82f6',  // blue
  '#22c55e',  // green
  '#f97316',  // orange
  '#ef4444',  // red
  '#a855f7',  // purple
  '#eab308',  // yellow
  '#6b7280',  // gray
]

// ── Component ─────────────────────────────────────────────────────────────────

export default function PlaybookEditor() {
  const { id } = useParams<{ id: string }>()
  const navigate = useNavigate()
  const qc = useQueryClient()
  const isNew = !id || id === 'new'

  const [name,        setName]        = useState('')
  const [description, setDescription] = useState('')
  const [nodes,       setNodes]       = useState<Node[]>([])
  const [edges,       setEdges]       = useState<Edge[]>([])

  // ── Selection (multi-select aware) ────────────────────────────────────────
  const [selNodes,     setSelNodes]     = useState<Node[]>([])
  const [selEdges,     setSelEdges]     = useState<Edge[]>([])
  const selectedNode = selNodes.length === 1 ? selNodes[0] : null

  // ── Edit modal ────────────────────────────────────────────────────────────
  const [editNodeOpen, setEditNodeOpen] = useState(false)
  const [nodeForm, setNodeForm] = useState({
    label:                '',
    description:          '',
    color:                FRAME_COLORS[0],
    linked_playbook_id:   '',   // for playbook_ref
    linked_playbook_name: '',   // for playbook_ref (future name)
  })

  // ── Frame controls (top bar) ──────────────────────────────────────────────
  const [frameColor, setFrameColor] = useState<string>(FRAME_COLORS[0])

  const [initialized, setInitialized] = useState(false)
  const [laying,      setLaying]      = useState(false)
  const [layoutDir,   setLayoutDir]   = useState<'DOWN' | 'RIGHT'>('DOWN')
  const [exporting,   setExporting]   = useState(false)

  const [updateInternalsTrigger, setUpdateInternalsTrigger] = useState(0)

  const idCounter    = useRef(1)
  const rfInstance   = useRef<ReactFlowInstance | null>(null)
  const canvasRef    = useRef<HTMLDivElement>(null)
  const clipboardRef = useRef<{ nodes: Node[]; edges: Edge[] } | null>(null)

  // ── Load existing playbook ─────────────────────────────────────────────────

  const { data: pbData } = useQuery({
    queryKey: ['playbook', id],
    queryFn:  () => playbooksApi.get(id!),
    enabled:  !isNew && !!id,
  })

  // ── All playbooks (for playbook_ref picker) ────────────────────────────────
  const { data: allPlaybooks = [] } = useQuery({
    queryKey: ['playbooks'],
    queryFn:  playbooksApi.list,
  })

  useEffect(() => {
    if (pbData && !initialized) {
      setName(pbData.name)
      setDescription(pbData.description)
      setNodes(pbData.nodes as Node[])
      setEdges(pbData.edges as Edge[])
      if (pbData.layout_dir === 'RIGHT' || pbData.layout_dir === 'DOWN') {
        setLayoutDir(pbData.layout_dir)
      }
      setInitialized(true)
    }
  }, [pbData, initialized])

  // ── Save ──────────────────────────────────────────────────────────────────

  const save = useMutation({
    mutationFn: () => {
      const payload = {
        name,
        description,
        layout_dir: layoutDir,
        nodes: nodes.map(cleanNode) as unknown as PlaybookNode[],
        edges: edges.map(cleanEdge) as unknown as PlaybookEdge[],
      }
      return isNew ? playbooksApi.create(payload) : playbooksApi.update(id!, payload)
    },
    onSuccess: (pb) => {
      qc.invalidateQueries({ queryKey: ['playbooks'] })
      if (isNew) navigate(`/playbooks/${pb.id}/edit`, { replace: true })
    },
  })

  // ── ReactFlow handlers ────────────────────────────────────────────────────

  /**
   * Snap node dimensions after any change:
   *  - style.height (explicit, from NodeResizer) → snapDim (10 px)
   *  - measured.height (auto-measured)           → snapH   (20 px, ceil)
   *  - style.width  (explicit, from NodeResizer) → snapDim (10 px)
   *
   * This ensures nodes always align on the movement grid after resize,
   * fixing the visual misalignment between Analyse and Decision nodes.
   */
  const onNodesChange: OnNodesChange = useCallback((changes) => {
    setNodes(nds => {
      const updated = applyNodeChanges(changes, nds)
      const hasDim = changes.some(c => c.type === 'dimensions')
      if (!hasDim) return updated
      return updated.map(n => {
        // Frame nodes manage their own dimensions — only snap if user has resized them
        const s = (n.style ?? {}) as Record<string, unknown>
        const styleH = typeof s.height === 'number' ? s.height : undefined
        const styleW = typeof s.width  === 'number' ? s.width  : undefined
        const measH  = n.measured?.height

        // Explicit resize: snap to 10 px. Auto-measured: snap UP to 20 px.
        const targetH = styleH !== undefined
          ? snapR(styleH)   // resize → round to nearest 20 px
          : measH !== undefined
            ? snapH(measH)  // auto-measure → ceil to next 20 px
            : undefined
        const targetW = styleW !== undefined ? snapR(styleW) : undefined

        if (s.height === targetH && s.width === targetW) return n
        return { ...n, style: { ...s, height: targetH, width: targetW } }
      })
    })
  }, [])

  const onEdgesChange: OnEdgesChange = useCallback(
    (changes) => setEdges(eds => applyEdgeChanges(changes, eds)),
    [],
  )

  const onConnect: OnConnect = useCallback(
    (params: Connection) =>
      setEdges(eds => addEdge({ ...params, type: 'smoothstep', animated: true }, eds)),
    [],
  )

  const onSelectionChange: OnSelectionChangeFunc = useCallback(({ nodes, edges }) => {
    setSelNodes(nodes)
    setSelEdges(edges)
  }, [])

  // ── Edge reshaping ────────────────────────────────────────────────────────
  // The edge components mutate their own `data` through this context, so the
  // canvas stays the single owner of the edge list.

  const updateEdgeData = useCallback((edgeId: string, patch: PlaybookEdgeData) => {
    setEdges(eds => eds.map(e =>
      e.id === edgeId ? { ...e, data: { ...(e.data ?? {}), ...patch } } : e,
    ))
  }, [])

  // `snap` is a module-level helper, so this memo only changes with the setter
  const edgeEditApi = useMemo(
    () => ({ updateEdgeData, editable: true, snap }),
    [updateEdgeData],
  )

  // ── Add node at viewport center ───────────────────────────────────────────

  const getViewportCenter = useCallback((): { x: number; y: number } => {
    const rect = canvasRef.current?.getBoundingClientRect()
    if (!rfInstance.current || !rect) return { x: 200, y: 200 }
    return rfInstance.current.screenToFlowPosition({
      x: rect.left + rect.width  / 2,
      y: rect.top  + rect.height / 2,
    })
  }, [])

  const addNode = useCallback((type: string, extraData?: Record<string, unknown>) => {
    const nodeId = `node-${Date.now()}-${idCounter.current++}`
    const defaults: Record<string, { label: string; description?: string; linked_playbook_id?: string; linked_playbook_name?: string }> = {
      start:        { label: 'Start' },
      end:          { label: 'End' },
      step:         { label: 'New analysis', description: 'Describe this step...' },
      decision:     { label: 'Decision?' },
      remediation:  { label: 'New Remediation', description: 'Describe the remediation action…' },
      frame:        { label: 'Zone' },
      playbook_ref: { label: 'Linked playbook', linked_playbook_id: undefined, linked_playbook_name: '' },
    }
    const center = getViewportCenter()
    const isFrame = type === 'frame'

    // Center the new node at the viewport center (not top-left aligned)
    const defaultW  = NODE_DEFAULT_WIDTH[type] ?? 160
    const approxH   = type === 'decision' ? 80 : 60  // rough initial height
    const px = isFrame ? snap(center.x - 100) : snap(center.x - defaultW / 2)
    const py = isFrame ? snap(center.y - 80)  : snap(center.y - approxH  / 2)

    const newNode: Node = {
      id: nodeId,
      type,
      position: { x: px, y: py },
      data: { ...defaults[type] ?? { label: 'Node' }, ...extraData },
      ...(isFrame ? {
        style:  { width: 200, height: 160 },
        zIndex: -1,
      } : {
        // Explicit 160 px width on all content nodes so handles always align
        style: { width: 160 },
      }),
    }
    setNodes(nds => [...nds, newNode])
  }, [getViewportCenter])

  // ── Edit / delete ─────────────────────────────────────────────────────────

  const openEditNode = (node: Node) => {
    const d = node.data as Record<string, unknown>
    setNodeForm({
      label:                d.label as string               ?? '',
      description:          d.description as string         ?? '',
      color:                d.color as string               ?? FRAME_COLORS[0],
      linked_playbook_id:   d.linked_playbook_id as string  ?? '',
      linked_playbook_name: d.linked_playbook_name as string ?? '',
    })
    setEditNodeOpen(true)
    setSelNodes(prev => prev.some(n => n.id === node.id) ? prev : [node])
  }

  const saveNodeEdit = () => {
    if (!selectedNode) return
    const isFrame      = selectedNode.type === 'frame'
    const isPlaybookRef = selectedNode.type === 'playbook_ref'
    setNodes(nds => nds.map(n => {
      if (n.id !== selectedNode.id) return n

      // Resolve display name: if a linked playbook is selected, use its name
      const linkedPb = allPlaybooks.find(p => p.id === nodeForm.linked_playbook_id)
      const resolvedName = isPlaybookRef
        ? (linkedPb?.name ?? nodeForm.linked_playbook_name)
        : undefined

      return {
        ...n,
        data: {
          ...n.data,
          label:       nodeForm.label,
          description: nodeForm.description,
          ...(isFrame       ? { color: nodeForm.color } : {}),
          ...(isPlaybookRef ? {
            linked_playbook_id:   nodeForm.linked_playbook_id || undefined,
            linked_playbook_name: resolvedName || nodeForm.linked_playbook_name || undefined,
          } : {}),
        },
        style: isFrame ? (n.style ?? {}) : { ...(n.style ?? {}), height: undefined },
      }
    }))
    setEditNodeOpen(false)
  }

  /** Delete all selected nodes (and their connected edges). */
  const deleteSelected = () => {
    const idsToRemove = new Set(selNodes.map(n => n.id))
    setNodes(nds => nds.filter(n => !idsToRemove.has(n.id)))
    setEdges(eds => eds.filter(e => !idsToRemove.has(e.source) && !idsToRemove.has(e.target)))
    setSelNodes([])
  }

  /** Delete all selected edges. */
  const deleteEdges = () => {
    const idsToRemove = new Set(selEdges.map(e => e.id))
    setEdges(eds => eds.filter(e => !idsToRemove.has(e.id)))
    setSelEdges([])
  }

  // ── ELK auto-layout ───────────────────────────────────────────────────────

  const runLayout = async (dir: 'DOWN' | 'RIGHT' = layoutDir) => {
    setLaying(true)
    try {
      // Exclude frame nodes from layout — they're decorative
      const flowNodes  = nodes.filter(n => n.type !== 'frame')
      const laid = await applyElkLayout(flowNodes, edges, {
        direction:    dir,
        layerSpacing: dir === 'RIGHT' ? 80 : 60,
        nodeSpacing:  40,
      })
      // Merge laid-out positions back, keep frame nodes in place
      const laidMap = new Map(laid.map(n => [n.id, n]))
      setNodes(nds => nds.map(n => laidMap.get(n.id) ?? n))
      // Hand-placed waypoints were anchored to the old positions — keeping them
      // would leave links looping through empty space. ELK reroutes everything.
      setEdges(eds => eds.map(e =>
        edgeWaypoints(e).length > 0 ? { ...e, data: { ...(e.data ?? {}), waypoints: [] } } : e,
      ))
      setTimeout(() => rfInstance.current?.fitView({ padding: 0.2, duration: 300 }), 50)
    } finally {
      setLaying(false)
    }
  }

  // ── PNG export ────────────────────────────────────────────────────────────

  const exportPng = async () => {
    const rf = rfInstance.current
    if (!rf || nodes.length === 0) return
    setExporting(true)
    try {
      const canvas  = renderPlaybookToCanvas(rf.getNodes().map(cleanNode) as Node[], rf.getEdges(), layoutDir)
      const dataUrl = canvas.toDataURL('image/png')
      Object.assign(document.createElement('a'), {
        href:     dataUrl,
        download: `${name || 'playbook'}.png`,
      }).click()
    } finally {
      setExporting(false)
    }
  }

  // ── Copy / paste (Ctrl+C / Ctrl+V) ──────────────────────────────────────

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      const ctrl = e.ctrlKey || e.metaKey
      if (!ctrl) return

      if (e.key === 'c' && selNodes.length > 0) {
        const selectedIds = new Set(selNodes.map(n => n.id))
        const internalEdges = edges.filter(
          ed => selectedIds.has(ed.source) && selectedIds.has(ed.target),
        )
        clipboardRef.current = { nodes: selNodes, edges: internalEdges }
      }

      if (e.key === 'v' && clipboardRef.current) {
        const { nodes: cbNodes, edges: cbEdges } = clipboardRef.current
        const idMap = new Map<string, string>()
        const OFFSET = 40
        const newNodes: Node[] = cbNodes.map(n => {
          const newId = `node-${Date.now()}-${idCounter.current++}`
          idMap.set(n.id, newId)
          return {
            ...n,
            id: newId,
            position: { x: n.position.x + OFFSET, y: n.position.y + OFFSET },
            selected: true,
          }
        })
        const newEdges: Edge[] = cbEdges.map(ed => ({
          ...ed,
          id: `edge-${Date.now()}-${Math.random().toString(36).slice(2)}`,
          source: idMap.get(ed.source) ?? ed.source,
          target: idMap.get(ed.target) ?? ed.target,
        }))
        setNodes(nds => [...nds.map(n => ({ ...n, selected: false })), ...newNodes])
        setEdges(eds => [...eds, ...newEdges])
      }
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [selNodes, edges])

  const switchLayout = (dir: 'DOWN' | 'RIGHT') => {
    setLayoutDir(dir)
    // Do NOT clear sourceHandle/targetHandle — handle IDs (yes/no) are stable across
    // layout changes; only their visual positions change.
    // NodeInternalsSync triggers useUpdateNodeInternals to recompute handle positions.
    setUpdateInternalsTrigger(t => t + 1)
    if (nodes.length > 0) runLayout(dir)
  }

  // ── Derived selection state ───────────────────────────────────────────────

  const selNodeCount = selNodes.length
  const selEdgeCount = selEdges.length

  // Selection snapshots go stale as soon as an edge is reshaped — re-read the
  // selected edges from state so the toolbar reflects their current shape.
  const selEdgeIds = useMemo(() => new Set(selEdges.map(e => e.id)), [selEdges])
  const liveSelEdges = useMemo(
    () => edges.filter(e => selEdgeIds.has(e.id)),
    [edges, selEdgeIds],
  )
  const currentShape: EdgeShape | null =
    liveSelEdges.length > 0 ? edgeShape(liveSelEdges[0]) : null
  const selWaypointCount = liveSelEdges.reduce((n, e) => n + edgeWaypoints(e).length, 0)

  const applyEdgeShape = (shape: EdgeShape) =>
    setEdges(eds => eds.map(e =>
      selEdgeIds.has(e.id) ? { ...e, data: { ...(e.data ?? {}), shape } } : e,
    ))

  /** Drop every bend point of the selected links — back to a plain connection. */
  const resetEdgeShape = () =>
    setEdges(eds => eds.map(e =>
      selEdgeIds.has(e.id) ? { ...e, data: { ...(e.data ?? {}), waypoints: [] } } : e,
    ))

  // ── Render ────────────────────────────────────────────────────────────────

  return (
    <div className="flex flex-col h-full">
      {/* ── Header ──────────────────────────────────────────────────────── */}
      <div className="border-b border-white/5 px-6 py-3 flex items-center gap-4">
        <button onClick={() => navigate('/playbooks')} className="text-accent-muted hover:text-white transition-colors">
          <ArrowLeft size={18} />
        </button>
        <GitBranch size={16} className="text-accent-green" />
        <input
          className="input text-sm font-semibold flex-1 max-w-xs"
          placeholder="Playbook name…"
          value={name}
          onChange={e => setName(e.target.value)}
        />
        <input
          className="input text-xs flex-1 max-w-sm"
          placeholder="Description (optional)"
          value={description}
          onChange={e => setDescription(e.target.value)}
        />

        <div className="ml-auto flex items-center gap-2">
          {/* Export PNG */}
          <button
            onClick={exportPng}
            disabled={exporting || nodes.length === 0}
            title="Export playbook as PNG image"
            className="flex items-center gap-1.5 px-3 py-1.5 rounded border border-white/10 text-xs text-accent-muted hover:text-white hover:border-white/25 disabled:opacity-40 transition-colors"
          >
            <ImageDown size={12} />
            {exporting ? 'Exporting…' : 'Export PNG'}
          </button>

          {/* ── Frame zone controls ─────────────────────────────────────── */}
          <div className="flex items-center gap-1.5 px-2.5 py-1.5 rounded border border-white/10 bg-white/[0.02]">
            <SquareDashed size={11} className="text-accent-muted shrink-0" />
            {FRAME_COLORS.map(c => (
              <button
                key={c}
                onClick={() => setFrameColor(c)}
                title={c}
                className="w-3.5 h-3.5 rounded-sm transition-all"
                style={{
                  backgroundColor: c,
                  outline: frameColor === c ? `2px solid ${c}` : '2px solid transparent',
                  outlineOffset: 2,
                }}
              />
            ))}
            <button
              onClick={() => addNode('frame', { color: frameColor })}
              className="ml-1 text-[10px] text-accent-muted hover:text-white border border-white/10 hover:border-white/30 px-2 py-0.5 rounded transition-colors"
            >
              + Cadre
            </button>
          </div>

          {/* Layout direction toggle + apply */}
          <div className="flex items-center rounded border border-white/10 overflow-hidden">
            <button
              onClick={() => switchLayout('DOWN')}
              disabled={laying || nodes.length === 0}
              title="Vertical layout (top → bottom)"
              className={`flex items-center gap-1 px-2.5 py-1.5 text-xs transition-colors disabled:opacity-40 ${
                layoutDir === 'DOWN'
                  ? 'bg-accent-green/10 text-accent-green'
                  : 'text-accent-muted hover:text-white hover:bg-white/5'
              }`}
            >
              <ArrowDown size={12} />
            </button>
            <div className="w-px h-4 bg-white/10" />
            <button
              onClick={() => switchLayout('RIGHT')}
              disabled={laying || nodes.length === 0}
              title="Horizontal layout (left → right)"
              className={`flex items-center gap-1 px-2.5 py-1.5 text-xs transition-colors disabled:opacity-40 ${
                layoutDir === 'RIGHT'
                  ? 'bg-accent-green/10 text-accent-green'
                  : 'text-accent-muted hover:text-white hover:bg-white/5'
              }`}
            >
              <ArrowRight size={12} />
            </button>
            <div className="w-px h-4 bg-white/10" />
            <button
              onClick={() => runLayout()}
              disabled={laying || nodes.length === 0}
              title="Re-apply the automatic layout (edge waypoints are reset)"
              className="flex items-center gap-1.5 px-2.5 py-1.5 text-xs text-accent-muted hover:text-white hover:bg-white/5 transition-colors disabled:opacity-40"
            >
              <Wand2 size={12} />
              {laying ? 'Laying out…' : 'Auto layout'}
            </button>
          </div>

          {/* ── Selection-aware action buttons ─────────────────────────── */}
          {selectedNode && selNodeCount === 1 && (
            <button
              className="btn-secondary text-xs flex items-center gap-1"
              onClick={() => openEditNode(selectedNode)}
            >
              Edit node
            </button>
          )}
          {selNodeCount > 0 && (
            <button
              className="btn-danger text-xs flex items-center gap-1"
              onClick={deleteSelected}
            >
              <Trash2 size={12} />
              {selNodeCount > 1 ? `Delete (${selNodeCount})` : 'Delete node'}
            </button>
          )}
          {/* ── Link shape ─────────────────────────────────────────────── */}
          {selEdgeCount > 0 && (
            <div
              className="flex items-center gap-1 px-2 py-1 rounded border border-white/10 bg-white/[0.02]"
              title="Double-click an edge to add a waypoint, then drag it to route around a node"
            >
              <Spline size={11} className="text-accent-muted shrink-0" />
              {EDGE_SHAPES.map(sh => (
                <button
                  key={sh.value}
                  onClick={() => applyEdgeShape(sh.value)}
                  title={sh.hint}
                  className={`text-[10px] px-1.5 py-0.5 rounded transition-colors ${
                    currentShape === sh.value
                      ? 'bg-accent-green/10 text-accent-green'
                      : 'text-accent-muted hover:text-white hover:bg-white/5'
                  }`}
                >
                  {sh.label}
                </button>
              ))}
              {selWaypointCount > 0 && (
                <button
                  onClick={resetEdgeShape}
                  title="Remove every waypoint from the selected edges"
                  className="text-[10px] px-1.5 py-0.5 rounded text-accent-muted hover:text-white hover:bg-white/5 transition-colors border-l border-white/10 ml-0.5 pl-2"
                >
                  ✕ {selWaypointCount} pt{selWaypointCount > 1 ? 's' : ''}
                </button>
              )}
            </div>
          )}
          {selEdgeCount > 0 && (
            <button
              className="btn-danger text-xs flex items-center gap-1"
              onClick={deleteEdges}
            >
              <Link2Off size={12} />
              {selEdgeCount > 1 ? `Delete (${selEdgeCount})` : 'Delete link'}
            </button>
          )}

          <button
            className="btn-primary text-xs flex items-center gap-1.5"
            onClick={() => save.mutate()}
            disabled={!name || save.isPending}
          >
            <Save size={12} /> {save.isPending ? 'Saving…' : 'Save'}
          </button>
        </div>
      </div>

      <div className="flex flex-1 overflow-hidden">
        {/* ── Palette ─────────────────────────────────────────────────── */}
        <div className="w-36 border-r border-white/5 bg-bg-card p-3 flex flex-col gap-2 shrink-0">
          <p className="text-[10px] uppercase tracking-widest text-accent-muted mb-1">Add node</p>
          {NODE_PALETTE.map(n => (
            <button
              key={n.type}
              onClick={() => addNode(n.type)}
              className={`flex items-center gap-2 text-xs px-3 py-2 rounded border border-white/10 hover:border-white/30 bg-white/5 hover:bg-white/10 transition-colors ${n.color}`}
            >
              <Plus size={11} /> {n.label}
            </button>
          ))}
        </div>

        {/* ── Canvas ──────────────────────────────────────────────────── */}
        <div ref={canvasRef} className="flex-1 bg-bg-primary">
          <LayoutDirContext.Provider value={layoutDir}>
          <PlaybookEdgeEditContext.Provider value={edgeEditApi}>
          <ReactFlow
            nodes={nodes}
            edges={edges}
            onNodesChange={onNodesChange}
            onEdgesChange={onEdgesChange}
            onConnect={onConnect}
            onInit={inst => { rfInstance.current = inst }}
            onSelectionChange={onSelectionChange}
            onNodeDoubleClick={(_, node) => openEditNode(node)}
            nodeTypes={NODE_TYPES}
            edgeTypes={EDGE_TYPES}
            defaultEdgeOptions={{ type: 'smoothstep', animated: true }}
            snapToGrid
            snapGrid={[MOVE_SNAP, MOVE_SNAP]}
            selectionOnDrag
            panOnDrag={[1, 2]}
            fitView
            deleteKeyCode="Delete"
            style={{ background: '#0B121F' }}
          >
            <Background variant={BackgroundVariant.Dots} gap={GRID} size={1.5} color="#1e2e42" />
            <Controls />
            <MiniMap nodeColor={() => '#2DD4BF'} />
            <NodeInternalsSync trigger={updateInternalsTrigger} nodeIds={nodes.map(n => n.id)} />
          </ReactFlow>
          </PlaybookEdgeEditContext.Provider>
          </LayoutDirContext.Provider>
        </div>
      </div>

      {/* ── Edit node modal ──────────────────────────────────────────────── */}
      <Modal open={editNodeOpen} onClose={() => setEditNodeOpen(false)} title="Edit node" size="sm">
        <div className="space-y-4">
          <div>
            <label className="label">Label</label>
            <input
              className="input"
              value={nodeForm.label}
              onChange={e => setNodeForm(f => ({ ...f, label: e.target.value }))}
              onKeyDown={e => e.key === 'Enter' && saveNodeEdit()}
            />
          </div>

          {/* Description — for step / decision / remediation */}
          {selectedNode?.type !== 'start' && selectedNode?.type !== 'end' && selectedNode?.type !== 'frame' && (
            <div>
              <label className="label">Description</label>
              <textarea
                className="input min-h-[80px] resize-y"
                value={nodeForm.description}
                onChange={e => setNodeForm(f => ({ ...f, description: e.target.value }))}
              />
            </div>
          )}

          {/* Color — for frame nodes only */}
          {selectedNode?.type === 'frame' && (
            <div>
              <label className="label">Couleur de la zone</label>
              <div className="flex gap-2 mt-1">
                {FRAME_COLORS.map(c => (
                  <button
                    key={c}
                    onClick={() => setNodeForm(f => ({ ...f, color: c }))}
                    className="w-6 h-6 rounded transition-all"
                    style={{
                      backgroundColor: c,
                      outline: nodeForm.color === c ? `2px solid ${c}` : '2px solid transparent',
                      outlineOffset: 2,
                    }}
                  />
                ))}
              </div>
            </div>
          )}

          {/* Playbook link — for playbook_ref nodes */}
          {selectedNode?.type === 'playbook_ref' && (
            <div className="space-y-3 border border-purple-400/20 rounded-lg p-3 bg-purple-400/5">
              <p className="text-[10px] text-purple-300/70 uppercase tracking-widest font-semibold">Lien vers un playbook</p>

              {/* Picker: existing playbooks */}
              <div>
                <label className="label">Playbook existant</label>
                <select
                  className="input text-xs"
                  value={nodeForm.linked_playbook_id}
                  onChange={e => {
                    const pb = allPlaybooks.find(p => p.id === e.target.value)
                    setNodeForm(f => ({
                      ...f,
                      linked_playbook_id:   e.target.value,
                      linked_playbook_name: pb?.name ?? f.linked_playbook_name,
                      label: f.label === 'Linked playbook' || f.label === '' ? (pb?.name ?? f.label) : f.label,
                    }))
                  }}
                >
                  <option value="">-- Select a playbook --</option>
                  {allPlaybooks
                    .filter(pb => !id || pb.id !== id)  // exclude current playbook
                    .map(pb => (
                      <option key={pb.id} value={pb.id}>{pb.name}</option>
                    ))
                  }
                </select>
              </div>

              {/* OR: future playbook name */}
              {!nodeForm.linked_playbook_id && (
                <div>
                  <label className="label">Ou nom d'un futur playbook</label>
                  <input
                    className="input text-xs"
                    placeholder="ex: Compromission de compte"
                    value={nodeForm.linked_playbook_name}
                    onChange={e => setNodeForm(f => ({ ...f, linked_playbook_name: e.target.value }))}
                  />
                  <p className="text-[9px] text-purple-400/40 mt-1">
                    The link becomes usable once that playbook is created and selected here.
                  </p>
                </div>
              )}

              {nodeForm.linked_playbook_id && (
                <button
                  className="text-[9px] text-purple-400/50 hover:text-purple-300 transition-colors"
                  onClick={() => setNodeForm(f => ({ ...f, linked_playbook_id: '', linked_playbook_name: '' }))}
                >
                  ✕ Retirer le lien
                </button>
              )}
            </div>
          )}

          <div className="flex justify-end gap-3">
            <button className="btn-secondary" onClick={() => setEditNodeOpen(false)}>Cancel</button>
            <button className="btn-primary" onClick={saveNodeEdit}>Apply</button>
          </div>
        </div>
      </Modal>
    </div>
  )
}
