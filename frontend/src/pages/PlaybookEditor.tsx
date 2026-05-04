import { useState, useCallback, useRef } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import {
  ReactFlow, Background, BackgroundVariant, Controls, MiniMap,
  addEdge, applyNodeChanges, applyEdgeChanges,
  type Node, type Edge, type OnConnect, type OnNodesChange, type OnEdgesChange,
  type Connection, type ReactFlowInstance,
} from '@xyflow/react'
import { ArrowLeft, Save, Plus, Trash2, GitBranch, Wand2, Link2Off } from 'lucide-react'
import { playbooksApi, type PlaybookNode, type PlaybookEdge } from '../api/playbooks'
import { NODE_TYPES } from '../components/playbook/PlaybookNodes'
import { applyElkLayout } from '../utils/elkLayout'
import Modal from '../components/ui/Modal'
import { useEffect } from 'react'

// ── Constants ─────────────────────────────────────────────────────────────────

const GRID = 20
const snap = (v: number) => Math.round(v / GRID) * GRID
/** Snap height UP to the next grid multiple so handles land on grid lines. */
const snapH = (h: number) => Math.ceil(h / GRID) * GRID

const NODE_PALETTE = [
  { type: 'start',    label: 'Start',    color: 'text-accent-green' },
  { type: 'step',     label: 'Step',     color: 'text-white' },
  { type: 'decision', label: 'Decision', color: 'text-severity-medium' },
  { type: 'end',      label: 'End',      color: 'text-severity-critical' },
] as const

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
  const [selectedNode, setSelectedNode] = useState<Node | null>(null)
  const [selectedEdge, setSelectedEdge] = useState<Edge | null>(null)
  const [editNodeOpen, setEditNodeOpen] = useState(false)
  const [nodeForm,    setNodeForm]    = useState({ label: '', description: '' })
  const [initialized, setInitialized] = useState(false)
  const [laying,      setLaying]      = useState(false)

  const idCounter  = useRef(1)
  /** Captured ReactFlow instance — used to get viewport center for new nodes. */
  const rfInstance = useRef<ReactFlowInstance | null>(null)
  /** Ref to the canvas wrapper div — needed for getBoundingClientRect. */
  const canvasRef  = useRef<HTMLDivElement>(null)

  // ── Load existing playbook ─────────────────────────────────────────────────

  const { data: pbData } = useQuery({
    queryKey: ['playbook', id],
    queryFn:  () => playbooksApi.get(id!),
    enabled:  !isNew && !!id,
  })

  useEffect(() => {
    if (pbData && !initialized) {
      setName(pbData.name)
      setDescription(pbData.description)
      setNodes(pbData.nodes as Node[])
      setEdges(pbData.edges as Edge[])
      setInitialized(true)
    }
  }, [pbData, initialized])

  // ── Save ──────────────────────────────────────────────────────────────────

  const save = useMutation({
    mutationFn: () => {
      const payload = {
        name,
        description,
        nodes: nodes as unknown as PlaybookNode[],
        edges: edges as unknown as PlaybookEdge[],
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
        // Avoid redundant updates (would cause infinite loop)
        if ((n.style as Record<string, unknown>)?.height === sh) return n
        return { ...n, style: { ...(n.style ?? {}), height: sh } }
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

  // ── Add node at viewport center ───────────────────────────────────────────

  /** Convert the canvas center (screen px) to flow-space coordinates. */
  const getViewportCenter = useCallback((): { x: number; y: number } => {
    const rect = canvasRef.current?.getBoundingClientRect()
    if (!rfInstance.current || !rect) return { x: 200, y: 200 }
    return rfInstance.current.screenToFlowPosition({
      x: rect.left + rect.width  / 2,
      y: rect.top  + rect.height / 2,
    })
  }, [])

  const addNode = useCallback((type: string) => {
    const id = `node-${Date.now()}-${idCounter.current++}`
    const defaults: Record<string, { label: string; description?: string }> = {
      start:    { label: 'Start' },
      end:      { label: 'End' },
      step:     { label: 'New Step', description: 'Describe this step…' },
      decision: { label: 'Decision?' },
    }
    const center = getViewportCenter()
    const newNode: Node = {
      id,
      type,
      // Place at viewport center, snapped to grid
      position: { x: snap(center.x), y: snap(center.y) },
      data: defaults[type] ?? { label: 'Node' },
    }
    setNodes(nds => [...nds, newNode])
  }, [getViewportCenter])

  // ── Edit / delete ─────────────────────────────────────────────────────────

  const openEditNode = (node: Node) => {
    setSelectedNode(node)
    setNodeForm({
      label:       (node.data as Record<string, unknown>).label as string       ?? '',
      description: (node.data as Record<string, unknown>).description as string ?? '',
    })
    setEditNodeOpen(true)
  }

  const saveNodeEdit = () => {
    if (!selectedNode) return
    setNodes(nds => nds.map(n =>
      n.id === selectedNode.id
        ? {
            ...n,
            data:  { ...n.data, label: nodeForm.label, description: nodeForm.description },
            // Clear height so ReactFlow re-measures the new content size,
            // then the onNodesChange handler snaps it back to the grid.
            style: { ...(n.style ?? {}), height: undefined },
          }
        : n,
    ))
    setEditNodeOpen(false)
  }

  const deleteSelected = () => {
    if (!selectedNode) return
    setNodes(nds => nds.filter(n => n.id !== selectedNode.id))
    setEdges(eds => eds.filter(e => e.source !== selectedNode.id && e.target !== selectedNode.id))
    setSelectedNode(null)
  }

  const deleteEdge = () => {
    if (!selectedEdge) return
    setEdges(eds => eds.filter(e => e.id !== selectedEdge.id))
    setSelectedEdge(null)
  }

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
      // Fit view after layout settles (next tick)
      setTimeout(() => rfInstance.current?.fitView({ padding: 0.2, duration: 300 }), 50)
    } finally {
      setLaying(false)
    }
  }

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
          {/* Auto-layout */}
          <button
            onClick={runLayout}
            disabled={laying || nodes.length === 0}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded border border-white/10 text-xs text-accent-muted hover:text-white hover:border-white/25 disabled:opacity-40 transition-colors"
            title="Arrange nodes automatically with ELK layered layout"
          >
            <Wand2 size={12} />
            {laying ? 'Laying out…' : 'Auto layout'}
          </button>

          {selectedNode && (
            <>
              <button
                className="btn-secondary text-xs flex items-center gap-1"
                onClick={() => openEditNode(selectedNode)}
              >
                Edit node
              </button>
              <button
                className="btn-danger text-xs flex items-center gap-1"
                onClick={deleteSelected}
              >
                <Trash2 size={12} /> Delete node
              </button>
            </>
          )}
          {selectedEdge && (
            <button
              className="btn-danger text-xs flex items-center gap-1"
              onClick={deleteEdge}
            >
              <Link2Off size={12} /> Delete link
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
          <ReactFlow
            nodes={nodes}
            edges={edges}
            onNodesChange={onNodesChange}
            onEdgesChange={onEdgesChange}
            onConnect={onConnect}
            onInit={inst => { rfInstance.current = inst }}
            onNodeClick={(_, node) => { setSelectedNode(node); setSelectedEdge(null) }}
            onEdgeClick={(_, edge) => { setSelectedEdge(edge); setSelectedNode(null) }}
            onPaneClick={() => { setSelectedNode(null); setSelectedEdge(null) }}
            onNodeDoubleClick={(_, node) => openEditNode(node)}
            nodeTypes={NODE_TYPES}
            defaultEdgeOptions={{ type: 'smoothstep', animated: true }}
            snapToGrid
            snapGrid={[GRID, GRID]}
            fitView
            deleteKeyCode="Delete"
            style={{ background: '#0B121F' }}
          >
            <Background variant={BackgroundVariant.Dots} gap={GRID} size={1.5} color="#1e2e42" />
            <Controls />
            <MiniMap nodeColor={() => '#9FEF00'} />
          </ReactFlow>
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
          {selectedNode?.type !== 'start' && selectedNode?.type !== 'end' && (
            <div>
              <label className="label">Description</label>
              <textarea
                className="input min-h-[80px] resize-y"
                value={nodeForm.description}
                onChange={e => setNodeForm(f => ({ ...f, description: e.target.value }))}
              />
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
