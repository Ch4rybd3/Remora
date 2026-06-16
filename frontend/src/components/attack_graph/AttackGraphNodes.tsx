import { Handle, Position, type NodeProps } from '@xyflow/react'
import { Clock, Monitor, Shield, Skull, StickyNote, User, Server } from 'lucide-react'

// ── Shared constants ──────────────────────────────────────────────────────────
// All nodes share the same width so handles align regardless of content length.
// 200px = 10 × 20px grid → top/bottom handles always at x = 100 (center).
export const NODE_WIDTH = 200

export interface AGNodeData {
  label:       string
  subLabel?:   string
  nodeKind:    'timeline' | 'asset' | 'ioc' | 'free' | 'attacker'
  notes?:      string
  compromised?: boolean
  iocType?:    string
  sourceId?:   string
  [key: string]: unknown
}

// ── Shared handle set ─────────────────────────────────────────────────────────
// Four connection points (top / bottom / left / right).
function Handles({ color }: { color: string }) {
  const cls = `!w-2.5 !h-2.5 !rounded-full !border-2 ${color} !bg-bg-primary`
  return (
    <>
      <Handle type="target" position={Position.Top}    className={cls} />
      <Handle type="source" position={Position.Bottom} className={cls} />
      <Handle type="target" position={Position.Left}   id="l" className={cls} />
      <Handle type="source" position={Position.Right}  id="r" className={cls} />
    </>
  )
}

// ── Shared node shell ─────────────────────────────────────────────────────────
// Fixed width, consistent padding, border + bg from props.
function NodeShell({ selected, border, bg, children, handles }: {
  selected: boolean
  border:   string   // Tailwind border-color class (selected / idle)
  bg:       string   // inline background rgba
  children: React.ReactNode
  handles:  React.ReactNode
}) {
  return (
    <div
      style={{ width: NODE_WIDTH, background: bg }}
      className={`relative rounded-lg border px-3 py-3 shadow-lg transition-all ${border} ${
        selected ? 'shadow-lg' : ''
      }`}
    >
      {handles}
      {children}
    </div>
  )
}

// ── Label + sublabel + notes ─────────────────────────────────────────────────
function NodeBody({ icon: Icon, iconCls, subLabel, subLabelCls, label, notes }: {
  icon:        React.ElementType
  iconCls:     string
  subLabel?:   string
  subLabelCls: string
  label:       string
  notes?:      string
}) {
  return (
    <div className="flex items-start gap-2">
      <Icon size={13} className={`${iconCls} shrink-0 mt-px`} />
      <div className="min-w-0 flex-1">
        {subLabel && (
          <p className={`text-[10px] font-mono leading-none mb-1 truncate ${subLabelCls}`}>
            {subLabel}
          </p>
        )}
        <p className="text-[12px] font-semibold text-white leading-snug break-words">
          {label}
        </p>
        {notes && (
          <p className="text-[10px] text-accent-muted/60 mt-1.5 leading-snug line-clamp-2">
            {notes}
          </p>
        )}
      </div>
    </div>
  )
}

// ── Timeline node ─────────────────────────────────────────────────────────────
export function TimelineNode({ data, selected }: NodeProps) {
  const d = data as AGNodeData
  return (
    <NodeShell
      selected={selected}
      border={selected ? 'border-accent-green' : 'border-accent-green/35'}
      bg={selected ? 'rgba(45,212,191,0.10)' : 'rgba(45,212,191,0.05)'}
      handles={<Handles color="!border-accent-green" />}
    >
      <NodeBody
        icon={Clock} iconCls="text-accent-green"
        subLabel={d.subLabel} subLabelCls="text-accent-green/60"
        label={d.label} notes={d.notes}
      />
    </NodeShell>
  )
}

// ── Asset node ────────────────────────────────────────────────────────────────
const ASSET_ICONS: Record<string, React.ElementType> = {
  server: Server, domain_controller: Server,
  user_account: User, service_account: User,
}

export function AssetNode({ data, selected }: NodeProps) {
  const d    = data as AGNodeData
  const comp = d.compromised === true
  const Icon = ASSET_ICONS[d.iocType ?? ''] ?? Monitor

  return (
    <NodeShell
      selected={selected}
      border={comp
        ? (selected ? 'border-severity-critical' : 'border-severity-critical/40')
        : (selected ? 'border-blue-400'          : 'border-blue-500/35')}
      bg={comp
        ? (selected ? 'rgba(239,68,68,0.10)'  : 'rgba(239,68,68,0.04)')
        : (selected ? 'rgba(59,130,246,0.10)' : 'rgba(59,130,246,0.04)')}
      handles={<Handles color={comp ? '!border-severity-critical' : '!border-blue-400'} />}
    >
      <NodeBody
        icon={Icon}
        iconCls={comp ? 'text-severity-critical' : 'text-blue-400'}
        subLabel={d.subLabel}
        subLabelCls={comp ? 'text-severity-critical/60' : 'text-blue-400/60'}
        label={d.label}
        notes={comp ? (d.notes ?? 'Compromised') : d.notes}
      />
    </NodeShell>
  )
}

