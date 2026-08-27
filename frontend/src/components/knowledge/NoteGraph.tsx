import { useEffect, useCallback, useRef, useState, useMemo } from 'react'
import { useQuery } from '@tanstack/react-query'
import {
  ReactFlow, Background, BackgroundVariant,
  applyNodeChanges, applyEdgeChanges,
  Handle, Position,
  type Node, type Edge, type OnNodesChange, type OnEdgesChange,
  type ReactFlowInstance, type NodeTypes,
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
  const size = Math.max(26, Math.min(56, 26 + linkCount * 4))
  return {
    width:           size,
    height:          size,
    borderRadius:    '50%',
    fontSize:        '8px',
    background:      isCurrent ? 'rgba(45,212,191,0.18)' : 'rgba(255,255,255,0.04)',
    border:          `1.5px solid ${isCurrent ? '#2DD4BF' : 'rgba(255,255,255,0.15)'}`,
    color:           isCurrent ? '#2DD4BF' : 'rgba(163,179,188,0.7)',
    display:         'flex',
    alignItems:      'center',
    justifyContent:  'center',
    textAlign:       'center' as const,
    lineHeight:      '1.2',
    cursor:          'pointer',
    padding:         '2px',
    overflow:        'hidden',
    boxSizing:       'border-box' as const,
  }
}

// ── Custom node — handles are invisible and centred so edges connect
//    from circle centre to circle centre, drawn as straight lines ───────────

function GraphNode({ data }: { data: Record<string, unknown> }) {
  const isCurrent  = Boolean(data.isCurrent)
  const linkCount  = (data.linkCount as number) ?? 0
  const label      = (data.label as string) ?? ''
  const short      = label.length > 9 ? label.slice(0, 8) + '…' : label

  // Both handles sit at the node's centre (top 50%, left 50%).
  // They are invisible and have zero pointer-event area — so the edge lines
  // start and end at the visual centre of each circle.
  const handleStyle: React.CSSProperties = {
    opacity:        0,
    width:          1,
    height:         1,
    minWidth:       0,
    minHeight:      0,
    border:         'none',
    background:     'transparent',
    top:            '50%',
    left:           '50%',
    transform:      'translate(-50%, -50%)',
    pointerEvents:  'none',
  }

  return (
    <>
      <Handle type="target" position={Position.Top}    style={handleStyle} />
      <div style={nodeStyle(isCurrent, linkCount)}>{short}</div>
      <Handle type="source" position={Position.Bottom} style={handleStyle} />
    </>
  )
}

const nodeTypes: NodeTypes = { graphNode: GraphNode }

// ── Component ──────────────────────────────────────────────────────────────

interface Props {
  currentPath: string | null
  onNodeClick: (path: string) => void
}

