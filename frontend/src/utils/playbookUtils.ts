import type { PlaybookNode, PlaybookEdge } from '../api/playbooks'

/**
 * BFS topological sort — returns nodes in flow order (Start → … → End).
 * Cycles or disconnected nodes are appended at the end in their original order.
 */
export function topoSortNodes(nodes: PlaybookNode[], edges: PlaybookEdge[]): PlaybookNode[] {
  const nodeMap  = new Map(nodes.map(n => [n.id, n]))
  const inDegree = new Map(nodes.map(n => [n.id, 0]))
  const adj      = new Map<string, string[]>(nodes.map(n => [n.id, []]))

  for (const e of edges) {
    if (inDegree.has(e.target)) inDegree.set(e.target, (inDegree.get(e.target) ?? 0) + 1)
    adj.get(e.source)?.push(e.target)
  }

  const queue: string[] = []
  for (const [id, deg] of inDegree) if (deg === 0) queue.push(id)

  const visited = new Set<string>()
  const order: PlaybookNode[] = []

  while (queue.length > 0) {
    const id = queue.shift()!
    if (visited.has(id)) continue
    visited.add(id)
    const node = nodeMap.get(id)
    if (node) order.push(node)
    for (const nxt of adj.get(id) ?? []) {
      const newDeg = (inDegree.get(nxt) ?? 1) - 1
      inDegree.set(nxt, newDeg)
      if (newDeg === 0) queue.push(nxt)
    }
  }

  // Append unreachable nodes (cycles / isolated)
  for (const n of nodes) if (!visited.has(n.id)) order.push(n)
  return order
}
