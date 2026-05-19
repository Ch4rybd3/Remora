import { createContext, useContext } from 'react'
import { Handle, Position, type NodeProps } from '@xyflow/react'
import { CheckCircle2 } from 'lucide-react'

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
  [key: string]: unknown
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
    <div className={`relative px-4 py-3 rounded-lg border min-w-[160px] max-w-[220px] shadow-lg transition-colors ${
      done
        ? 'border-accent-green/60 bg-accent-green/10'
        : selected
          ? 'border-accent-green bg-bg-card'
          : 'border-white/20 bg-bg-card'
    }`}>
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

  const strokeColor = done ? '#9FEF00' : selected ? '#FFAF00' : 'rgba(255,175,0,0.40)'
  const fillColor   = done ? 'rgba(159,239,0,0.10)' : 'rgba(255,175,0,0.07)'
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
        position={dir === 'RIGHT' ? Position.Bottom : Position.Right}
        id="no"
        className="!bg-severity-critical !border-severity-critical"
        title="No"
      />
    </div>
  )
}

// ── Node type map ─────────────────────────────────────────────────────────────

export const NODE_TYPES = {
  start:    StartNode,
  step:     StepNode,
  decision: DecisionNode,
  end:      EndNode,
}
