import { createContext, useContext } from 'react'
import {
  Handle, Position, NodeResizer,
  type NodeProps,
} from '@xyflow/react'
import { CheckCircle2, ShieldCheck, GitBranch, ExternalLink } from '../../ui/icons'

// ── Layout direction context ──────────────────────────────────────────────────
// Allows PlaybookEditor to tell node components which direction the graph flows,
// so they can place handles on the correct sides.

export type LayoutDir = 'DOWN' | 'RIGHT'

export const LayoutDirContext = createContext<LayoutDir>('DOWN')

// ── Node data type ────────────────────────────────────────────────────────────

interface NodeData {
  label: string
  description?: string
  done?: boolean
  assignee?: NodeAssignee | null
  [key: string]: unknown
}

// ── Assignee badge ────────────────────────────────────────────────────────────
// Injected read-only by the case Playbook tab (assignment itself happens in the
// checklist); absent in the playbook library editor, where nodes carry no case
// state.

interface NodeAssignee { kind: 'user' | 'external'; label: string; color?: string }

function AssigneeBadge({ assignee }: { assignee: NodeAssignee }) {
  const color = assignee.color || '#94a3b8'
  return (
    <span
      className="inline-flex items-center max-w-full mt-1.5 px-1.5 h-4 rounded-control border text-label font-medium truncate"
      style={{ color, borderColor: `${color}40`, backgroundColor: `${color}14` }}
      title={assignee.kind === 'external' ? `${assignee.label} (externe)` : assignee.label}
    >
      {assignee.label}
    </span>
  )
}

// ── StartNode ─────────────────────────────────────────────────────────────────

export function StartNode({ data }: NodeProps) {
  const d   = data as NodeData
  const dir = useContext(LayoutDirContext)
  return (
    <div className="px-4 py-2 rounded-pill border-2 border-accent bg-accent/10 text-accent text-label font-bold min-w-[80px] text-center shadow-lg">
      {d.label || 'Start'}
      <Handle
        type="source"
        position={dir === 'RIGHT' ? Position.Right : Position.Bottom}
        className="!bg-accent !border-accent"
      />
    </div>
  )
}

// ── EndNode ───────────────────────────────────────────────────────────────────

export function EndNode({ data }: NodeProps) {
  const d   = data as NodeData
  const dir = useContext(LayoutDirContext)
  return (
    <div className="px-4 py-2 rounded-pill border-2 border-severity-critical bg-severity-critical/10 text-severity-critical text-label font-bold min-w-[80px] text-center shadow-lg">
      <Handle
        type="target"
        position={dir === 'RIGHT' ? Position.Left : Position.Top}
        className="!bg-severity-critical !border-severity-critical"
      />
      {d.label || 'End'}
    </div>
  )
}

// ── StepNode ──────────────────────────────────────────────────────────────────

export function StepNode({ data, selected }: NodeProps) {
  const d   = data as NodeData
  const dir = useContext(LayoutDirContext)
  const done = !!d.done
  return (
    <div className={`relative px-4 py-3 border min-w-[120px] w-full h-full shadow-lg transition-colors ${
      done
        ? 'border-accent/60 bg-accent/10'
        : selected
          ? 'border-accent bg-panel'
          : 'border-strong bg-panel'
    }`}>
      <NodeResizer
        isVisible={selected && !done}
        minWidth={120}
        minHeight={40}
        lineStyle={{ borderColor: 'rgba(255,255,255,0.15)' }}
        handleStyle={{ backgroundColor: '#2DD4BF', borderColor: '#2DD4BF', width: 6, height: 6, borderRadius: 2 }}
      />
      <Handle
        type="target"
        position={dir === 'RIGHT' ? Position.Left : Position.Top}
        className="!bg-fg/40 !border-strong"
      />
      {done && (
        <span className="absolute top-1.5 right-1.5 text-accent">
          <CheckCircle2 size={11} />
        </span>
      )}
      <p className={`text-label font-semibold leading-snug pr-4 ${done ? 'text-accent/80' : 'text-fg'}`}>
        {d.label}
      </p>
      {d.description && !done && (
        <p className="text-label text-fg-secondary mt-1 leading-snug">{d.description}</p>
      )}
      {d.assignee && <AssigneeBadge assignee={d.assignee} />}
      <Handle
        type="source"
        position={dir === 'RIGHT' ? Position.Right : Position.Bottom}
        className="!bg-fg/40 !border-strong"
      />
    </div>
  )
}

