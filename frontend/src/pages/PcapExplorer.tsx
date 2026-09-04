/**
 * PCAP Explorer — Wireshark-style three-pane view over a dissected capture.
 *
 * The packet list is the artifact CSV produced by the backend (so it reuses the
 * same rows endpoint, filters and paging as the Artifact Explorer); the
 * protocol tree and hexdump come from dissecting the selected frame on demand.
 */
import { useState, useMemo, useEffect, useCallback } from 'react'
import { PageShell } from '../ui/PageShell'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { DataTable } from '../ui/DataTable'
import {
  Network, Search, X, ChevronRight, BookmarkPlus, BookmarkCheck,
  Loader2, Download, AlertCircle, Filter, ArrowLeftRight, Copy, Check,
} from '../ui/icons'
import { csvArtifactsApi, type CsvArtifactMeta } from '../api/csvArtifacts'
import {
  pcapApi, isPcapArtifact, captureName, hexToBytes,
  type PcapFrame, type PcapStream,
} from '../api/pcap'
import { timelineApi } from '../api/timeline'
import { useCurrentCase } from '../context/CurrentCaseContext'
import { fmtBytes } from '../utils/formatUtils'
import { parseArtifactTimestamp } from '../utils/dateUtils'

const PAGE_SIZE = 200

// ── Protocol colouring ────────────────────────────────────────────────────────
// Mirrors Wireshark's default rules closely enough to be readable at a glance.

const PROTO_ROW: Record<string, string> = {
  DNS:  'text-severity-low',
  HTTP: 'text-accent',
  TLS:  'text-data-2',
  TCP:  'text-fg/70',
  UDP:  'text-data-5',
  ICMP: 'text-severity-high',
  ARP:  'text-severity-medium',
  SMB:  'text-data-3',
  SMB2: 'text-data-3',
}

function protoClass(proto: string): string {
  return PROTO_ROW[proto?.toUpperCase()] ?? 'text-fg/55'
}

// ── Helpers ───────────────────────────────────────────────────────────────────

/**
 * tshark emits `<field>_raw` as [hex, offset, length, bitmask, type]; some
 * builds emit a bare hex string. Returns the byte range a field occupies.
 */
function rawRange(raw: unknown): { offset: number; length: number } | null {
  if (Array.isArray(raw) && raw.length >= 3
      && typeof raw[1] === 'number' && typeof raw[2] === 'number') {
    return { offset: raw[1], length: raw[2] }
  }
  return null
}

function rawHex(raw: unknown): string {
  if (typeof raw === 'string') return raw
  if (Array.isArray(raw) && typeof raw[0] === 'string') return raw[0]
  return ''
}

function fmtTime(iso: string): string {
  if (!iso) return ''
  // Keep sub-second precision — it matters when ordering packets
  return iso.replace('T', ' ').replace('Z', '').slice(0, 26)
}

// ── Protocol tree ─────────────────────────────────────────────────────────────

interface TreeNodeProps {
  label:      string
  value:      unknown
  raw:        unknown
  depth:      number
  onHighlight: (r: { offset: number; length: number } | null) => void
}

function TreeNode({ label, value, raw, depth, onHighlight }: TreeNodeProps) {
  const [open, setOpen] = useState(depth === 0)
  const range = rawRange(raw)

  const isBranch = value !== null && typeof value === 'object' && !Array.isArray(value)
  const children = isBranch
    ? Object.entries(value as Record<string, unknown>)
        .filter(([k]) => !k.endsWith('_raw'))
    : []

  const display = Array.isArray(value)
    ? value.join(', ')
    : isBranch ? '' : String(value ?? '')

  return (
    <div>
      <div
        onMouseEnter={() => range && onHighlight(range)}
        onMouseLeave={() => onHighlight(null)}
        onClick={() => isBranch && children.length > 0 && setOpen(o => !o)}
        className={`flex items-start gap-1 px-2 py-[3px] text-label font-mono leading-snug hover:bg-fg/5 ${ isBranch && children.length > 0 ? 'cursor-pointer' : ''
        } ${range ? 'hover:text-accent' : ''}`}
        style={{ paddingLeft: 8 + depth * 12 }}
      >
        {isBranch && children.length > 0 ? (
          <ChevronRight size={9}
            className={`mt-[3px] shrink-0 text-fg-secondary/40 transition-transform ${open ? 'rotate-90' : ''}`} />
        ) : (
          <span className="w-[9px] shrink-0" />
        )}
        <span className="text-fg-secondary/70 shrink-0">{label}</span>
        {display && (
          <>
            <span className="text-fg-secondary/25">:</span>
            <span className="text-fg/75 break-all">{display}</span>
          </>
        )}
      </div>

      {open && children.map(([k, v]) => (
        <TreeNode
          key={k}
          label={k}
          value={v}
          raw={(value as Record<string, unknown>)[`${k}_raw`]}
          depth={depth + 1}
          onHighlight={onHighlight}
        />
      ))}
    </div>
  )
}

