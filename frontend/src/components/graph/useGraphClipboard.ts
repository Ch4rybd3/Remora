import { useEffect, useRef } from 'react'
import type { Dispatch, SetStateAction } from 'react'
import type { Edge, Node } from '@xyflow/react'

/**
 * Ctrl+C / Ctrl+V on a graph canvas.
 *
 * Copying takes the selected nodes and the edges *between* them — an edge whose
 * other end is not in the selection would paste as a dangling connection, so it
 * is dropped rather than half-copied.
 *
 * The paste is offset and left selected, so a repeated paste cascades instead
 * of stacking invisibly on top of the original.
 */
export function useGraphClipboard({
  selectedNodes,
  edges,
  setNodes,
  setEdges,
  makeNodeId,
  enabled = true,
}: {
  selectedNodes: Node[]
  edges: Edge[]
  setNodes: Dispatch<SetStateAction<Node[]>>
  setEdges: Dispatch<SetStateAction<Edge[]>>
  /** The canvas owns its id scheme, so it supplies one. */
  makeNodeId: () => string
  /** Off while a modal or a text field has focus. */
  enabled?: boolean
}) {
  const clipboard = useRef<{ nodes: Node[]; edges: Edge[] } | null>(null)

  useEffect(() => {
    if (!enabled) return

    const onKeyDown = (e: KeyboardEvent) => {
      if (!(e.ctrlKey || e.metaKey)) return

      // Never hijack the shortcut while the analyst is editing text.
      const el = document.activeElement
      if (el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement ||
          (el instanceof HTMLElement && el.isContentEditable)) return

      if (e.key === 'c' && selectedNodes.length > 0) {
        const ids = new Set(selectedNodes.map((n) => n.id))
        clipboard.current = {
          nodes: selectedNodes,
          edges: edges.filter((ed) => ids.has(ed.source) && ids.has(ed.target)),
        }
      }

      if (e.key === 'v' && clipboard.current) {
        const { nodes: cbNodes, edges: cbEdges } = clipboard.current
        const idMap = new Map<string, string>()
        const OFFSET = 40

        const newNodes: Node[] = cbNodes.map((n) => {
          const newId = makeNodeId()
          idMap.set(n.id, newId)
          return {
            ...n,
            id: newId,
            position: { x: n.position.x + OFFSET, y: n.position.y + OFFSET },
            selected: true,
          }
        })
        const newEdges: Edge[] = cbEdges.map((ed) => ({
          ...ed,
          id: `edge-${Date.now()}-${Math.random().toString(36).slice(2)}`,
          source: idMap.get(ed.source) ?? ed.source,
          target: idMap.get(ed.target) ?? ed.target,
        }))

        setNodes((nds) => [...nds.map((n) => ({ ...n, selected: false })), ...newNodes])
        setEdges((eds) => [...eds, ...newEdges])
      }
    }

    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [enabled, selectedNodes, edges, setNodes, setEdges, makeNodeId])
}

/**
 * The props every canvas in Remora passes to ReactFlow.
 *
 * Collected here because they are the interaction model, not styling: Delete
 * removes what is selected, dragging on empty space selects rather than pans,
 * middle and right drag pan, and everything snaps to the same grid. A canvas
 * that sets these differently behaves differently for no reason the analyst can
 * see — which is exactly what the attack graph did, with deleteKeyCode set to
 * null so Delete did nothing at all.
 */
export const GRAPH_GRID = 20
export const GRAPH_MOVE_SNAP = GRAPH_GRID / 2

export const CANVAS_INTERACTION: {
  snapToGrid: boolean
  snapGrid: [number, number]
  selectionOnDrag: boolean
  panOnDrag: number[]
  deleteKeyCode: string
  multiSelectionKeyCode: string[]
} = {
  snapToGrid: true,
  snapGrid: [GRAPH_MOVE_SNAP, GRAPH_MOVE_SNAP],
  selectionOnDrag: true,
  panOnDrag: [1, 2],
  deleteKeyCode: 'Delete',
  multiSelectionKeyCode: ['Meta', 'Control', 'Shift'],
}