// ── DecisionNode ──────────────────────────────────────────────────────────────
// Vertical (DOWN):   target=Top,  yes=Bottom, no=Right
// Horizontal (RIGHT): target=Left, yes=Right,  no=Bottom

const DIAMOND_W = 160
const DIAMOND_H = 80

export function DecisionNode({ data, selected }: NodeProps) {
  const d   = data as NodeData
  const dir = useContext(LayoutDirContext)
  const done = !!d.done

  const cx = DIAMOND_W / 2
  const cy = DIAMOND_H / 2
  const points = `${cx},0 ${DIAMOND_W},${cy} ${cx},${DIAMOND_H} 0,${cy}`

  const strokeColor = done ? '#2DD4BF' : selected ? '#FFAF00' : 'rgba(255,175,0,0.40)'
  const fillColor   = done ? 'rgba(45,212,191,0.10)' : 'rgba(255,175,0,0.07)'
  const textColor   = done ? 'text-accent' : 'text-severity-medium'

  return (
    <div style={{ width: DIAMOND_W, height: DIAMOND_H }} className="relative">
      {/* Entry handle */}
      <Handle
        type="target"
        position={dir === 'RIGHT' ? Position.Left : Position.Top}
        className="!bg-severity-medium !border-severity-medium"
      />

      <svg width={DIAMOND_W} height={DIAMOND_H} style={{ overflow: 'visible' }} className="absolute inset-0">
        <polygon points={points} fill={fillColor} stroke={strokeColor} strokeWidth="1.5" />
      </svg>

      <div className="absolute inset-0 flex items-center justify-center px-8 pointer-events-none">
        <p className={`text-label font-semibold leading-snug text-center ${textColor}`}>
          {d.label}
        </p>
      </div>
      {done && (
        <span className="absolute top-1 right-4 pointer-events-none text-accent">
          <CheckCircle2 size={11} />
        </span>
      )}
      {d.assignee && (
        <span className="absolute -bottom-1 left-1/2 -translate-x-1/2 pointer-events-none">
          <AssigneeBadge assignee={d.assignee} />
        </span>
      )}

      {/* "Yes" — main flow continuation */}
      <Handle
        type="source"
        position={dir === 'RIGHT' ? Position.Right : Position.Bottom}
        id="yes"
        className="!bg-accent !border-accent"
        title="Yes"
      />
      {/* "No" — branch */}
      <Handle
        type="source"
        position={dir === 'RIGHT' ? Position.Top : Position.Right}
        id="no"
        className="!bg-severity-critical !border-severity-critical"
        title="No"
      />
    </div>
  )
}

// ── RemediationNode ───────────────────────────────────────────────────────────

export function RemediationNode({ data, selected }: NodeProps) {
  const d   = data as NodeData
  const dir = useContext(LayoutDirContext)
  const done = !!d.done
  return (
    <div className={`relative px-4 py-3 border min-w-[120px] w-full h-full shadow-lg transition-colors ${
      done
        ? 'border-severity-low/60 bg-severity-low/10'
        : selected
          ? 'border-severity-low bg-panel'
          : 'border-severity-low/40 bg-panel'
    }`}>
      <NodeResizer
        isVisible={selected && !done}
        minWidth={120}
        minHeight={40}
        lineStyle={{ borderColor: 'rgba(96,165,250,0.20)' }}
        handleStyle={{ backgroundColor: '#60a5fa', borderColor: '#60a5fa', width: 6, height: 6, borderRadius: 2 }}
      />
      <Handle
        type="target"
        position={dir === 'RIGHT' ? Position.Left : Position.Top}
        className="!bg-severity-low/40 !border-severity-low/40"
      />
      <span className="absolute top-1.5 left-1.5 text-severity-low/50">
        <ShieldCheck size={10} />
      </span>
      {done && (
        <span className="absolute top-1.5 right-1.5 text-severity-low">
          <CheckCircle2 size={11} />
        </span>
      )}
      <p className={`text-label font-semibold leading-snug pl-4 pr-4 ${done ? 'text-severity-low/80' : 'text-severity-low'}`}>
        {d.label}
      </p>
      {d.description && !done && (
        <p className="text-label text-fg-secondary mt-1 leading-snug pl-4">{d.description}</p>
      )}
      {d.assignee && <span className="block pl-4"><AssigneeBadge assignee={d.assignee} /></span>}
      <Handle
        type="source"
        position={dir === 'RIGHT' ? Position.Right : Position.Bottom}
        className="!bg-severity-low/40 !border-severity-low/40"
      />
    </div>
  )
}

