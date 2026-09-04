import { useCallback, useMemo } from 'react'
import type { Dispatch, SetStateAction } from 'react'
import type { Edge } from '@xyflow/react'

import { Spline } from '../../ui/icons'
import {
  EDGE_SHAPES, edgeShape, edgeWaypoints,
  type EdgeShape, type GraphEdgeData,
} from './ReshapableEdge'

/**
 * Edge reshaping, shared by every canvas that has edges.
 *
 * The playbook editor grew this first: an automatic layout routes edges through
 * whatever is in the way, and rather than teaching the layout which nodes
 * matter, the analyst bends the edge. The attack graph needed exactly the same
 * thing and had none of it, because the logic lived inside the playbook page.
 */
export function useEdgeShaping(
  setEdges: Dispatch<SetStateAction<Edge[]>>,
  selectedEdges: Edge[],
  /** The canvas grid step, so a dragged waypoint lands on it. */
  snap?: (v: number) => number,
) {
  const updateEdgeData = useCallback(
    (edgeId: string, patch: GraphEdgeData) => {
      setEdges((eds) =>
        eds.map((e) => (e.id === edgeId ? { ...e, data: { ...(e.data ?? {}), ...patch } } : e)),
      )
    },
    [setEdges],
  )

  const edgeEditApi = useMemo(
    () => ({ updateEdgeData, editable: true, snap }),
    [updateEdgeData, snap],
  )

  const selectedIds = useMemo(() => new Set(selectedEdges.map((e) => e.id)), [selectedEdges])

  const currentShape: EdgeShape | null =
    selectedEdges.length > 0 ? edgeShape(selectedEdges[0]) : null

  const waypointCount = selectedEdges.reduce((n, e) => n + edgeWaypoints(e).length, 0)

  const applyShape = useCallback(
    (shape: EdgeShape) => {
      setEdges((eds) =>
        eds.map((e) => (selectedIds.has(e.id) ? { ...e, data: { ...(e.data ?? {}), shape } } : e)),
      )
    },
    [setEdges, selectedIds],
  )

  /** Drop every bend point of the selected edges — back to a plain connection. */
  const clearWaypoints = useCallback(() => {
    setEdges((eds) =>
      eds.map((e) => (selectedIds.has(e.id) ? { ...e, data: { ...(e.data ?? {}), waypoints: [] } } : e)),
    )
  }, [setEdges, selectedIds])

  return { edgeEditApi, currentShape, waypointCount, applyShape, clearWaypoints }
}

interface EdgeShapePickerProps {
  currentShape: EdgeShape | null
  waypointCount: number
  onApply: (shape: EdgeShape) => void
  onClear: () => void
}

/** The toolbar control. Renders nothing when no edge is selected. */
export function EdgeShapePicker({
  currentShape, waypointCount, onApply, onClear,
}: EdgeShapePickerProps) {
  if (currentShape === null) return null
  return (
    <div
      className="flex items-center gap-1 px-2 py-1 rounded-control border border-hairline"
      title="Double-click an edge to add a waypoint, then drag it to route around a node"
    >
      <Spline size={11} className="text-fg-muted shrink-0" />
      {EDGE_SHAPES.map((shape) => (
        <button
          key={shape.value}
          onClick={() => onApply(shape.value)}
          title={shape.hint}
          className={`text-label px-1.5 py-0.5 rounded-control transition-colors ${
            currentShape === shape.value
              ? 'bg-accent/10 text-accent'
              : 'text-fg-secondary hover:text-fg hover:bg-hover'
          }`}
        >
          {shape.label}
        </button>
      ))}
      {waypointCount > 0 && (
        <button
          onClick={onClear}
          title="Remove every waypoint from the selected edges"
          className="text-label px-1.5 py-0.5 rounded-control text-fg-secondary hover:text-fg
                     hover:bg-hover transition-colors border-l border-hairline ml-0.5 pl-2"
        >
          clear {waypointCount} pt{waypointCount > 1 ? 's' : ''}
        </button>
      )}
    </div>
  )
}
