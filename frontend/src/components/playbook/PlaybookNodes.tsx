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

export function DecisionNode({ data, selected }: NodeProps) {
  const d = data as NodeData
  return (
    <div className="relative flex items-center justify-center" style={{ width: 160, height: 80 }}>
      <Handle type="target" position={Position.Top} className="!bg-severity-medium !border-severity-medium" />
      <div
        className={`absolute inset-0 border-2 transition-colors ${selected ? 'border-severity-medium' : 'border-severity-medium/50'}`}
        style={{ transform: 'rotate(45deg)', borderRadius: 4, background: 'rgba(255,175,0,0.08)' }}
      />
      <div className="relative text-center px-6">
        <p className="text-[11px] font-semibold text-severity-medium leading-snug">{d.label}</p>
      </div>
      <Handle type="source" position={Position.Bottom} id="yes" className="!bg-accent-green !border-accent-green" style={{ left: '30%' }} />
      <Handle type="source" position={Position.Right} id="no" className="!bg-severity-critical !border-severity-critical" />
    </div>
  )
}

export const NODE_TYPES = {
  start: StartNode,
  step: StepNode,
  decision: DecisionNode,
  end: EndNode,
}
