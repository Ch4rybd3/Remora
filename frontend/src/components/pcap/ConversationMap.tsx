/**
 * Who talked to whom in a capture.
 *
 * The packet list answers "what was on the wire". It cannot answer "what is the
 * shape of this network" - four hundred thousand rows hold a dozen machines and
 * forty conversations, and reading that off a table a page at a time is how an
 * afternoon disappears.
 *
 * **The layout says something.** Local addresses sit on an inner ring and
 * everything outside the private ranges on an outer one, so "inside" and
 * "outside" are legible before a single label is read. A force layout would
 * place the same nodes prettier and tell the analyst nothing. Dragging a node
 * saves where it was put, and a saved position always wins.
 *
 * Icons and names are the analyst's: the capture suggests, they decide. The
 * suggestion is shown as a suggestion, so nobody mistakes a guess for a finding.
 */
import { useCallback, useEffect, useMemo, useState } from 'react'
import {
  Background, Controls, Handle, Position, ReactFlow, ReactFlowProvider,
  useEdgesState, useNodesState,
  type Edge, type Node, type NodeProps,
} from '@xyflow/react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'

import { pcapMapApi, type ConversationMap, type MapHost } from '../../api/pcap'
import { ASSET_TYPES, assetType } from '../../ui/assetTypes'
import { AlertCircle, ArrowLeftRight, Check, Loader2, Plus, X } from '../../ui/icons'
import { color } from '../../styles/tokens'
import { fmtBytes } from '../../utils/formatUtils'

// ── Layout ────────────────────────────────────────────────────────────────────

const INNER_RADIUS = 240
const RING_SPACING = 150
/** Nodes per ring before a second one is started, so icons never overlap. */
const PER_RING = 14

/**
 * Where a host sits when the analyst has not moved it.
 *
 * Concentric and ordered by volume: the busiest local machine is at the top of
 * the inner ring and the rest follow clockwise, so the same capture always draws
 * the same picture. A layout that moved between visits would make the map
 * useless as a thing to point at in a meeting.
 */
export function ringLayout(hosts: MapHost[]): Record<string, { x: number; y: number }> {
  const local  = hosts.filter(h => h.private)
  const remote = hosts.filter(h => !h.private)
  const placed: Record<string, { x: number; y: number }> = {}

  const place = (group: MapHost[], firstRing: number) => {
    group.forEach((host, index) => {
      const ring   = Math.floor(index / PER_RING)
      const inRing = index % PER_RING
      const count  = Math.min(group.length - ring * PER_RING, PER_RING)
      const angle  = (inRing / count) * 2 * Math.PI - Math.PI / 2
      const radius = INNER_RADIUS + (firstRing + ring) * RING_SPACING
      placed[host.address] = {
        x: Math.round(Math.cos(angle) * radius),
        y: Math.round(Math.sin(angle) * radius),
      }
    })
  }

  place(local, 0)
  place(remote, Math.ceil(local.length / PER_RING))
  return placed
}

/** Line thickness from share of traffic. Wide enough to see, never a blob. */
export function edgeWidth(packets: number, busiest: number): number {
  if (busiest <= 0) return 1
  return 1 + Math.round(Math.sqrt(packets / busiest) * 5)
}

/** What to call a host: what the analyst said, else what the capture said. */
export function hostLabel(host: MapHost): string {
  return host.label || host.names[0] || host.address
}

// ── Node ──────────────────────────────────────────────────────────────────────

interface HostNodeData extends Record<string, unknown> {
  host:     MapHost
  selected: boolean
}

function HostNode({ data }: NodeProps<Node<HostNodeData>>) {
  const host = data.host
  const meta = assetType(host.kind || host.suggested_kind)
  const Icon = meta.icon
  const named = Boolean(host.label || host.names.length)

  return (
    <div className={`flex flex-col items-center gap-1 w-28 ${data.selected ? 'opacity-100' : ''}`}>
      <Handle type="target" position={Position.Top}    className="!opacity-0" />
      <Handle type="source" position={Position.Bottom} className="!opacity-0" />
      <div className={`w-10 h-10 flex items-center justify-center rounded-control border transition-colors
        ${data.selected ? 'border-accent bg-accent/15' : `${meta.color}`}
        ${host.asset?.compromised ? 'ring-2 ring-severity-critical/50' : ''}`}>
        <Icon size={18} />
      </div>
      <span className="text-label text-fg text-center leading-tight break-all max-w-full">
        {hostLabel(host)}
      </span>
      {named && (
        <span className="text-label font-mono text-fg-secondary/40 leading-none">
          {host.address}
        </span>
      )}
    </div>
  )
}

const NODE_TYPES = { host: HostNode }

// ── Detail panel ──────────────────────────────────────────────────────────────

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <p className="text-label uppercase tracking-label text-fg-muted">{label}</p>
      <p className="text-ui text-fg font-mono">{value}</p>
    </div>
  )
}

