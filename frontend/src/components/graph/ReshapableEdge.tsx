/**
 * Reshapable graph edges, shared by the playbook editor and the attack graph.
 *
 * A generated layout routes an edge straight through whatever happens to be in
 * the way. Rather than making the layout smarter — it cannot know which nodes
 * an analyst considers important — an edge carries waypoints: double-click to
 * add one, drag it to route around a node, double-click it to remove it.
 *
 * Nothing here is about playbooks. It lived under components/playbook/ only
 * because that is where it was first needed, which is why the attack graph
 * spent three sprints with default edges that crossed each other.
 */
/**
 * Playbook edges — reshapeable links.
 *
 * A link is no longer a fixed curve between two handles: the analyst can bend
 * it around nodes by adding waypoints, and pick the routing style that reads
 * best for that particular branch.
 *
 *   edge.data.waypoints : { x, y }[]                 — flow-coordinate bend points
 *   edge.data.shape     : 'curve' | 'step' | 'straight'
 *
 * Both live in `edge.data`, so they persist with the playbook (the backend
 * stores edges as free-form JSON) and render identically in the read-only
 * views — the case Playbook tab, the report panel and the PNG export.
 *
 * Editing is opt-in: a canvas that provides `EdgeEditContext` gets
 * draggable handles; everywhere else the edge is just drawn.
 */

import { createContext, useContext, useCallback } from 'react'
import { color } from '../../styles/tokens'
import type { MouseEvent as ReactMouseEvent, PointerEvent as ReactPointerEvent } from 'react'
import {
  BaseEdge, useReactFlow,
  getBezierPath, getSmoothStepPath, getStraightPath,
  type Edge, type EdgeProps,
} from '@xyflow/react'

// ── Types ─────────────────────────────────────────────────────────────────────

export interface Waypoint { x: number; y: number }

export type EdgeShape = 'curve' | 'step' | 'straight'

export interface GraphEdgeData {
  waypoints?: Waypoint[]
  shape?:     EdgeShape
  [key: string]: unknown
}

export const EDGE_SHAPES: { value: EdgeShape; label: string; hint: string }[] = [
  { value: 'curve',    label: 'Curve',        hint: 'Rounded link (default)' },
  { value: 'step',     label: 'Angles',       hint: 'Orthogonal routing - cleanly routes around nodes' },
  { value: 'straight', label: 'Droite',       hint: 'Segments rectilignes entre les points' },
]

/** Corner radius used when rounding a waypoint polyline. */
const CORNER_R = 16

// ── Edit context ──────────────────────────────────────────────────────────────

interface EdgeEditApi {
  /** Merge a patch into `edge.data`. Absent (no-op) in read-only canvases. */
  updateEdgeData: (edgeId: string, patch: GraphEdgeData) => void
  editable: boolean
  /** Snap a waypoint coordinate — the canvas passes its own grid step. */
  snap?: (v: number) => number
}

const NOOP_API: EdgeEditApi = { updateEdgeData: () => {}, editable: false }

export const EdgeEditContext = createContext<EdgeEditApi>(NOOP_API)

// ── Geometry helpers ──────────────────────────────────────────────────────────

export function edgeWaypoints(edge: Pick<Edge, 'data'>): Waypoint[] {
  const wps = (edge.data as GraphEdgeData | undefined)?.waypoints
  return Array.isArray(wps) ? wps.filter(p => typeof p?.x === 'number' && typeof p?.y === 'number') : []
}

export function edgeShape(edge: Pick<Edge, 'data'>): EdgeShape {
  const s = (edge.data as GraphEdgeData | undefined)?.shape
  return s === 'step' || s === 'straight' ? s : 'curve'
}

const dist = (a: Waypoint, b: Waypoint) => Math.hypot(b.x - a.x, b.y - a.y)

/** Unit vector from `from` towards `to`; zero-length segments yield (0,0). */
function unit(from: Waypoint, to: Waypoint): Waypoint {
  const d = dist(from, to)
  return d === 0 ? { x: 0, y: 0 } : { x: (to.x - from.x) / d, y: (to.y - from.y) / d }
}

/** Polyline with rounded-control corners — the "curve" shape once waypoints exist. */
export function roundedPolylinePath(pts: Waypoint[], r = CORNER_R): string {
  if (pts.length < 2) return ''
  let d = `M ${pts[0].x},${pts[0].y}`
  for (let i = 1; i < pts.length - 1; i++) {
    const p = pts[i]
    const before = pts[i - 1]
    const after  = pts[i + 1]
    const rIn  = Math.min(r, dist(before, p) / 2)
    const rOut = Math.min(r, dist(p, after) / 2)
    const vIn  = unit(p, before)
    const vOut = unit(p, after)
    d += ` L ${p.x + vIn.x * rIn},${p.y + vIn.y * rIn}`
    d += ` Q ${p.x},${p.y} ${p.x + vOut.x * rOut},${p.y + vOut.y * rOut}`
  }
  const last = pts[pts.length - 1]
  return `${d} L ${last.x},${last.y}`
}