// ── IOC node ──────────────────────────────────────────────────────────────────
const IOC_THEME: Record<string, { border: string; bg: [string, string]; icon: string }> = {
  ip:          { border: 'border-red-500',    bg: ['rgba(239,68,68,0.08)',   'rgba(239,68,68,0.04)'],   icon: 'text-red-400'    },
  domain:      { border: 'border-orange-500', bg: ['rgba(249,115,22,0.08)', 'rgba(249,115,22,0.04)'],  icon: 'text-orange-400' },
  url:         { border: 'border-orange-400', bg: ['rgba(251,146,60,0.08)', 'rgba(251,146,60,0.04)'],  icon: 'text-orange-300' },
  hash_md5:    { border: 'border-purple-500', bg: ['rgba(168,85,247,0.08)', 'rgba(168,85,247,0.04)'],  icon: 'text-purple-400' },
  hash_sha1:   { border: 'border-purple-500', bg: ['rgba(168,85,247,0.08)', 'rgba(168,85,247,0.04)'],  icon: 'text-purple-400' },
  hash_sha256: { border: 'border-purple-500', bg: ['rgba(168,85,247,0.08)', 'rgba(168,85,247,0.04)'],  icon: 'text-purple-400' },
  email:       { border: 'border-blue-500',   bg: ['rgba(59,130,246,0.08)', 'rgba(59,130,246,0.04)'],  icon: 'text-blue-400'   },
  filename:    { border: 'border-yellow-500', bg: ['rgba(234,179,8,0.08)',  'rgba(234,179,8,0.04)'],   icon: 'text-yellow-400' },
  registry:    { border: 'border-pink-500',   bg: ['rgba(236,72,153,0.08)', 'rgba(236,72,153,0.04)'],  icon: 'text-pink-400'   },
}
const IOC_DEFAULT = { border: 'border-white/20', bg: ['rgba(255,255,255,0.06)', 'rgba(255,255,255,0.03)'] as [string, string], icon: 'text-accent-muted' }

export function IOCNode({ data, selected }: NodeProps) {
  const d   = data as AGNodeData
  const th  = IOC_THEME[d.iocType ?? ''] ?? IOC_DEFAULT
  const sel = selected

  return (
    <NodeShell
      selected={sel}
      border={`${th.border}${sel ? '' : '/40'}`}
      bg={sel ? th.bg[0] : th.bg[1]}
      handles={<Handles color={`!${th.border}`} />}
    >
      <NodeBody
        icon={Shield} iconCls={th.icon}
        subLabel={d.subLabel} subLabelCls={`${th.icon} opacity-60`}
        label={d.label} notes={d.notes}
      />
    </NodeShell>
  )
}

// ── Attacker node ─────────────────────────────────────────────────────────────
// Pill shape, same 200px width as others so it aligns on grid.
export function AttackerNode({ data, selected }: NodeProps) {
  const d = data as AGNodeData
  return (
    <div
      style={{ width: NODE_WIDTH, background: selected ? 'rgba(239,68,68,0.14)' : 'rgba(239,68,68,0.07)' }}
      className={`relative rounded-full border-2 py-2.5 shadow-xl transition-all flex items-center justify-center gap-2 ${
        selected ? 'border-severity-critical' : 'border-severity-critical/50'
      }`}
    >
      <Handle type="source" position={Position.Bottom} className="!w-2.5 !h-2.5 !rounded-full !border-2 !border-severity-critical !bg-bg-primary" />
      <Handle type="target" position={Position.Top}    className="!w-2.5 !h-2.5 !rounded-full !border-2 !border-severity-critical !bg-bg-primary" />
      <Handle type="source" position={Position.Right} id="r" className="!w-2.5 !h-2.5 !rounded-full !border-2 !border-severity-critical !bg-bg-primary" />
      <Handle type="target" position={Position.Left}  id="l" className="!w-2.5 !h-2.5 !rounded-full !border-2 !border-severity-critical !bg-bg-primary" />
      <Skull size={14} className="text-severity-critical shrink-0" />
      <span className="text-[12px] font-bold text-severity-critical">{d.label || 'Attacker'}</span>
    </div>
  )
}

// ── Free / annotation node ────────────────────────────────────────────────────
export function FreeNode({ data, selected }: NodeProps) {
  const d = data as AGNodeData
  return (
    <NodeShell
      selected={selected}
      border={selected ? 'border-white/40' : 'border-white/12'}
      bg={selected ? 'rgba(255,255,255,0.08)' : 'rgba(255,255,255,0.04)'}
      handles={<Handles color="!border-white/30" />}
    >
      <NodeBody
        icon={StickyNote} iconCls="text-accent-muted/60"
        subLabel={undefined} subLabelCls=""
        label={d.label} notes={d.notes}
      />
    </NodeShell>
  )
}

// ── Registry ──────────────────────────────────────────────────────────────────
export const AG_NODE_TYPES = {
  timeline: TimelineNode,
  asset:    AssetNode,
  ioc:      IOCNode,
  attacker: AttackerNode,
  free:     FreeNode,
}
