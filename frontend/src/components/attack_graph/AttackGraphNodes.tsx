import { Handle, NodeResizer, Position, type NodeProps } from '@xyflow/react'

import { color } from '../../styles/tokens'
import { FrameNode } from '../graph/FrameNode'
import { Clock, Monitor, Shield, Skull, StickyNote, User, Server } from '../../ui/icons'

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
  const cls = `!w-2.5 !h-2.5 !rounded-pill !border-2 ${color} !bg-canvas`
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
// A default width so handles line up on a fresh node, and a resizer so an
// analyst can widen one that holds a long command line — the same affordance
// the playbook editor has had since it shipped.
function NodeShell({ selected, border, bg, children, handles }: {
  selected: boolean
  border:   string   // Tailwind border-color class (selected / idle)
  bg:       string   // inline background rgba
  children: React.ReactNode
  handles:  React.ReactNode
}) {
  return (
    <div
      style={{ width: '100%', minWidth: NODE_WIDTH, height: '100%', background: bg }}
      className={`relative border px-3 py-3 transition-colors ${border}`}
    >
      <NodeResizer
        isVisible={selected}
        minWidth={NODE_WIDTH}
        minHeight={56}
        lineStyle={{ borderColor: color('--border-strong') }}
        handleStyle={{
          backgroundColor: color('--accent'),
          borderColor: color('--accent'),
          width: 6, height: 6, borderRadius: 2,
        }}
      />
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
          <p className={`text-label font-mono leading-none mb-1 truncate ${subLabelCls}`}>
            {subLabel}
          </p>
        )}
        <p className="text-ui font-semibold text-fg leading-snug break-words">
          {label}
        </p>
        {notes && (
          <p className="text-label text-fg-secondary/60 mt-1.5 leading-snug line-clamp-2">
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
      border={selected ? 'border-accent' : 'border-accent/35'}
      bg={selected ? 'rgba(45,212,191,0.10)' : 'rgba(45,212,191,0.05)'}
      handles={<Handles color="!border-accent" />}
    >
      <NodeBody
        icon={Clock} iconCls="text-accent"
        subLabel={d.subLabel} subLabelCls="text-accent/60"
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
        : (selected ? 'border-severity-low'          : 'border-severity-low/35')}
      bg={comp
        ? (selected ? 'rgba(239,68,68,0.10)'  : 'rgba(239,68,68,0.04)')
        : (selected ? 'rgba(59,130,246,0.10)' : 'rgba(59,130,246,0.04)')}
      handles={<Handles color={comp ? '!border-severity-critical' : '!border-severity-low'} />}
    >
      <NodeBody
        icon={Icon}
        iconCls={comp ? 'text-severity-critical' : 'text-severity-low'}
        subLabel={d.subLabel}
        subLabelCls={comp ? 'text-severity-critical/60' : 'text-severity-low/60'}
        label={d.label}
        notes={comp ? (d.notes ?? 'Compromised') : d.notes}
      />
    </NodeShell>
  )
}

// ── IOC node ──────────────────────────────────────────────────────────────────
const IOC_THEME: Record<string, { border: string; bg: [string, string]; icon: string }> = {
  ip:          { border: 'border-severity-critical',    bg: ['rgba(239,68,68,0.08)',   'rgba(239,68,68,0.04)'],   icon: 'text-severity-critical'    },
  domain:      { border: 'border-severity-high', bg: ['rgba(249,115,22,0.08)', 'rgba(249,115,22,0.04)'],  icon: 'text-severity-high' },
  url:         { border: 'border-severity-high', bg: ['rgba(251,146,60,0.08)', 'rgba(251,146,60,0.04)'],  icon: 'text-severity-high' },
  hash_md5:    { border: 'border-data-2', bg: ['rgba(168,85,247,0.08)', 'rgba(168,85,247,0.04)'],  icon: 'text-data-2' },
  hash_sha1:   { border: 'border-data-2', bg: ['rgba(168,85,247,0.08)', 'rgba(168,85,247,0.04)'],  icon: 'text-data-2' },
  hash_sha256: { border: 'border-data-2', bg: ['rgba(168,85,247,0.08)', 'rgba(168,85,247,0.04)'],  icon: 'text-data-2' },
  email:       { border: 'border-severity-low',   bg: ['rgba(59,130,246,0.08)', 'rgba(59,130,246,0.04)'],  icon: 'text-severity-low'   },
  filename:    { border: 'border-severity-medium', bg: ['rgba(234,179,8,0.08)',  'rgba(234,179,8,0.04)'],   icon: 'text-severity-medium' },
  registry:    { border: 'border-data-3',   bg: ['rgba(236,72,153,0.08)', 'rgba(236,72,153,0.04)'],  icon: 'text-data-3'   },
}
const IOC_DEFAULT = { border: 'border-strong', bg: ['rgba(255,255,255,0.06)', 'rgba(255,255,255,0.03)'] as [string, string], icon: 'text-fg-secondary' }

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
      className={`relative rounded-pill border-2 py-2.5 shadow-xl transition-all flex items-center justify-center gap-2 ${ selected ? 'border-severity-critical' : 'border-severity-critical/50'
      }`}
    >
      <Handle type="source" position={Position.Bottom} className="!w-2.5 !h-2.5 !rounded-pill !border-2 !border-severity-critical !bg-canvas" />
      <Handle type="target" position={Position.Top}    className="!w-2.5 !h-2.5 !rounded-pill !border-2 !border-severity-critical !bg-canvas" />
      <Handle type="source" position={Position.Right} id="r" className="!w-2.5 !h-2.5 !rounded-pill !border-2 !border-severity-critical !bg-canvas" />
      <Handle type="target" position={Position.Left}  id="l" className="!w-2.5 !h-2.5 !rounded-pill !border-2 !border-severity-critical !bg-canvas" />
      <Skull size={14} className="text-severity-critical shrink-0" />
      <span className="text-ui font-bold text-severity-critical">{d.label || 'Attacker'}</span>
    </div>
  )
}

// ── Free / annotation node ────────────────────────────────────────────────────
export function FreeNode({ data, selected }: NodeProps) {
  const d = data as AGNodeData
  return (
    <NodeShell
      selected={selected}
      border={selected ? 'border-strong' : 'border-hairline'}
      bg={selected ? 'rgba(255,255,255,0.08)' : 'rgba(255,255,255,0.04)'}
      handles={<Handles color="!border-strong" />}
    >
      <NodeBody
        icon={StickyNote} iconCls="text-fg-secondary/60"
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
  // Grouping zones, shared with the playbook editor: "these belong together",
  // whether that is a host, a phase, or a compromised segment.
  frame:    FrameNode,
}
