import { useState, useCallback, useRef, useEffect } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import {
  ReactFlow, Background, BackgroundVariant, Controls, MiniMap,
  addEdge, applyNodeChanges, applyEdgeChanges,
  type Node, type Edge, type OnConnect, type OnNodesChange, type OnEdgesChange,
  type Connection,
} from '@xyflow/react'
import { ArrowLeft, Save, Plus, Trash2, GitBranch } from 'lucide-react'
import { playbooksApi, type PlaybookNode, type PlaybookEdge } from '../api/playbooks'
import { NODE_TYPES } from '../components/playbook/PlaybookNodes'
import Modal from '../components/ui/Modal'

const NODE_PALETTE = [
  { type: 'start', label: 'Start', color: 'text-accent-green' },
  { type: 'step', label: 'Step', color: 'text-white' },
  { type: 'decision', label: 'Decision', color: 'text-severity-medium' },
  { type: 'end', label: 'End', color: 'text-severity-critical' },
] as const

export default function PlaybookEditor() {
  const { id } = useParams<{ id: string }>()
  const navigate = useNavigate()
  const qc = useQueryClient()
  const isNew = !id || id === 'new'

  const [name, setName] = useState('')
  const [description, setDescription] = useState('')
  const [nodes, setNodes] = useState<Node[]>([])
  const [edges, setEdges] = useState<Edge[]>([])
  const [selectedNode, setSelectedNode] = useState<Node | null>(null)
  const [editNodeOpen, setEditNodeOpen] = useState(false)
  const [nodeForm, setNodeForm] = useState({ label: '', description: '' })
  const [initialized, setInitialized] = useState(false)
  const idCounter = useRef(1)

  const { data: pbData } = useQuery({
    queryKey: ['playbook', id],
    queryFn: () => playbooksApi.get(id!),
    enabled: !isNew && !!id,
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

  const save = useMutation({
    mutationFn: () => {
      const payload = {
        name,
        description,
        nodes: nodes as unknown as PlaybookNode[],
        edges: edges as unknown as PlaybookEdge[],
      }
      return isNew
        ? playbooksApi.create(payload)
        : playbooksApi.update(id!, payload)
    },
    onSuccess: (pb) => {
      qc.invalidateQueries({ queryKey: ['playbooks'] })
      if (isNew) navigate(`/playbooks/${pb.id}/edit`, { replace: true })
    },
  })

  const onNodesChange: OnNodesChange = useCallback(
    (changes) => setNodes(nds => applyNodeChanges(changes, nds)),
    []
  )
  const onEdgesChange: OnEdgesChange = useCallback(
    (changes) => setEdges(eds => applyEdgeChanges(changes, eds)),
    []
  )
  const onConnect: OnConnect = useCallback(
    (params: Connection) => setEdges(eds => addEdge({ ...params, type: 'smoothstep', animated: true }, eds)),
    []
  )

  const GRID = 20
  const snap = (v: number) => Math.round(v / GRID) * GRID

  const addNode = (type: string) => {
    const id = `node-${Date.now()}-${idCounter.current++}`
    const defaults: Record<string, { label: string; description?: string }> = {
      start: { label: 'Start' },
      end: { label: 'End' },
      step: { label: 'New Step', description: 'Describe this step...' },
      decision: { label: 'Decision?' },
    }
    const newNode: Node = {
      id,
      type,
      position: {
        x: snap(200),
        y: snap(100 + nodes.length * 100),
      },
      data: defaults[type] || { label: 'Node' },
    }
    setNodes(nds => [...nds, newNode])
  }

  const openEditNode = (node: Node) => {
    setSelectedNode(node)
    setNodeForm({
      label: (node.data as any).label || '',
      description: (node.data as any).description || '',
    })
    setEditNodeOpen(true)
  }

  const saveNodeEdit = () => {
    if (!selectedNode) return
    setNodes(nds => nds.map(n =>
      n.id === selectedNode.id
        ? { ...n, data: { ...n.data, label: nodeForm.label, description: nodeForm.description } }
        : n
    ))
    setEditNodeOpen(false)
  }

  const deleteSelected = () => {
    if (!selectedNode) return
    setNodes(nds => nds.filter(n => n.id !== selectedNode.id))
    setEdges(eds => eds.filter(e => e.source !== selectedNode.id && e.target !== selectedNode.id))
    setSelectedNode(null)
  }

  return (
    <div className="flex flex-col h-full">
      {/* Header */}
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
          {selectedNode && (
            <>
              <button
                className="btn-secondary text-xs flex items-center gap-1"
                onClick={() => openEditNode(selectedNode)}
              >
                <span>Edit node</span>
              </button>
              <button
                className="btn-danger text-xs flex items-center gap-1"
                onClick={deleteSelected}
              >
                <Trash2 size={12} /> Delete
              </button>
            </>
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
        {/* Palette */}
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

        {/* Canvas */}
        <div className="flex-1 bg-bg-primary">
          <ReactFlow
            nodes={nodes}
            edges={edges}
            onNodesChange={onNodesChange}
            onEdgesChange={onEdgesChange}
            onConnect={onConnect}
            onNodeClick={(_, node) => setSelectedNode(node)}
            onPaneClick={() => setSelectedNode(null)}
            onNodeDoubleClick={(_, node) => openEditNode(node)}
            nodeTypes={NODE_TYPES}
            defaultEdgeOptions={{ type: 'smoothstep', animated: true }}
            snapToGrid
            snapGrid={[20, 20]}
            fitView
            style={{ background: '#0B121F' }}
          >
            <Background
              variant={BackgroundVariant.Dots}
              gap={20}
              size={1.5}
              color="#1e2e42"
            />
            <Controls />
            <MiniMap nodeColor={() => '#9FEF00'} />
          </ReactFlow>
        </div>
      </div>

      {/* Edit node modal */}
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