function ProtocolTree({ frame, onHighlight }: {
  frame: PcapFrame
  onHighlight: (r: { offset: number; length: number } | null) => void
}) {
  return (
    <div className="h-full overflow-auto">
      {frame.protocols.map(proto => (
        <TreeNode
          key={proto}
          label={proto}
          value={frame.layers[proto]}
          raw={frame.layers[`${proto}_raw`]}
          depth={0}
          onHighlight={onHighlight}
        />
      ))}
    </div>
  )
}

// ── Hexdump ───────────────────────────────────────────────────────────────────

function HexDump({ hex, highlight }: {
  hex: string
  highlight: { offset: number; length: number } | null
}) {
  const bytes = useMemo(() => {
    const out: number[] = []
    for (let i = 0; i + 1 < hex.length; i += 2) out.push(parseInt(hex.slice(i, i + 2), 16))
    return out
  }, [hex])

  if (bytes.length === 0) {
    return <p className="p-3 text-label text-fg-secondary/30 italic">Octets bruts indisponibles.</p>
  }

  const rows: number[][] = []
  for (let i = 0; i < bytes.length; i += 16) rows.push(bytes.slice(i, i + 16))

  const inRange = (idx: number) =>
    !!highlight && idx >= highlight.offset && idx < highlight.offset + highlight.length

  return (
    <div className="h-full overflow-auto p-2 font-mono text-label leading-[1.45]">
      {rows.map((row, r) => (
        <div key={r} className="flex gap-3 whitespace-pre">
          <span className="text-fg-secondary/30 shrink-0">
            {(r * 16).toString(16).padStart(4, '0')}
          </span>
          <span className="shrink-0">
            {row.map((b, i) => {
              const idx = r * 16 + i
              return (
                <span key={i}
                  className={inRange(idx) ? 'bg-accent/25 text-accent' : 'text-fg/60'}>
                  {b.toString(16).padStart(2, '0')}{i === 7 ? '  ' : ' '}
                </span>
              )
            })}
            {/* Pad the last row so the ASCII column stays aligned */}
            {row.length < 16 && ' '.repeat((16 - row.length) * 3 + (row.length <= 8 ? 1 : 0))}
          </span>
          <span className="shrink-0">
            {row.map((b, i) => {
              const idx = r * 16 + i
              const printable = b >= 0x20 && b < 0x7f
              return (
                <span key={i}
                  className={inRange(idx) ? 'bg-accent/25 text-accent' : 'text-fg/45'}>
                  {printable ? String.fromCharCode(b) : '.'}
                </span>
              )
            })}
          </span>
        </div>
      ))}
    </div>
  )
}

// ── Follow stream ─────────────────────────────────────────────────────────────

/** Printable-ASCII rendering; non-printable bytes shown as dots, like Wireshark. */
function toAscii(bytes: Uint8Array): string {
  let out = ''
  for (const b of bytes) {
    out += (b === 0x0a || b === 0x0d || b === 0x09) ? String.fromCharCode(b)
         : (b >= 0x20 && b < 0x7f) ? String.fromCharCode(b)
         : '.'
  }
  return out
}

function toHexBlock(bytes: Uint8Array): string {
  const lines: string[] = []
  for (let i = 0; i < bytes.length; i += 16) {
    const row = bytes.slice(i, i + 16)
    const hex = [...row].map(b => b.toString(16).padStart(2, '0')).join(' ')
    lines.push(`${i.toString(16).padStart(4, '0')}  ${hex.padEnd(47)}  ${toAscii(row)}`)
  }
  return lines.join('\n')
}