export default function NoteGraph({ currentPath, onNodeClick }: Props) {
  const { data: graph } = useQuery({
    queryKey:         ['knowledge-graph'],
    queryFn:          knowledgeApi.graph,
    staleTime:        0,           // always considered stale → refetch on mount/focus
    structuralSharing: false,      // new object reference on every fetch → effect always runs
  })

  // ── All nodes / edges (full graph, kept in state for dragging) ────────────
  const [allNodes, setAllNodes] = useState<Node[]>([])
  const [allEdges, setAllEdges] = useState<Edge[]>([])
  const rfRef = useRef<ReactFlowInstance | null>(null)

  // Ref so the effect always reads the latest currentPath without it being a dependency
  const currentPathRef = useRef(currentPath)
  useEffect(() => { currentPathRef.current = currentPath }, [currentPath])

  // Build / incrementally update layout when graph data changes
  useEffect(() => {
    if (!graph) return

    setAllNodes(prev => {
      // Build a position map from nodes we've already laid out
      const posMap = new Map(prev.map(n => [n.id, n.position]))

      if (posMap.size === 0 && graph.nodes.length > 0) {
        // ── First load: run full force layout ─────────────────────────────
        const positions = forceLayout(graph.nodes.map(n => n.id), graph.edges)
        graph.nodes.forEach(n => posMap.set(n.id, positions[n.id] ?? { x: 0, y: 0 }))
      } else {
        // ── Incremental: place new nodes near the current note ─────────────
        const newIds = graph.nodes.filter(n => !posMap.has(n.id))
        if (newIds.length > 0) {
          const curNode = prev.find(n => (n.data.path as string) === currentPathRef.current)
          const cx = curNode?.position.x ?? 450
          const cy = curNode?.position.y ?? 350
          newIds.forEach((gn, i) => {
            const angle = (i / Math.max(newIds.length, 1)) * 2 * Math.PI
            const r = 90 + Math.random() * 50
            posMap.set(gn.id, { x: cx + r * Math.cos(angle), y: cy + r * Math.sin(angle) })
          })
        }
      }

      // Rebuild nodes array from latest graph data, keeping existing positions
      return graph.nodes.map(n => ({
        id:       n.id,
        type:     'graphNode',
        position: posMap.get(n.id) ?? { x: 0, y: 0 },
        data: {
          label:     n.label,
          path:      n.path,
          linkCount: n.link_count,
          isCurrent: n.path === currentPathRef.current,
        },
      }))
    })

    setAllEdges(
      graph.edges.map((e, i) => ({
        id:     `e${i}`,
        source: e.source,
        target: e.target,
        type:   'straight',
        style:  { stroke: 'rgba(163,179,188,0.18)', strokeWidth: 1 },
      }))
    )
  }, [graph])

  // ── Update isCurrent flag when selected note changes ──────────────────────
  useEffect(() => {
    if (!graph) return
    setAllNodes(prev => prev.map(n => ({
      ...n,
      data: { ...n.data, isCurrent: (n.data.path as string) === currentPath },
    })))
  }, [currentPath, graph])

  // ── Compute visible subset: current node + its direct neighbours ──────────
  const visibleNodes = useMemo(() => {
    if (!currentPath) return allNodes
    const cur = allNodes.find(n => (n.data.path as string) === currentPath)
    if (!cur) return allNodes   // note not in graph yet → show all

    const ids = new Set<string>([cur.id])
    allEdges.forEach(e => {
      if (e.source === cur.id) ids.add(e.target)
      if (e.target === cur.id) ids.add(e.source)
    })
    return allNodes.filter(n => ids.has(n.id))
  }, [currentPath, allNodes, allEdges])

  const visibleEdges = useMemo(() => {
    if (!currentPath) return allEdges
    const ids = new Set(visibleNodes.map(n => n.id))
    return allEdges.filter(e => ids.has(e.source) && ids.has(e.target))
  }, [currentPath, visibleNodes, allEdges])

  // ── Fit view whenever the visible set changes ─────────────────────────────
  useEffect(() => {
    const t = setTimeout(() => {
      rfRef.current?.fitView({ padding: 0.3, duration: 250 })
    }, 80)
    return () => clearTimeout(t)
  }, [currentPath])   // trigger on path change (visible set changes with it)

  // ── ReactFlow change handlers — operate on allNodes so positions persist ──
  const onNodesChange: OnNodesChange = useCallback(
    changes => setAllNodes(prev => applyNodeChanges(changes, prev)),
    [],
  )
  const onEdgesChange: OnEdgesChange = useCallback(
    changes => setAllEdges(prev => applyEdgeChanges(changes, prev)),
    [],
  )

  const handleNodeClick = useCallback((_: React.MouseEvent, node: Node) => {
    onNodeClick(node.data.path as string)
  }, [onNodeClick])

  // ── Empty state ───────────────────────────────────────────────────────────
  if (!graph || graph.nodes.length === 0) {
    return (
      <div className="h-full flex items-center justify-center p-4">
        <p className="text-[10px] text-accent-muted/30 italic text-center">
          Create notes with{' '}
          <code className="bg-white/5 px-1 rounded font-mono">[[wikilinks]]</code>
          {' '}pour voir le graphe.
        </p>
      </div>
    )
  }

  return (
    <ReactFlow
      nodes={visibleNodes}
      edges={visibleEdges}
      onNodesChange={onNodesChange}
      onEdgesChange={onEdgesChange}
      onNodeClick={handleNodeClick}
      onInit={instance => { rfRef.current = instance }}
      nodeTypes={nodeTypes}
      nodeOrigin={[0.5, 0.5]}   // positions refer to node centre
      fitView
      fitViewOptions={{ padding: 0.3 }}
      minZoom={0.2}
      maxZoom={3}
      nodesDraggable
      nodesConnectable={false}
      elementsSelectable={false}
    >
      <Background variant={BackgroundVariant.Dots} gap={20} size={1} color="rgba(255,255,255,0.04)" />
    </ReactFlow>
  )
}