/**
 * Expand a polyline into an orthogonal one: every diagonal segment becomes an
 * elbow. Alternating the elbow axis keeps the result readable when several
 * waypoints line up.
 */
export function orthogonalPoints(pts: Waypoint[]): Waypoint[] {
  if (pts.length < 2) return pts
  const out: Waypoint[] = [pts[0]]
  for (let i = 1; i < pts.length; i++) {
    const a = out[out.length - 1]
    const b = pts[i]
    if (a.x !== b.x && a.y !== b.y) {
      // Turn on the longer axis first — the elbow then hugs the waypoint
      if (Math.abs(b.x - a.x) >= Math.abs(b.y - a.y)) out.push({ x: b.x, y: a.y })
      else                                            out.push({ x: a.x, y: b.y })
    }
    out.push(b)
  }
  return out
}

export function straightPath(pts: Waypoint[]): string {
  if (pts.length < 2) return ''
  return pts.map((p, i) => `${i === 0 ? 'M' : 'L'} ${p.x},${p.y}`).join(' ')
}

/** Squared distance from `p` to segment [a,b] — used to pick an insert slot. */
function segDist2(p: Waypoint, a: Waypoint, b: Waypoint): number {
  const vx = b.x - a.x, vy = b.y - a.y
  const len2 = vx * vx + vy * vy
  const t = len2 === 0 ? 0 : Math.max(0, Math.min(1, ((p.x - a.x) * vx + (p.y - a.y) * vy) / len2))
  const cx = a.x + t * vx, cy = a.y + t * vy
  return (p.x - cx) ** 2 + (p.y - cy) ** 2
}

/** Index at which a new waypoint clicked at `p` should be inserted. */
function insertIndex(p: Waypoint, pts: Waypoint[]): number {
  let best = 0
  let bestD = Infinity
  for (let i = 0; i < pts.length - 1; i++) {
    const d = segDist2(p, pts[i], pts[i + 1])
    if (d < bestD) { bestD = d; best = i }
  }
  return best
}

/**
 * The full SVG path for an edge — shared by the React component and the PNG
 * exporter, so a reshaped link exports exactly as it looks on screen.
 */
export function buildEdgePath(
  shape: EdgeShape,
  waypoints: Waypoint[],
  source: Waypoint,
  target: Waypoint,
): string {
  const pts = [source, ...waypoints, target]
  if (shape === 'straight') return straightPath(pts)
  if (shape === 'step')     return roundedPolylinePath(orthogonalPoints(pts), 8)
  return roundedPolylinePath(pts)
}

// ── Editable edge component ───────────────────────────────────────────────────

