import { useEffect, useCallback, useRef, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import {
  ReactFlow, Background, BackgroundVariant, Controls,
  applyNodeChanges, applyEdgeChanges,
  type Node, type Edge, type OnNodesChange, type OnEdgesChange,
} from '@xyflow/react'
import { knowledgeApi } from '../../api/knowledge'

// ── Force layout ───────────────────────────────────────────────────────────

function forceLayout(
  nodeIds: string[],
  edges: { source: string; target: string }[],
  W = 900, H = 700,
): Record<string, { x: number; y: number }> {
  const pos: Record<string, { x: number; y: number }> = {}

  nodeIds.forEach((id, i) => {
    const angle = (i / nodeIds.length) * 2 * Math.PI
    const r = Math.min(W, H) * 0.36
    pos[id] = {
      x: W / 2 + r * Math.cos(angle) + (Math.random() - 0.5) * 40,
      y: H / 2 + r * Math.sin(angle) + (Math.random() - 0.5) * 40,
    }
  })

  const adj: Record<string, Set<string>> = {}
  nodeIds.forEach(id => { adj[id] = new Set() })
  edges.forEach(e => { adj[e.source]?.add(e.target); adj[e.target]?.add(e.source) })

  const K_repel = 12000
  const K_spring = 0.04
  const IDEAL = 160
  const CENTER = 0.008
  const DAMP = 0.85

  const vel: Record<string, { vx: number; vy: number }> = {}
  nodeIds.forEach(id => { vel[id] = { vx: 0, vy: 0 } })

  for (let iter = 0; iter < 250; iter++) {
    const f: Record<string, { fx: number; fy: number }> = {}
    nodeIds.forEach(id => { f[id] = { fx: 0, fy: 0 } })

    for (let i = 0; i < nodeIds.length; i++) {
      for (let j = i + 1; j < nodeIds.length; j++) {
        const a = nodeIds[i], b = nodeIds[j]
        const dx = pos[b].x - pos[a].x
        const dy = pos[b].y - pos[a].y
        const dist = Math.max(Math.sqrt(dx * dx + dy * dy), 1)
        const force = K_repel / (dist * dist)
        const fx = (force * dx) / dist
        const fy = (force * dy) / dist
        f[a].fx -= fx; f[a].fy -= fy
        f[b].fx += fx; f[b].fy += fy
      }
    }

    edges.forEach(({ source, target }) => {
      if (!pos[source] || !pos[target]) return
      const dx = pos[target].x - pos[source].x
      const dy = pos[target].y - pos[source].y
      const dist = Math.max(Math.sqrt(dx * dx + dy * dy), 1)
      const stretch = dist - IDEAL
      const force = K_spring * stretch
      const fx = (force * dx) / dist
      const fy = (force * dy) / dist
      f[source].fx += fx; f[source].fy += fy
      f[target].fx -= fx; f[target].fy -= fy
    })

    nodeIds.forEach(id => {
      f[id].fx += (W / 2 - pos[id].x) * CENTER
      f[id].fy += (H / 2 - pos[id].y) * CENTER
    })

    nodeIds.forEach(id => {
      vel[id].vx = (vel[id].vx + f[id].fx) * DAMP
      vel[id].vy = (vel[id].vy + f[id].fy) * DAMP
      pos[id].x += Math.max(-30, Math.min(30, vel[id].vx))
      pos[id].y += Math.max(-30, Math.min(30, vel[id].vy))
    })
  }
  return pos
}

// ── Node style ─────────────────────────────────────────────────────────────

function nodeStyle(isCurrent: boolean, linkCount: number) {
  const size = Math.max(28, Math.min(60, 28 + linkCount * 4))
  return {
    width: size,
    height: size,
    borderRadius: '50%',
    fontSize: '9px',
    background: isCurrent ? 'rgba(159,239,0,0.2)' : 'rgba(255,255,255,0.04)',
    border: `1.5px solid ${isCurrent ? '#9FEF00' : 'rgba(255,255,255,0.12)'}`,
    color: isCurrent ? '#9FEF00' : 'rgba(163,179,188,0.7)',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    textAlign: 'center' as const,
    lineHeight: '1.2',
    cursor: 'pointer',
    padding: '2px',
    overflow: 'hidden',
  }
}

// ── Component ──────────────────────────────────────────────────────────────

interface Props {
  currentPath: string | null
  onNodeClick: (path: string) => void
}

export default function NoteGraph({ currentPath, onNodeClick }: Props) {
  const { data: graph } = useQuery({
    queryKey: ['knowledge-graph'],
    queryFn: knowledgeApi.graph,
    staleTime: 30_000,
  })

  const [rfNodes, setRfNodes] = useState<Node[]>([])
  const [rfEdges, setRfEdges] = useState<Edge[]>([])
  const layoutDone = useRef(false)

  // Build initial layout once when graph data arrives
  useEffect(() => {
    if (!graph || graph.nodes.length === 0 || layoutDone.current) return
    layoutDone.current = true

    const positions = forceLayout(
      graph.nodes.map(n => n.id),
      graph.edges,
    )

    // Build id → path map for click handler
    const idToPath: Record<string, string> = {}
    graph.nodes.forEach(n => { idToPath[n.id] = n.path })

    setRfNodes(
      graph.nodes.map(n => ({
        id: n.id,
        type: 'default',
        position: positions[n.id] ?? { x: 0, y: 0 },
        data: { label: n.label, path: n.path, linkCount: n.link_count },
        style: nodeStyle(n.path === currentPath, n.link_count),
      }))
    )

    setRfEdges(
      graph.edges.map((e, i) => ({
        id: `e${i}`,
        source: e.source,
        target: e.target,
        style: { stroke: 'rgba(163,179,188,0.15)', strokeWidth: 1 },
      }))
    )
  }, [graph])

  // Update highlight when currentPath changes (no re-layout)
  useEffect(() => {
    if (!graph) return
    setRfNodes(prev => prev.map(n => ({
      ...n,
      style: nodeStyle(n.data.path === currentPath, n.data.linkCount as number ?? 0),
    })))
  }, [currentPath, graph])

  const onNodesChange: OnNodesChange = useCallback(
    changes => setRfNodes(prev => applyNodeChanges(changes, prev)),
    [],
  )
  const onEdgesChange: OnEdgesChange = useCallback(
    changes => setRfEdges(prev => applyEdgeChanges(changes, prev)),
    [],
  )

  const handleNodeClick = useCallback((_: React.MouseEvent, node: Node) => {
    onNodeClick(node.data.path as string)
  }, [onNodeClick])

  if (!graph || graph.nodes.length === 0) {
    return (
      <div className="h-full flex items-center justify-center p-4">
        <p className="text-[11px] text-accent-muted/30 italic text-center">
          No notes yet.<br />
          Create notes with <code className="bg-white/5 px-1 rounded">[[wikilinks]]</code> to see the graph.
        </p>
      </div>
    )
  }

  return (
    <ReactFlow
      nodes={rfNodes}
      edges={rfEdges}
      onNodesChange={onNodesChange}
      onEdgesChange={onEdgesChange}
      onNodeClick={handleNodeClick}
      fitView
      fitViewOptions={{ padding: 0.2 }}
      minZoom={0.1}
      maxZoom={3}
      nodesDraggable
      nodesConnectable={false}
      elementsSelectable={false}
    >
      <Background variant={BackgroundVariant.Dots} gap={20} size={1} color="rgba(255,255,255,0.04)" />
      <Controls showInteractive={false} />
    </ReactFlow>
  )
}