function HostPanel({ host, caseId, onClose }: {
  host:   MapHost
  caseId: string
  onClose: () => void
}) {
  const qc = useQueryClient()
  const [label, setLabel] = useState(host.label)

  useEffect(() => { setLabel(host.label) }, [host.address, host.label])

  const refresh = () => qc.invalidateQueries({ queryKey: ['pcap-map'] })
  const annotate = useMutation({
    mutationFn: (body: { label?: string; kind?: string }) =>
      pcapMapApi.annotate(caseId, host.address, body),
    onSuccess: refresh,
  })
  const adopt = useMutation({
    mutationFn: () => pcapMapApi.adoptAsset(caseId, host.address, {}),
    onSuccess: () => { refresh(); qc.invalidateQueries({ queryKey: ['assets'] }) },
  })

  const chosen = host.kind || host.suggested_kind

  return (
    <div className="w-72 shrink-0 border-l border-hairline bg-panel flex flex-col min-h-0 overflow-y-auto">
      <div className="flex items-start gap-2 px-3 py-2.5 border-b border-hairline">
        <div className="flex-1 min-w-0">
          <p className="text-ui text-fg font-medium break-all">{hostLabel(host)}</p>
          <p className="text-label font-mono text-fg-secondary/50">{host.address}</p>
        </div>
        <button onClick={onClose}
          className="p-0.5 rounded-control text-fg-secondary/40 hover:text-fg transition-colors">
          <X size={12} />
        </button>
      </div>

      <div className="px-3 py-3 space-y-3 border-b border-hairline">
        <label className="block">
          <span className="label">Name</span>
          <input
            className="input text-label"
            placeholder={host.names[0] || host.address}
            value={label}
            onChange={e => setLabel(e.target.value)}
            onBlur={() => { if (label !== host.label) annotate.mutate({ label }) }}
            onKeyDown={e => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur() }}
          />
        </label>

        <div>
          <span className="label">Icon</span>
          <select
            className="input text-label"
            value={chosen}
            onChange={e => annotate.mutate({ kind: e.target.value })}
          >
            {ASSET_TYPES.map(type => (
              <option key={type.value} value={type.value}>{type.label}</option>
            ))}
          </select>
          {!host.kind && (
            <p className="text-label text-fg-muted mt-1">
              Suggested from the traffic — choose one to make it yours.
            </p>
          )}
        </div>
      </div>

      <div className="px-3 py-3 grid grid-cols-2 gap-3 border-b border-hairline">
        <Stat label="Packets"  value={host.packets.toLocaleString()} />
        <Stat label="Volume"   value={fmtBytes(host.bytes)} />
        <Stat label="Sent"     value={host.sent.toLocaleString()} />
        <Stat label="Received" value={host.received.toLocaleString()} />
        <Stat label="Peers"    value={String(host.peers)} />
        <Stat label="Scope"    value={host.private ? 'Local' : 'External'} />
      </div>

      {host.names.length > 0 && (
        <div className="px-3 py-3 border-b border-hairline">
          <p className="text-label uppercase tracking-label text-fg-muted mb-1">
            Names seen
          </p>
          {/* Several, where the capture saw several: one address serving three
              virtual hosts is a fact about the address, and picking one would
              assert a certainty the packets do not carry. */}
          <div className="flex flex-wrap gap-1">
            {host.names.map(name => (
              <span key={name}
                className="text-label font-mono px-1.5 py-0.5 rounded-control border border-hairline text-fg-secondary">
                {name}
              </span>
            ))}
          </div>
        </div>
      )}

      {host.ports.length > 0 && (
        <div className="px-3 py-3 border-b border-hairline">
          <p className="text-label uppercase tracking-label text-fg-muted mb-1">
            Contacted on
          </p>
          <p className="text-ui font-mono text-fg-secondary">{host.ports.join(', ')}</p>
        </div>
      )}

      {host.macs.length > 0 && (
        <div className="px-3 py-3 border-b border-hairline">
          <p className="text-label uppercase tracking-label text-fg-muted mb-1">
            Hardware address
          </p>
          <p className="text-label font-mono text-fg-secondary break-all">
            {host.macs.join(', ')}
          </p>
        </div>
      )}

      <div className="px-3 py-3 mt-auto">
        {host.asset ? (
          <div className="flex items-start gap-2 text-label">
            <Check size={12} className="text-accent mt-0.5 shrink-0" />
            <p className="text-fg-secondary">
              In the case assets as <span className="text-fg">{host.asset.name}</span>
            </p>
          </div>
        ) : (
          <>
            <button
              onClick={() => adopt.mutate()}
              disabled={adopt.isPending}
              className="w-full flex items-center justify-center gap-1.5 text-label py-2 rounded-control border border-accent/30 text-accent bg-accent/5 hover:bg-accent/10 disabled:opacity-40 transition-colors"
            >
              {adopt.isPending ? <Loader2 size={11} className="animate-spin" /> : <Plus size={11} />}
              Add to case assets
            </button>
            {/* The rule the whole feature turns on: a capture holds every
                address that happened to be on the wire, and most of them have
                nothing to do with the investigation. */}
            <p className="text-label text-fg-muted mt-1.5">
              Nothing from this map reaches the case until you add it.
            </p>
          </>
        )}
      </div>
    </div>
  )
}