export function ReshapableEdge({
  id,
  sourceX, sourceY, targetX, targetY,
  sourcePosition, targetPosition,
  markerEnd, style, data, selected,
}: EdgeProps) {
  const { updateEdgeData, editable, snap } = useContext(EdgeEditContext)
  const { screenToFlowPosition } = useReactFlow()

  const d         = (data ?? {}) as GraphEdgeData
  const waypoints = edgeWaypoints({ data: d })
  const shape     = edgeShape({ data: d })

  const src: Waypoint = { x: sourceX, y: sourceY }
  const tgt: Waypoint = { x: targetX, y: targetY }

  // ── Path ────────────────────────────────────────────────────────────────
  let path: string
  if (waypoints.length > 0) {
    path = buildEdgePath(shape, waypoints, src, tgt)
  } else if (shape === 'straight') {
    [path] = getStraightPath({ sourceX, sourceY, targetX, targetY })
  } else if (shape === 'step') {
    [path] = getSmoothStepPath({
      sourceX, sourceY, sourcePosition, targetX, targetY, targetPosition, borderRadius: 8,
    })
  } else {
    // Adaptive curvature: short links stay straight instead of folding back
    const dd = dist(src, tgt)
    ;[path] = getBezierPath({
      sourceX, sourceY, sourcePosition,
      targetX, targetY, targetPosition,
      curvature: dd < 80 ? 0.05 : 0.25,
    })
  }

  // ── Waypoint mutations ──────────────────────────────────────────────────

  const setWaypoints = useCallback(
    (next: Waypoint[]) => updateEdgeData(id, { waypoints: next }),
    [id, updateEdgeData],
  )

  const flowPoint = useCallback(
    (e: { clientX: number; clientY: number }): Waypoint => {
      const p = screenToFlowPosition({ x: e.clientX, y: e.clientY })
      const round = snap ?? Math.round
      return { x: round(p.x), y: round(p.y) }
    },
    [screenToFlowPosition, snap],
  )

  /** Drag a waypoint. Pointer capture keeps the gesture alive off-target. */
  const startDrag = useCallback((e: ReactPointerEvent<SVGCircleElement>, index: number) => {
    if (!editable) return
    e.stopPropagation()
    e.preventDefault()
    e.currentTarget.setPointerCapture(e.pointerId)

    const move = (ev: PointerEvent) => {
      const p = flowPoint(ev)
      setWaypoints(waypoints.map((w, i) => (i === index ? p : w)))
    }
    const up = () => {
      window.removeEventListener('pointermove', move)
      window.removeEventListener('pointerup',   up)
    }
    window.addEventListener('pointermove', move)
    window.addEventListener('pointerup',   up)
  }, [editable, flowPoint, setWaypoints, waypoints])

  /** Double-click on the link — bend it at the clicked spot. */
  const addWaypoint = useCallback((e: ReactMouseEvent<SVGPathElement>) => {
    if (!editable) return
    e.stopPropagation()
    const p   = flowPoint(e)
    const pts = [src, ...waypoints, tgt]
    const at  = insertIndex(p, pts)
    const next = [...waypoints]
    next.splice(at, 0, p)
    setWaypoints(next)
  }, [editable, flowPoint, setWaypoints, waypoints, src, tgt])

  /** Double-click a bend point — straighten that corner out again. */
  const removeWaypoint = useCallback((e: ReactMouseEvent<SVGCircleElement>, index: number) => {
    if (!editable) return
    e.stopPropagation()
    setWaypoints(waypoints.filter((_, i) => i !== index))
  }, [editable, setWaypoints, waypoints])

  // One insert handle per segment of source → …waypoints… → target
  const midpoints: (Waypoint & { index: number })[] = []
  if (editable && selected) {
    const pts = [src, ...waypoints, tgt]
    for (let i = 0; i < pts.length - 1; i++) {
      midpoints.push({
        x: (pts[i].x + pts[i + 1].x) / 2,
        y: (pts[i].y + pts[i + 1].y) / 2,
        index: i,
      })
    }
  }

  const accent = (style?.stroke as string) || color('--accent')

  return (
    <>
      <BaseEdge id={id} path={path} markerEnd={markerEnd} style={style} />

      {/* Fat invisible hit area: double-click anywhere on the link to bend it */}
      {editable && (
        <path
          /* `nopan` keeps ReactFlow's d3-zoom filter off this element, so a
             double-click bends the link instead of zooming the canvas. */
          className="nopan nodrag"
          d={path}
          fill="none"
          stroke="transparent"
          strokeWidth={20}
          style={{ pointerEvents: 'stroke', cursor: selected ? 'copy' : 'pointer' }}
          onDoubleClick={addWaypoint}
        />
      )}

      {editable && selected && (
        <g className="nodrag nopan">
          {/* Insert handles at each segment midpoint */}
          {midpoints.map(m => (
            <circle
              key={`mid-${m.index}`}
              cx={m.x} cy={m.y} r={4}
              fill={color('--surface-canvas')}
              stroke={accent}
              strokeOpacity={0.5}
              strokeWidth={1.5}
              style={{ pointerEvents: 'all', cursor: 'copy' }}
              onPointerDown={e => {
                e.stopPropagation()
                const round = snap ?? Math.round
                const next = [...waypoints]
                next.splice(m.index, 0, { x: round(m.x), y: round(m.y) })
                setWaypoints(next)
              }}
            >
              <title>Click to add a waypoint</title>
            </circle>
          ))}

          {/* Draggable bend points */}
          {waypoints.map((w, i) => (
            <circle
              key={`wp-${i}`}
              cx={w.x} cy={w.y} r={6}
              fill={accent}
              stroke={color('--surface-canvas')}
              strokeWidth={2}
              style={{ pointerEvents: 'all', cursor: 'grab' }}
              onPointerDown={e => startDrag(e, i)}
              onDoubleClick={e => removeWaypoint(e, i)}
            >
              <title>Drag to move - double-click to delete</title>
            </circle>
          ))}
        </g>
      )}
    </>
  )
}

// ── Edge type map ─────────────────────────────────────────────────────────────
// 'smoothstep' is overridden so playbooks saved before reshaping existed pick
// up the new renderer without a migration.

export const EDGE_TYPES = {
  smoothstep: ReshapableEdge,
  playbook:   ReshapableEdge,
}