function FollowStreamPanel({ stream, onClose }: { stream: PcapStream; onClose: () => void }) {
  const [view,   setView]   = useState<'ascii' | 'hex'>('ascii')
  const [side,   setSide]   = useState<'both' | 'c2s' | 's2c'>('both')
  const [copied, setCopied] = useState(false)

  const shown = stream.chunks.filter(c => side === 'both' || c.direction === side)

  const asText = useMemo(
    () => shown.map(c => {
      const bytes = hexToBytes(c.hex)
      return view === 'hex' ? toHexBlock(bytes) : toAscii(bytes)
    }).join('\n'),
    [shown, view],
  )

  const copy = () => {
    navigator.clipboard.writeText(asText)
    setCopied(true)
    setTimeout(() => setCopied(false), 1500)
  }

  const download = () => {
    const blob = new Blob([asText], { type: 'text/plain' })
    const url  = URL.createObjectURL(blob)
    const a    = document.createElement('a')
    a.href = url
    a.download = `${stream.capture}_${stream.protocol}_stream_${stream.stream}.txt`
    a.click()
    URL.revokeObjectURL(url)
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-8"
         onClick={onClose}>
      <div className="w-full max-w-5xl h-full max-h-[85vh] bg-panel border border-hairline flex flex-col overflow-hidden"
           onClick={e => e.stopPropagation()}>
        {/* Header */}
        <div className="flex items-center gap-2 px-4 py-2.5 border-b border-hairline shrink-0">
          <ArrowLeftRight size={13} className="text-accent shrink-0" />
          <p className="text-label font-semibold text-fg shrink-0">
            Flux {stream.protocol.toUpperCase()} n°{stream.stream}
          </p>
          <p className="text-label font-mono text-fg-secondary/50 truncate">
            {stream.node0} ↔ {stream.node1}
          </p>
          <span className="text-label text-fg-secondary/35 shrink-0">
            {fmtBytes(stream.total_bytes)} · {stream.chunks.length} segment(s)
          </span>
          <button onClick={onClose}
            className="ml-auto text-fg-secondary/40 hover:text-fg transition-colors shrink-0">
            <X size={14} />
          </button>
        </div>

        {/* Controls */}
        <div className="flex items-center gap-2 px-4 py-2 border-b border-hairline shrink-0">
          <div className="flex rounded-control border border-hairline overflow-hidden">
            {(['ascii', 'hex'] as const).map(v => (
              <button key={v} onClick={() => setView(v)}
                className={`text-label px-2.5 py-1 transition-colors ${ view === v ? 'bg-accent/10 text-accent' : 'text-fg-secondary hover:text-fg'
                }`}>
                {v === 'ascii' ? 'ASCII' : 'Hex'}
              </button>
            ))}
          </div>
          <div className="flex rounded-control border border-hairline overflow-hidden">
            {([
              ['both', 'Les deux sens'],
              ['c2s',  `→ ${stream.node1}`],
              ['s2c',  `← ${stream.node1}`],
            ] as const).map(([v, label]) => (
              <button key={v} onClick={() => setSide(v)}
                className={`text-label px-2.5 py-1 truncate max-w-[180px] transition-colors ${ side === v ? 'bg-accent/10 text-accent' : 'text-fg-secondary hover:text-fg'
                }`}>
                {label}
              </button>
            ))}
          </div>
          <button onClick={copy}
            className="ml-auto flex items-center gap-1 text-label px-2 py-1 rounded-control border border-hairline text-fg-secondary hover:text-accent hover:border-accent/40 transition-colors">
            {copied ? <Check size={10} className="text-accent" /> : <Copy size={10} />} Copy
          </button>
          <button onClick={download}
            className="flex items-center gap-1 text-label px-2 py-1 rounded-control border border-hairline text-fg-secondary hover:text-accent hover:border-accent/40 transition-colors">
            <Download size={10} /> Exporter
          </button>
        </div>

        {stream.truncated && (
          <p className="px-4 py-1.5 text-label text-severity-medium/80 bg-severity-medium/5 border-b border-severity-medium/15 shrink-0">
            Conversation truncated: only the first 2 MB are shown.
          </p>
        )}

        {/* Content — client and server tinted differently, as in Wireshark */}
        <div className="flex-1 overflow-auto p-3 font-mono text-label leading-relaxed">
          {shown.map((c, i) => (
            <pre key={i}
              className={`whitespace-pre-wrap break-all mb-2 px-2 py-1 rounded-control border-l-2 ${ c.direction === 'c2s'
                  ? 'border-l-accent/40 bg-accent/[0.04] text-accent/85'
                  : 'border-l-severity-low/40 bg-severity-low/[0.04] text-severity-low/85'
              }`}>
              {view === 'hex' ? toHexBlock(hexToBytes(c.hex)) : toAscii(hexToBytes(c.hex))}
            </pre>
          ))}
          {shown.length === 0 && (
            <p className="text-fg-secondary/30 italic">No data in this direction.</p>
          )}
        </div>
      </div>
    </div>
  )
}

