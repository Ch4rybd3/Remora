import { Handle, Position, type NodeProps } from '@xyflow/react'

interface NodeData {
  label: string
  description?: string
  [key: string]: unknown
}

export function StartNode({ data }: NodeProps) {
  const d = data as NodeData
  return (
    <div className="px-4 py-2 rounded-full border-2 border-accent-green bg-accent-green/10 text-accent-green text-xs font-bold min-w-[80px] text-center shadow-lg">
      {d.label || 'Start'}
      <Handle type="source" position={Position.Bottom} className="!bg-accent-green !border-accent-green" />
    </div>
  )
}

export function EndNode({ data }: NodeProps) {
  const d = data as NodeData
  return (
    <div className="px-4 py-2 rounded-full border-2 border-severity-critical bg-severity-critical/10 text-severity-critical text-xs font-bold min-w-[80px] text-center shadow-lg">
      <Handle type="target" position={Position.Top} className="!bg-severity-critical !border-severity-critical" />
      {d.label || 'End'}
    </div>
  )
}

export function StepNode({ data, selected }: NodeProps) {
  const d = data as NodeData
  return (
    <div className={`px-4 py-3 rounded-lg border bg-bg-card text-white min-w-[160px] max-w-[220px] shadow-lg transition-colors ${
      selected ? 'border-accent-green' : 'border-white/20'
    }`}>
      <Handle type="target" position={Position.Top} className="!bg-white/40 !border-white/40" />
      <p className="text-xs font-semibold leading-snug">{d.label}</p>
      {d.description && (
        <p className="text-[10px] text-accent-muted mt-1 leading-snug">{d.description}</p>
      )}
      <Handle type="source" position={Position.Bottom} className="!bg-white/40 !border-white/40" />
    </div>
  )
}

// Dimensions multiples de 20px → alignement parfait sur la grille (snapGrid=[20,20])
const DIAMOND_W = 160  // 8 cellules
const DIAMOND_H = 80   // 4 cellules

export function DecisionNode({ data, selected }: NodeProps) {
  const d = data as NodeData
  const cx = DIAMOND_W / 2  // 80
  const cy = DIAMOND_H / 2  // 40
  // Sommets exactement aux bords de la bounding box — pas de padding interne
  const points = `${cx},0 ${DIAMOND_W},${cy} ${cx},${DIAMOND_H} 0,${cy}`

  return (
    <div style={{ width: DIAMOND_W, height: DIAMOND_H }} className="relative">
      <Handle type="target" position={Position.Top} className="!bg-severity-medium !border-severity-medium" />

      <svg
        width={DIAMOND_W}
        height={DIAMOND_H}
        style={{ overflow: 'visible' }}   /* évite le clip du stroke sur les bords */
        className={`absolute inset-0 transition-colors ${selected ? 'text-severity-medium' : 'text-severity-medium/40'}`}
      >
        <polygon
          points={points}
          fill="rgba(255,175,0,0.07)"
          stroke="currentColor"
          strokeWidth="1.5"
        />
      </svg>

      <div className="absolute inset-0 flex items-center justify-center px-8 pointer-events-none">
        <p className="text-[11px] font-semibold text-severity-medium leading-snug text-center">
          {d.label}
        </p>
      </div>

      <Handle type="source" position={Position.Bottom} id="yes" className="!bg-accent-green !border-accent-green" title="Yes" />
      <Handle type="source" position={Position.Right} id="no" className="!bg-severity-critical !border-severity-critical" title="No" />
    </div>
  )
}

export const NODE_TYPES = {
  start: StartNode,
  step: StepNode,
  decision: DecisionNode,
  end: EndNode,
}