// ── PlaybookRefNode ───────────────────────────────────────────────────────────
// Represents a link to another playbook that can be attached to the case
// when this node is reached during investigation.

export function PlaybookRefNode({ data, selected }: NodeProps) {
  const d   = data as NodeData & { linked_playbook_id?: string; linked_playbook_name?: string }
  const dir = useContext(LayoutDirContext)
  const done = !!d.done
  const hasLink = !!(d.linked_playbook_id || d.linked_playbook_name)

  return (
    <div className={`relative px-4 py-3 border min-w-[120px] w-full h-full shadow-lg transition-colors ${
      done
        ? 'border-data-2/60 bg-data-2/10'
        : selected
          ? 'border-data-2 bg-panel'
          : 'border-data-2/40 bg-panel'
    }`}>
      <NodeResizer
        isVisible={selected && !done}
        minWidth={120}
        minHeight={40}
        lineStyle={{ borderColor: 'rgba(192,132,252,0.20)' }}
        handleStyle={{ backgroundColor: '#c084fc', borderColor: '#c084fc', width: 6, height: 6, borderRadius: 2 }}
      />
      <Handle
        type="target"
        position={dir === 'RIGHT' ? Position.Left : Position.Top}
        className="!bg-data-2/40 !border-data-2/40"
      />
      <span className="absolute top-1.5 left-1.5 text-data-2/60">
        <GitBranch size={10} />
      </span>
      {done && (
        <span className="absolute top-1.5 right-1.5 text-data-2">
          <CheckCircle2 size={11} />
        </span>
      )}
      {!done && hasLink && (
        <span className="absolute top-1.5 right-1.5 text-data-2/50">
          <ExternalLink size={10} />
        </span>
      )}
      <p className={`text-label font-semibold leading-snug pl-4 pr-4 ${done ? 'text-data-2/80' : 'text-data-2'}`}>
        {d.label || 'Playbook'}
      </p>
      {d.linked_playbook_name && !done && (
        <p className="text-label text-data-2/50 mt-0.5 pl-4 truncate italic">
          → {d.linked_playbook_name}
        </p>
      )}
      {!hasLink && !done && (
        <p className="text-label text-data-2/30 mt-0.5 pl-4 italic">not linked</p>
      )}
      {d.assignee && <span className="block pl-4"><AssigneeBadge assignee={d.assignee} /></span>}
      <Handle
        type="source"
        position={dir === 'RIGHT' ? Position.Right : Position.Bottom}
        className="!bg-data-2/40 !border-data-2/40"
      />
    </div>
  )
}

// ── FrameNode ─────────────────────────────────────────────────────────────────
// Decorative zone node: transparent colored background + title, no handles.
// Rendered behind other nodes via zIndex: -1 set at creation.

export function FrameNode({ data, selected }: NodeProps) {
  const d     = data as { label?: string; color?: string; [key: string]: unknown }
  const color = d.color ?? '#3b82f6'
  const label = d.label ?? 'Zone'

  return (
    <div
      className="w-full h-full "
      style={{
        backgroundColor: `${color}18`,
        border: `1.5px solid ${color}${selected ? '70' : '28'}`,
        borderRadius: 12,
      }}
    >
      <NodeResizer
        isVisible={selected}
        minWidth={150}
        minHeight={100}
        lineStyle={{ borderColor: `${color}50` }}
        handleStyle={{ backgroundColor: color, borderColor: color, width: 8, height: 8, borderRadius: 2 }}
      />
      <span
        className="absolute top-2.5 left-3.5 text-label font-bold tracking-wider select-none pointer-events-none"
        style={{ color: `${color}cc` }}
      >
        {label}
      </span>
    </div>
  )
}

// ── Node type map ─────────────────────────────────────────────────────────────

export const NODE_TYPES = {
  start:        StartNode,
  step:         StepNode,
  decision:     DecisionNode,
  end:          EndNode,
  remediation:  RemediationNode,
  frame:        FrameNode,
  playbook_ref: PlaybookRefNode,
}

// ── Edge types ────────────────────────────────────────────────────────────────
// Edges live in components/graph/ReshapableEdge.tsx — shared with the attack graph.
// Re-exported here so the existing `import { NODE_TYPES, EDGE_TYPES }` call
// sites keep working.

export { EDGE_TYPES, EdgeEditContext } from '../graph/ReshapableEdge'
export type { EdgeShape, Waypoint, GraphEdgeData } from '../graph/ReshapableEdge'
