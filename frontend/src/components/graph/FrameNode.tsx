/**
 * A grouping zone: a translucent coloured rectangle with a title, behind the
 * nodes it contains.
 *
 * It carries no handles and no meaning of its own — it is how an analyst says
 * "these belong together", whether that is a phase of a playbook or a host in
 * an attack graph. Rendered behind other nodes via a negative zIndex set at
 * creation.
 */
import { NodeResizer, type NodeProps } from '@xyflow/react'

/** Zone colours. Kept literal: a frame is a label an analyst picks, not a
 *  semantic state, and the same graph exported to a report has to keep the
 *  colours the analyst chose. */
export const FRAME_COLORS = ['#3b82f6', '#a855f7', '#f59e0b', '#22c55e', '#ef4444', '#6b7280']

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