// ── Pinned selection ──────────────────────────────────────────────────────────

interface PinnedPacket {
  key:         string
  artifactId:  string
  capture:     string
  row:         Record<string, string>
  title:       string
  description: string
}

function defaultTitle(row: Record<string, string>, capture: string): string {
  const proto = row.Protocol || 'Paquet'
  const flow  = row.Source && row.Destination ? `${row.Source} → ${row.Destination}` : ''
  const extra = row.DnsQuery || row.HttpHost || row.TlsServerName || ''
  return [`${proto} ${flow}`.trim(), extra].filter(Boolean).join(' — ').slice(0, 120) || capture
}

function defaultDescription(row: Record<string, string>): string {
  return Object.entries(row)
    .filter(([k, v]) => v?.trim() && k !== 'Timestamp')
    .slice(0, 12)
    .map(([k, v]) => `${k}: ${v}`)
    .join('\n')
}

function PinnedPanel({ pinned, onUnpin, onClear, onEdit, onExport, exporting }: {
  pinned:    PinnedPacket[]
  onUnpin:   (key: string) => void
  onClear:   () => void
  onEdit:    (key: string, patch: Partial<Pick<PinnedPacket, 'title' | 'description'>>) => void
  onExport:  () => void
  exporting: boolean
}) {
  const [expanded, setExpanded] = useState<Set<string>>(new Set())
  const toggle = (k: string) => setExpanded(p => {
    const n = new Set(p)
    if (n.has(k)) n.delete(k)
    else n.add(k)
    return n
  })

  // Chronological, oldest first — the order they will land in the timeline
  const sorted = useMemo(
    () => [...pinned].sort((a, b) => (a.row.Timestamp ?? '').localeCompare(b.row.Timestamp ?? '')),
    [pinned],
  )

  return (
    <div className="w-72 shrink-0 border-l border-hairline bg-panel flex flex-col overflow-hidden">
      <div className="flex items-center justify-between px-3 py-3 border-b border-hairline shrink-0">
        <p className="text-label font-semibold uppercase tracking-widest text-fg-secondary/50 flex items-center gap-1.5">
          <BookmarkCheck size={10} /> Selection
          {pinned.length > 0 && (
            <span className="ml-1 bg-accent/15 text-accent border border-accent/30 rounded-control px-1.5 py-0.5 text-label font-bold">
              {pinned.length}
            </span>
          )}
        </p>
        {pinned.length > 0 && (
          <button onClick={onClear} title="Tout retirer"
            className="text-fg-secondary/30 hover:text-severity-critical transition-colors">
            <X size={12} />
          </button>
        )}
      </div>

      {pinned.length === 0 ? (
        <div className="flex-1 flex flex-col items-center justify-center gap-2 px-4 text-center">
          <BookmarkPlus size={22} className="text-fg-secondary/15" />
          <p className="text-label text-fg-secondary/30 leading-relaxed">
            Pin packets to stage them before sending to the timeline
          </p>
        </div>
      ) : (
        <div className="flex-1 overflow-y-auto divide-y divide-hairline/[0.04]">
          {sorted.map(item => {
            const isOpen = expanded.has(item.key)
            return (
              <div key={item.key} className="group relative px-3 py-2.5 hover:bg-white/[0.02]">
                <div className="flex items-start gap-2 pr-5">
                  <button onClick={() => toggle(item.key)}
                    title={isOpen ? 'Replier' : 'Éditer titre et description'}
                    className="mt-0.5 shrink-0 text-fg-secondary/30 hover:text-accent transition-colors">
                    <ChevronRight size={11} className={`transition-transform ${isOpen ? 'rotate-90' : ''}`} />
                  </button>
                  <div className="flex-1 min-w-0">
                    <span className="text-label font-semibold px-1.5 py-0.5 rounded-control border bg-severity-low/10 text-severity-low border-severity-low/20">
                      #{item.row.No} · {item.row.Protocol}
                    </span>
                    <p className="text-label font-mono text-fg/50 mt-0.5 truncate">
                      {fmtTime(item.row.Timestamp ?? '')}
                    </p>
                    <p className="text-label text-fg/70 mt-0.5 leading-snug line-clamp-2">{item.title}</p>
                  </div>
                </div>

                {isOpen && (
                  <div className="mt-2 pl-[19px] space-y-1.5">
                    <div>
                      <label className="text-label uppercase tracking-widest text-fg-secondary/40">Title</label>
                      <input value={item.title}
                        onChange={e => onEdit(item.key, { title: e.target.value })}
                        className="w-full mt-0.5 bg-black/30 border border-hairline rounded-control px-1.5 py-1 text-label text-fg/90 focus:border-accent/40 focus:outline-none" />
                    </div>
                    <div>
                      <label className="text-label uppercase tracking-widest text-fg-secondary/40">Description</label>
                      <textarea value={item.description} rows={4}
                        onChange={e => onEdit(item.key, { description: e.target.value })}
                        className="w-full mt-0.5 bg-black/30 border border-hairline rounded-control px-1.5 py-1 text-label font-mono text-fg-secondary resize-y focus:border-accent/40 focus:outline-none" />
                    </div>
                  </div>
                )}

                <button onClick={() => onUnpin(item.key)}
                  className="absolute right-2 top-2.5 opacity-0 group-hover:opacity-100 text-fg-secondary/30 hover:text-severity-critical transition-all">
                  <X size={10} />
                </button>
              </div>
            )
          })}
        </div>
      )}

      <div className="px-3 py-3 border-t border-hairline shrink-0">
        <button onClick={onExport} disabled={pinned.length === 0 || exporting}
          className="w-full flex items-center justify-center gap-1.5 text-label py-2 rounded-control border border-accent/30 text-accent bg-accent/5 hover:bg-accent/10 disabled:opacity-30 disabled:cursor-not-allowed transition-colors">
          {exporting
            ? <><Loader2 size={11} className="animate-spin" /> Envoi…</>
            : <><Download size={11} /> Exporter {pinned.length > 0 ? `${pinned.length} → ` : ''}Timeline</>}
        </button>
      </div>
    </div>
  )
}

