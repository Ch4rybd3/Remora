/**
 * ELK-based automatic graph layout.
 *
 * Uses the "layered" algorithm (Sugiyama-style) which is ideal for
 * flowcharts and DAGs. Positions are snapped to the 20 px grid so
 * handles always land on grid lines after layout.
 *
 * NOTE: requires `elkjs` — run `npm install` if not already done.
 */

// elkjs ships a self-contained browser bundle that runs synchronously
// (no web-worker needed). The @ts-ignore avoids the missing sub-module
// declaration while preserving full runtime behaviour.
// eslint-disable-next-line @typescript-eslint/ban-ts-comment
// @ts-ignore
import ELK from 'elkjs/lib/elk.bundled.js'
import type { Node, Edge } from '@xyflow/react'

 
const elk = new ELK() as any

const GRID = 20
const snap = (v: number) => Math.round(v / GRID) * GRID

export interface ElkLayoutOptions {
  /** Main layout direction. Default: 'DOWN' (top → bottom). */
  direction?: 'DOWN' | 'UP' | 'LEFT' | 'RIGHT'
  /** Gap between successive node layers (px). Default: 60. */
  layerSpacing?: number
  /** Gap between sibling nodes in the same layer (px). Default: 40. */
  nodeSpacing?: number
}

/**
 * Compute an ELK layered layout and return nodes with updated positions.
 * Node dimensions come from `node.measured` (preferred) or `node.style`,
 * falling back to 200 × 80 px if the node has never been rendered.
 */
export async function applyElkLayout(
  nodes: Node[],
  edges: Edge[],
  opts: ElkLayoutOptions = {},
): Promise<Node[]> {
  const {
    direction    = 'DOWN',
    layerSpacing = 60,
    nodeSpacing  = 40,
  } = opts

  if (nodes.length === 0) return nodes

  const elkNodes = nodes.map(n => ({
    id:     n.id,
    width:  n.measured?.width  ?? (n.style?.width  as number | undefined) ?? 200,
    height: n.measured?.height ?? (n.style?.height as number | undefined) ?? 80,
  }))

  const elkEdges = edges.map(e => ({
    id:      e.id,
    sources: [e.source],
    targets: [e.target],
  }))

  const laid = await elk.layout({
    id: 'root',
    layoutOptions: {
      'elk.algorithm':                              'layered',
      'elk.direction':                              direction,
      'elk.layered.spacing.nodeNodeBetweenLayers':  String(layerSpacing),
      'elk.spacing.nodeNode':                       String(nodeSpacing),
      'elk.edgeRouting':                            'SPLINES',
      'elk.layered.nodePlacement.strategy':         'BRANDES_KOEPF',
      'elk.layered.crossingMinimization.strategy':  'LAYER_SWEEP',
    },
    children: elkNodes,
    edges:    elkEdges,
  })

   
  const posMap = new Map<string, { x: number; y: number }>(
     
    (laid.children ?? []).map((n: any) => [n.id, { x: n.x ?? 0, y: n.y ?? 0 }]),
  )

  return nodes.map(n => {
    const pos = posMap.get(n.id)
    if (!pos) return n
    return { ...n, position: { x: snap(pos.x), y: snap(pos.y) } }
  })
}
