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
      className="inline-flex items-center max-w-full mt-1.5 px-1.5 h-4 rounded border text-[8px] font-medium truncate"
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
    <div className="px-4 py-2 rounded-full border-2 border-accent-green bg-accent-green/10 text-accent-green text-xs font-bold min-w-[80px] text-center shadow-lg">
      {d.label || 'Start'}
      <Handle
        type="source"
        position={dir === 'RIGHT' ? Position.Right : Position.Bottom}
        className="!bg-accent-green !border-accent-green"
      />
    </div>
  )
}

// ── EndNode ───────────────────────────────────────────────────────────────────

export function EndNode({ data }: NodeProps) {
  const d   = data as NodeData
  const dir = useContext(LayoutDirContext)
  return (
    <div className="px-4 py-2 rounded-full border-2 border-severity-critical bg-severity-critical/10 text-severity-critical text-xs font-bold min-w-[80px] text-center shadow-lg">
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
    <div className={`relative px-4 py-3 rounded-lg border min-w-[120px] w-full h-full shadow-lg transition-colors ${
      done
        ? 'border-accent-green/60 bg-accent-green/10'
        : selected
          ? 'border-accent-green bg-bg-card'
          : 'border-white/20 bg-bg-card'
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
        className="!bg-white/40 !border-white/40"
      />
      {done && (
        <span className="absolute top-1.5 right-1.5 text-accent-green">
          <CheckCircle2 size={11} />
        </span>
      )}
      <p className={`text-xs font-semibold leading-snug pr-4 ${done ? 'text-accent-green/80' : 'text-white'}`}>
        {d.label}
      </p>
      {d.description && !done && (
        <p className="text-[10px] text-accent-muted mt-1 leading-snug">{d.description}</p>
      )}
      {d.assignee && <AssigneeBadge assignee={d.assignee} />}
      <Handle
        type="source"
        position={dir === 'RIGHT' ? Position.Right : Position.Bottom}
        className="!bg-white/40 !border-white/40"
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
  const textColor   = done ? 'text-accent-green' : 'text-severity-medium'

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
        <p className={`text-[11px] font-semibold leading-snug text-center ${textColor}`}>
          {d.label}
        </p>
      </div>
      {done && (
        <span className="absolute top-1 right-4 pointer-events-none text-accent-green">
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
        className="!bg-accent-green !border-accent-green"
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
    <div className={`relative px-4 py-3 rounded-lg border min-w-[120px] w-full h-full shadow-lg transition-colors ${
      done
        ? 'border-blue-400/60 bg-blue-400/10'
        : selected
          ? 'border-blue-400 bg-bg-card'
          : 'border-blue-400/40 bg-bg-card'
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
        className="!bg-blue-400/40 !border-blue-400/40"
      />
      <span className="absolute top-1.5 left-1.5 text-blue-400/50">
        <ShieldCheck size={10} />
      </span>
      {done && (
        <span className="absolute top-1.5 right-1.5 text-blue-400">
          <CheckCircle2 size={11} />
        </span>
      )}
      <p className={`text-xs font-semibold leading-snug pl-4 pr-4 ${done ? 'text-blue-400/80' : 'text-blue-300'}`}>
        {d.label}
      </p>
      {d.description && !done && (
        <p className="text-[10px] text-accent-muted mt-1 leading-snug pl-4">{d.description}</p>
      )}
      {d.assignee && <span className="block pl-4"><AssigneeBadge assignee={d.assignee} /></span>}
      <Handle
        type="source"
        position={dir === 'RIGHT' ? Position.Right : Position.Bottom}
        className="!bg-blue-400/40 !border-blue-400/40"
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
    <div className={`relative px-4 py-3 rounded-lg border min-w-[120px] w-full h-full shadow-lg transition-colors ${
      done
        ? 'border-purple-400/60 bg-purple-400/10'
        : selected
          ? 'border-purple-400 bg-bg-card'
          : 'border-purple-400/40 bg-bg-card'
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
        className="!bg-purple-400/40 !border-purple-400/40"
      />
      <span className="absolute top-1.5 left-1.5 text-purple-400/60">
        <GitBranch size={10} />
      </span>
      {done && (
        <span className="absolute top-1.5 right-1.5 text-purple-400">
          <CheckCircle2 size={11} />
        </span>
      )}
      {!done && hasLink && (
        <span className="absolute top-1.5 right-1.5 text-purple-400/50">
          <ExternalLink size={10} />
        </span>
      )}
      <p className={`text-xs font-semibold leading-snug pl-4 pr-4 ${done ? 'text-purple-400/80' : 'text-purple-300'}`}>
        {d.label || 'Playbook'}
      </p>
      {d.linked_playbook_name && !done && (
        <p className="text-[9px] text-purple-400/50 mt-0.5 pl-4 truncate italic">
          → {d.linked_playbook_name}
        </p>
      )}
      {!hasLink && !done && (
        <p className="text-[9px] text-purple-400/30 mt-0.5 pl-4 italic">not linked</p>
      )}
      {d.assignee && <span className="block pl-4"><AssigneeBadge assignee={d.assignee} /></span>}
      <Handle
        type="source"
        position={dir === 'RIGHT' ? Position.Right : Position.Bottom}
        className="!bg-purple-400/40 !border-purple-400/40"
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
      className="w-full h-full rounded-xl"
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
        className="absolute top-2.5 left-3.5 text-[11px] font-bold tracking-wider select-none pointer-events-none"
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
// Edges live in PlaybookEdges.tsx (they carry their own reshaping logic).
// Re-exported here so the existing `import { NODE_TYPES, EDGE_TYPES }` call
// sites keep working.

export { EDGE_TYPES, PlaybookEdgeEditContext } from './PlaybookEdges'
export type { EdgeShape, Waypoint, PlaybookEdgeData } from './PlaybookEdges'