// ── Map ───────────────────────────────────────────────────────────────────────

function Canvas({ caseId, artifactId }: { caseId: string; artifactId: string }) {
  const [selected, setSelected] = useState<string | null>(null)

  const { data, isLoading, error } = useQuery<ConversationMap>({
    queryKey: ['pcap-map', caseId, artifactId],
    queryFn:  () => pcapMapApi.get(caseId, artifactId),
  })

  const move = useMutation({
    mutationFn: ({ address, x, y }: { address: string; x: number; y: number }) =>
      pcapMapApi.annotate(caseId, address, { x, y }),
  })

  const [nodes, setNodes, onNodesChange] = useNodesState<Node<HostNodeData>>([])
  const [edges, setEdges] = useEdgesState<Edge>([])

  useEffect(() => {
    if (!data) return
    const fallback = ringLayout(data.hosts)
    setNodes(data.hosts.map(host => ({
      id:       host.address,
      type:     'host',
      // A saved position always wins: the analyst arranged it for a reason.
      position: host.x !== null && host.y !== null
        ? { x: host.x, y: host.y }
        : fallback[host.address] ?? { x: 0, y: 0 },
      data:     { host, selected: host.address === selected },
    })))

    const busiest = Math.max(...data.conversations.map(c => c.packets), 1)
    setEdges(data.conversations.map(conversation => ({
      id:     `${conversation.a}|${conversation.b}`,
      source: conversation.a,
      target: conversation.b,
      style:  {
        stroke: color('--border-strong'),
        strokeWidth: edgeWidth(conversation.packets, busiest),
        opacity: 0.55,
      },
      label: conversation.protocols[0] ?? undefined,
      labelStyle: { fill: color('--text-muted'), fontSize: 9 },
      labelBgStyle: { fill: color('--surface-panel'), fillOpacity: 0.85 },
    })))
  }, [data, selected, setNodes, setEdges])

  const onNodeDragStop = useCallback((_: unknown, node: Node) => {
    move.mutate({ address: node.id, x: Math.round(node.position.x), y: Math.round(node.position.y) })
  }, [move])

  const host = useMemo(
    () => data?.hosts.find(h => h.address === selected) ?? null,
    [data, selected])

  if (isLoading) {
    return (
      <div className="flex-1 flex items-center justify-center text-fg-secondary text-ui gap-2">
        <Loader2 size={14} className="animate-spin text-accent/60" /> Reading the capture…
      </div>
    )
  }

  if (error || !data) {
    return (
      <div className="flex-1 flex items-center justify-center text-fg-secondary text-ui">
        The map could not be built from this capture.
      </div>
    )
  }

  if (data.hosts.length === 0) {
    return (
      <div className="flex-1 flex flex-col items-center justify-center gap-2 text-fg-secondary text-ui">
        <ArrowLeftRight size={20} className="text-fg-secondary/30" />
        No conversation between IP addresses in this capture.
      </div>
    )
  }

  return (
    <div className="flex-1 flex min-h-0">
      <div className="flex-1 min-w-0 relative">
        <ReactFlow
          nodes={nodes}
          edges={edges}
          nodeTypes={NODE_TYPES}
          onNodesChange={onNodesChange}
          onNodeDragStop={onNodeDragStop}
          onNodeClick={(_, node) => setSelected(node.id)}
          onPaneClick={() => setSelected(null)}
          nodesConnectable={false}
          fitView
          proOptions={{ hideAttribution: true }}
        >
          <Background color={color('--border-hairline')} gap={24} />
          <Controls showInteractive={false} />
        </ReactFlow>

        <div className="absolute top-2 left-2 flex flex-col gap-1 pointer-events-none">
          <span className="text-label text-fg-secondary/60 bg-panel/80 px-2 py-1 rounded-control border border-hairline">
            {data.hosts.length} host{data.hosts.length === 1 ? '' : 's'} ·{' '}
            {data.conversations.length} conversation{data.conversations.length === 1 ? '' : 's'} ·{' '}
            {data.total_packets.toLocaleString()} packets
          </span>
          {/* A scan of a /24 is a finding, not four hundred icons - so say what
              was left out rather than drawing something unreadable. */}
          {data.omitted_hosts > 0 && (
            <span className="text-label text-severity-medium bg-panel/80 px-2 py-1 rounded-control border border-severity-medium/20 flex items-center gap-1">
              <AlertCircle size={10} />
              {data.omitted_hosts} quieter host{data.omitted_hosts === 1 ? '' : 's'} not drawn
            </span>
          )}
        </div>
      </div>

      {host && (
        <HostPanel host={host} caseId={caseId} onClose={() => setSelected(null)} />
      )}
    </div>
  )
}

export default function ConversationMapView(props: { caseId: string; artifactId: string }) {
  return (
    <ReactFlowProvider>
      <Canvas {...props} />
    </ReactFlowProvider>
  )
}