// ── Page ──────────────────────────────────────────────────────────────────────

export default function PcapExplorer() {
  const { currentCase } = useCurrentCase()
  const caseId = currentCase?.id
  const qc = useQueryClient()

  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [page,       setPage]       = useState(1)
  const [search,     setSearch]     = useState('')
  const [debounced,  setDebounced]  = useState('')
  const [frameNo,    setFrameNo]    = useState<number | null>(null)
  const [highlight,  setHighlight]  = useState<{ offset: number; length: number } | null>(null)
  const [pinned,     setPinned]     = useState<PinnedPacket[]>([])
  const [exporting,  setExporting]  = useState(false)
  const [following,  setFollowing]  = useState<number | null>(null)

  useEffect(() => {
    const t = setTimeout(() => { setDebounced(search); setPage(1) }, 400)
    return () => clearTimeout(t)
  }, [search])

  const { data: status } = useQuery({ queryKey: ['pcap-status'], queryFn: pcapApi.status })

  const { data: artifacts = [] } = useQuery({
    queryKey: ['artifacts', caseId],
    queryFn:  () => csvArtifactsApi.list(caseId!),
    enabled:  !!caseId,
  })

  const captures = useMemo(
    () => artifacts.filter((a: CsvArtifactMeta) => isPcapArtifact(a.original_name)),
    [artifacts],
  )

  // Select the first capture once they load
  useEffect(() => {
    if (!selectedId && captures.length > 0) setSelectedId(captures[0].id)
  }, [captures, selectedId])

  const active = captures.find(c => c.id === selectedId) ?? null

  const { data: rows, isFetching } = useQuery({
    queryKey: ['pcap-rows', caseId, selectedId, page, debounced],
    queryFn:  () => csvArtifactsApi.getRows(caseId!, selectedId!, {
      page, page_size: PAGE_SIZE, sort_col: 'No', sort_dir: 'asc',
      ...(debounced ? { q: debounced } : {}),
    }),
    enabled: !!caseId && !!selectedId,
  })

  const { data: frame, isFetching: loadingFrame, error: frameError } = useQuery({
    queryKey: ['pcap-frame', caseId, selectedId, frameNo],
    queryFn:  () => pcapApi.frame(caseId!, selectedId!, frameNo!),
    enabled:  !!caseId && !!selectedId && frameNo !== null,
  })

  const hex = frame ? rawHex(frame.layers['frame_raw']) : ''

  const { data: stream, isFetching: loadingStream, error: streamError } = useQuery({
    queryKey: ['pcap-stream', caseId, selectedId, following],
    queryFn:  () => pcapApi.stream(caseId!, selectedId!, following!),
    enabled:  !!caseId && !!selectedId && following !== null,
  })

  // TCP stream index of the currently selected packet, when it belongs to one
  const currentStream = useMemo(() => {
    if (frameNo === null) return null
    const row = rows?.items.find(r => Number(r.No) === frameNo)
    const raw = row?.TcpStream
    return raw !== undefined && raw !== '' ? Number(raw) : null
  }, [frameNo, rows])

  const pinnedKeys = useMemo(() => new Set(pinned.map(p => p.key)), [pinned])

  const togglePin = useCallback((row: Record<string, string>) => {
    if (!active) return
    const key = `${active.id}${row.No}`
    setPinned(prev => {
      if (prev.some(p => p.key === key)) return prev.filter(p => p.key !== key)
      const capture = captureName(active.original_name)
      return [...prev, {
        key, artifactId: active.id, capture, row,
        title:       defaultTitle(row, capture),
        description: defaultDescription(row),
      }]
    })
  }, [active])

  const exportToTimeline = useCallback(async () => {
    if (!caseId || pinned.length === 0) return
    setExporting(true)
    try {
      const sorted = [...pinned].sort(
        (a, b) => (a.row.Timestamp ?? '').localeCompare(b.row.Timestamp ?? ''))
      for (const item of sorted) {
        await timelineApi.create(caseId, {
          // Packet times come back in DuckDB's rendering ("…+00"), which the
          // API rejects verbatim — normalise to a real ISO instant.
          event_ts:    parseArtifactTimestamp(item.row.Timestamp ?? '', 'UTC'),
          title:       item.title.trim() || defaultTitle(item.row, item.capture),
          description: item.description,
          actor:       item.row.Source ?? '',
          source:      item.capture,
          tags:        `pcap,${(item.row.Protocol ?? '').toLowerCase()}`,
          origin:      'artifact',
          raw_payload: JSON.stringify(item.row),
          raw_source:  `PCAP · ${item.capture}`,
        })
      }
      qc.invalidateQueries({ queryKey: ['timeline', caseId] })
      setPinned([])
    } finally {
      setExporting(false)
    }
  }, [caseId, pinned, qc])

  // ── Guards ────────────────────────────────────────────────────────────────

  if (!caseId) {
    return (
      <div className="p-6">
        <div className="flex items-center gap-2 text-ui text-fg-secondary bg-white/[0.02] border border-hairline px-4 py-3">
          <AlertCircle size={14} />
          Select a current case from the top bar to explore its captures.
        </div>
      </div>
    )
  }

  if (status && !status.available) {
    return (
      <div className="p-6">
        <div className="flex items-center gap-2 text-ui text-severity-medium bg-severity-medium/5 border border-severity-medium/20 px-4 py-3">
          <AlertCircle size={14} />
          tshark is not available in the backend image - PCAP dissection is disabled.
        </div>
      </div>
    )
  }

  const totalPages = rows?.pages ?? 1

  return (
    <PageShell
      route="/artifacts/pcap"
      title="Network (PCAP)"
      subtitle={currentCase?.title}
      meta={captures.length ? `${captures.length} capture${captures.length > 1 ? 's' : ''}` : undefined}
      fullHeight
      asideLeft={(
        <aside className="w-56 shrink-0 border-r border-hairline bg-panel flex flex-col min-h-0 overflow-hidden">
        <p className="px-3 py-2 text-label font-mono uppercase tracking-label text-fg-muted flex items-center gap-1.5 border-b border-hairline">
          <Network size={11} /> Captures
        </p>
        <div className="flex-1 overflow-y-auto">
          {captures.length === 0 && (
            <p className="px-3 py-6 text-label text-fg-secondary/30 leading-relaxed text-center">
              No capture in this case. Drop a .pcap / .pcapng into the drop folder
              ou depuis l'onglet Collection.
            </p>
          )}
          {captures.map(c => (
            <button key={c.id}
              onClick={() => { setSelectedId(c.id); setPage(1); setFrameNo(null) }}
              className={`w-full text-left px-3 py-2 border-b border-strong/[0.03] transition-colors ${ selectedId === c.id
                  ? 'bg-accent/5 border-l-2 border-l-accent/40'
                  : 'hover:bg-white/[0.02]'
              }`}>
              <p className="text-label text-fg/80 truncate font-mono">{captureName(c.original_name)}</p>
              <p className="text-label text-fg-secondary/35 mt-0.5">
                {c.row_count.toLocaleString()} paquets
              </p>
            </button>
          ))}
        </div>
        </aside>
      )}
    >
      <div className="h-full min-w-0 flex flex-col overflow-hidden">
        {/* Toolbar */}
        <div className="flex items-center gap-2 px-3 py-2 border-b border-hairline shrink-0">
          <div className="relative flex-1 max-w-md">
            <Search size={11} className="absolute left-2 top-1/2 -translate-y-1/2 text-fg-secondary/30" />
            <input
              value={search}
              onChange={e => setSearch(e.target.value)}
              placeholder="Filter packets (full-text search)..."
              className="w-full bg-black/30 border border-hairline rounded-control pl-7 pr-2 py-1 text-label text-fg/90 placeholder:text-fg-secondary/30 focus:border-accent/40 focus:outline-none"
            />
            {search && (
              <button onClick={() => setSearch('')}
                className="absolute right-2 top-1/2 -translate-y-1/2 text-fg-secondary/30 hover:text-fg">
                <X size={10} />
              </button>
            )}
          </div>
          {debounced && (
            <span className="text-label text-accent/60 flex items-center gap-1">
              <Filter size={9} /> {rows?.total ?? 0} paquet(s)
            </span>
          )}
          {isFetching && <Loader2 size={11} className="animate-spin text-accent/50" />}
          <div className="ml-auto flex items-center gap-1.5 text-label text-fg-secondary/50">
            <button disabled={page <= 1} onClick={() => setPage(p => p - 1)}
              className="px-2 py-0.5 rounded-control border border-hairline disabled:opacity-25 hover:text-fg">←</button>
            <span>page {page} / {totalPages}</span>
            <button disabled={page >= totalPages} onClick={() => setPage(p => p + 1)}
              className="px-2 py-0.5 rounded-control border border-hairline disabled:opacity-25 hover:text-fg">→</button>
          </div>
        </div>

        {/* Packet list */}
        <div className="flex-1 min-h-0 overflow-auto">
          <DataTable
            density="compact"
            rows={rows?.items ?? []}
            rowKey={(row) => String(row.No)}
            empty="No packet matches the filter."
            onRowClick={(row) => { setFrameNo(Number(row.No)); setHighlight(null) }}
            isRowSelected={(row) => frameNo === Number(row.No)}
            leading={{
              width: 'w-7',
              render: (row) => {
                const isPinned = pinnedKeys.has(`${active?.id}${row.No}`)
                return (
                  <button
                    onClick={() => togglePin(row)}
                    title={isPinned ? 'Remove from the selection' : 'Pin this packet'}
                    aria-label={isPinned ? 'Remove from the selection' : 'Pin this packet'}
                    className={`block transition-colors ${isPinned ? 'text-accent' : 'text-fg-muted hover:text-accent'}`}
                  >
                    {isPinned ? <BookmarkCheck size={11} /> : <BookmarkPlus size={11} />}
                  </button>
                )
              },
            }}
            columns={[
              { key: 'no',    header: 'No',    width: 'w-14', mono: true, render: (row) => <span className="text-fg-muted">{row.No}</span> },
              { key: 'time',  header: 'Time',  width: 'w-48', mono: true, render: (row) => <span className="text-fg-secondary whitespace-nowrap">{fmtTime(row.Timestamp ?? '')}</span> },
              { key: 'src',   header: 'Source',      width: 'w-36', mono: true, render: (row) => <span className="block truncate text-fg-secondary">{row.Source}</span> },
              { key: 'dst',   header: 'Destination', width: 'w-36', mono: true, render: (row) => <span className="block truncate text-fg-secondary">{row.Destination}</span> },
              { key: 'proto', header: 'Proto', width: 'w-16', mono: true, render: (row) => <span className={`font-semibold ${protoClass(row.Protocol ?? '')}`}>{row.Protocol}</span> },
              { key: 'len',   header: 'Len',   width: 'w-14', mono: true, align: 'right', render: (row) => <span className="text-fg-muted">{row.Length}</span> },
              { key: 'info',  header: 'Info',  mono: true, hideBelow: 'md', render: (row) => <span className="block truncate text-fg-muted">{row.Info}</span> },
            ]}
          />
        </div>

        {/* Detail panes */}
        <div className="h-64 shrink-0 border-t border-hairline flex overflow-hidden">
          <div className="flex-1 min-w-0 border-r border-hairline flex flex-col overflow-hidden">
            <div className="flex items-center gap-2 px-2 py-1 border-b border-hairline shrink-0">
              <p className="text-label uppercase tracking-widest text-fg-secondary/35">
                Packet detail {frameNo !== null && `- #${frameNo}`}
              </p>
              {currentStream !== null && (
                <button
                  onClick={() => setFollowing(currentStream)}
                  disabled={loadingStream}
                  title="Reassemble the full conversation for this stream"
                  className="ml-auto flex items-center gap-1 text-label px-1.5 py-0.5 rounded-control border border-accent/25 text-accent/80 hover:bg-accent/10 transition-colors disabled:opacity-40"
                >
                  {loadingStream
                    ? <Loader2 size={9} className="animate-spin" />
                    : <ArrowLeftRight size={9} />}
                  Suivre le flux TCP {currentStream}
                </button>
              )}
            </div>
            {streamError && following !== null && (
              <p className="px-2 py-1 text-label text-severity-critical border-b border-hairline shrink-0">
                {(streamError as any)?.response?.data?.detail ?? 'Could not reassemble the stream.'}
              </p>
            )}
            {frameNo === null ? (
              <p className="p-3 text-label text-fg-secondary/30 italic">
                Select a packet to see its protocol tree.
              </p>
            ) : loadingFrame ? (
              <div className="flex items-center gap-2 p-3 text-label text-fg-secondary/40">
                <Loader2 size={11} className="animate-spin" /> Dissection…
              </div>
            ) : frameError ? (
              <p className="p-3 text-label text-severity-critical">
                {(frameError as any)?.response?.data?.detail ?? 'Could not dissect the frame.'}
              </p>
            ) : frame ? (
              <ProtocolTree frame={frame} onHighlight={setHighlight} />
            ) : null}
          </div>

          <div className="w-[420px] shrink-0 flex flex-col overflow-hidden">
            <p className="px-2 py-1 text-label uppercase tracking-widest text-fg-secondary/35 border-b border-hairline shrink-0">
              Octets
            </p>
            {frame ? <HexDump hex={hex} highlight={highlight} /> : (
              <p className="p-3 text-label text-fg-secondary/30 italic">—</p>
            )}
          </div>
        </div>
      </div>

      {/* ── Follow stream overlay ────────────────────────────────────────── */}
      {stream && following !== null && (
        <FollowStreamPanel stream={stream} onClose={() => setFollowing(null)} />
      )}

      {/* ── Selection panel ──────────────────────────────────────────────── */}
      <PinnedPanel
        pinned={pinned}
        onUnpin={key => setPinned(p => p.filter(x => x.key !== key))}
        onClear={() => setPinned([])}
        onEdit={(key, patch) => setPinned(p => p.map(x => x.key === key ? { ...x, ...patch } : x))}
        onExport={exportToTimeline}
        exporting={exporting}
      />
    </PageShell>
  )
}
