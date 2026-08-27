/**
 * PCAP Explorer — Wireshark-style three-pane view over a dissected capture.
 *
 * The packet list is the artifact CSV produced by the backend (so it reuses the
 * same rows endpoint, filters and paging as the Artifact Explorer); the
 * protocol tree and hexdump come from dissecting the selected frame on demand.
 */
import { useState, useMemo, useEffect, useCallback } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import {
  Network, Search, X, ChevronRight, BookmarkPlus, BookmarkCheck,
  Loader2, Download, AlertCircle, Filter, ArrowLeftRight, Copy, Check,
} from 'lucide-react'
import { csvArtifactsApi, type CsvArtifactMeta } from '../api/csvArtifacts'
import {
  pcapApi, isPcapArtifact, captureName, hexToBytes,
  type PcapFrame, type PcapStream,
} from '../api/pcap'
import { timelineApi } from '../api/timeline'
import { useCurrentCase } from '../context/CurrentCaseContext'
import { parseArtifactTimestamp } from '../utils/dateUtils'

const PAGE_SIZE = 200

// ── Protocol colouring ────────────────────────────────────────────────────────
// Mirrors Wireshark's default rules closely enough to be readable at a glance.

const PROTO_ROW: Record<string, string> = {
  DNS:  'text-blue-300',
  HTTP: 'text-accent-green',
  TLS:  'text-purple-300',
  TCP:  'text-white/70',
  UDP:  'text-cyan-300',
  ICMP: 'text-orange-300',
  ARP:  'text-yellow-300',
  SMB:  'text-pink-300',
  SMB2: 'text-pink-300',
}

function protoClass(proto: string): string {
  return PROTO_ROW[proto?.toUpperCase()] ?? 'text-white/55'
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
        className={`flex items-start gap-1 px-2 py-[3px] text-[10px] font-mono leading-snug hover:bg-white/5 ${
          isBranch && children.length > 0 ? 'cursor-pointer' : ''
        } ${range ? 'hover:text-accent-green' : ''}`}
        style={{ paddingLeft: 8 + depth * 12 }}
      >
        {isBranch && children.length > 0 ? (
          <ChevronRight size={9}
            className={`mt-[3px] shrink-0 text-accent-muted/40 transition-transform ${open ? 'rotate-90' : ''}`} />
        ) : (
          <span className="w-[9px] shrink-0" />
        )}
        <span className="text-accent-muted/70 shrink-0">{label}</span>
        {display && (
          <>
            <span className="text-accent-muted/25">:</span>
            <span className="text-white/75 break-all">{display}</span>
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
    return <p className="p-3 text-[10px] text-accent-muted/30 italic">Octets bruts indisponibles.</p>
  }

  const rows: number[][] = []
  for (let i = 0; i < bytes.length; i += 16) rows.push(bytes.slice(i, i + 16))

  const inRange = (idx: number) =>
    !!highlight && idx >= highlight.offset && idx < highlight.offset + highlight.length

  return (
    <div className="h-full overflow-auto p-2 font-mono text-[10px] leading-[1.45]">
      {rows.map((row, r) => (
        <div key={r} className="flex gap-3 whitespace-pre">
          <span className="text-accent-muted/30 shrink-0">
            {(r * 16).toString(16).padStart(4, '0')}
          </span>
          <span className="shrink-0">
            {row.map((b, i) => {
              const idx = r * 16 + i
              return (
                <span key={i}
                  className={inRange(idx) ? 'bg-accent-green/25 text-accent-green' : 'text-white/60'}>
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
                  className={inRange(idx) ? 'bg-accent-green/25 text-accent-green' : 'text-white/45'}>
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

function fmtBytes(n: number): string {
  if (n < 1024) return `${n} o`
  if (n < 1024 ** 2) return `${(n / 1024).toFixed(1)} Ko`
  return `${(n / 1024 ** 2).toFixed(1)} Mo`
}

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
      <div className="w-full max-w-5xl h-full max-h-[85vh] bg-bg-card border border-white/10 rounded-lg flex flex-col overflow-hidden"
           onClick={e => e.stopPropagation()}>
        {/* Header */}
        <div className="flex items-center gap-2 px-4 py-2.5 border-b border-white/8 shrink-0">
          <ArrowLeftRight size={13} className="text-accent-green shrink-0" />
          <p className="text-xs font-semibold text-white shrink-0">
            Flux {stream.protocol.toUpperCase()} n°{stream.stream}
          </p>
          <p className="text-[10px] font-mono text-accent-muted/50 truncate">
            {stream.node0} ↔ {stream.node1}
          </p>
          <span className="text-[10px] text-accent-muted/35 shrink-0">
            {fmtBytes(stream.total_bytes)} · {stream.chunks.length} segment(s)
          </span>
          <button onClick={onClose}
            className="ml-auto text-accent-muted/40 hover:text-white transition-colors shrink-0">
            <X size={14} />
          </button>
        </div>

        {/* Controls */}
        <div className="flex items-center gap-2 px-4 py-2 border-b border-white/5 shrink-0">
          <div className="flex rounded border border-white/10 overflow-hidden">
            {(['ascii', 'hex'] as const).map(v => (
              <button key={v} onClick={() => setView(v)}
                className={`text-[10px] px-2.5 py-1 transition-colors ${
                  view === v ? 'bg-accent-green/10 text-accent-green' : 'text-accent-muted hover:text-white'
                }`}>
                {v === 'ascii' ? 'ASCII' : 'Hex'}
              </button>
            ))}
          </div>
          <div className="flex rounded border border-white/10 overflow-hidden">
            {([
              ['both', 'Les deux sens'],
              ['c2s',  `→ ${stream.node1}`],
              ['s2c',  `← ${stream.node1}`],
            ] as const).map(([v, label]) => (
              <button key={v} onClick={() => setSide(v)}
                className={`text-[10px] px-2.5 py-1 truncate max-w-[180px] transition-colors ${
                  side === v ? 'bg-accent-green/10 text-accent-green' : 'text-accent-muted hover:text-white'
                }`}>
                {label}
              </button>
            ))}
          </div>
          <button onClick={copy}
            className="ml-auto flex items-center gap-1 text-[10px] px-2 py-1 rounded border border-white/10 text-accent-muted hover:text-accent-green hover:border-accent-green/40 transition-colors">
            {copied ? <Check size={10} className="text-accent-green" /> : <Copy size={10} />} Copy
          </button>
          <button onClick={download}
            className="flex items-center gap-1 text-[10px] px-2 py-1 rounded border border-white/10 text-accent-muted hover:text-accent-green hover:border-accent-green/40 transition-colors">
            <Download size={10} /> Exporter
          </button>
        </div>

        {stream.truncated && (
          <p className="px-4 py-1.5 text-[10px] text-yellow-400/80 bg-yellow-500/5 border-b border-yellow-500/15 shrink-0">
            Conversation truncated: only the first 2 MB are shown.
          </p>
        )}

        {/* Content — client and server tinted differently, as in Wireshark */}
        <div className="flex-1 overflow-auto p-3 font-mono text-[10px] leading-relaxed">
          {shown.map((c, i) => (
            <pre key={i}
              className={`whitespace-pre-wrap break-all mb-2 px-2 py-1 rounded border-l-2 ${
                c.direction === 'c2s'
                  ? 'border-l-accent-green/40 bg-accent-green/[0.04] text-accent-green/85'
                  : 'border-l-blue-400/40 bg-blue-400/[0.04] text-blue-300/85'
              }`}>
              {view === 'hex' ? toHexBlock(hexToBytes(c.hex)) : toAscii(hexToBytes(c.hex))}
            </pre>
          ))}
          {shown.length === 0 && (
            <p className="text-accent-muted/30 italic">No data in this direction.</p>
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
    <div className="w-72 shrink-0 border-l border-white/5 bg-bg-card flex flex-col overflow-hidden">
      <div className="flex items-center justify-between px-3 py-3 border-b border-white/5 shrink-0">
        <p className="text-[10px] font-semibold uppercase tracking-widest text-accent-muted/50 flex items-center gap-1.5">
          <BookmarkCheck size={10} /> Selection
          {pinned.length > 0 && (
            <span className="ml-1 bg-accent-green/15 text-accent-green border border-accent-green/30 rounded px-1.5 py-0.5 text-[9px] font-bold">
              {pinned.length}
            </span>
          )}
        </p>
        {pinned.length > 0 && (
          <button onClick={onClear} title="Tout retirer"
            className="text-accent-muted/30 hover:text-severity-critical transition-colors">
            <X size={12} />
          </button>
        )}
      </div>

      {pinned.length === 0 ? (
        <div className="flex-1 flex flex-col items-center justify-center gap-2 px-4 text-center">
          <BookmarkPlus size={22} className="text-accent-muted/15" />
          <p className="text-[10px] text-accent-muted/30 leading-relaxed">
            Pin packets to stage them before sending to the timeline
          </p>
        </div>
      ) : (
        <div className="flex-1 overflow-y-auto divide-y divide-white/[0.04]">
          {sorted.map(item => {
            const isOpen = expanded.has(item.key)
            return (
              <div key={item.key} className="group relative px-3 py-2.5 hover:bg-white/[0.02]">
                <div className="flex items-start gap-2 pr-5">
                  <button onClick={() => toggle(item.key)}
                    title={isOpen ? 'Replier' : 'Éditer titre et description'}
                    className="mt-0.5 shrink-0 text-accent-muted/30 hover:text-accent-green transition-colors">
                    <ChevronRight size={11} className={`transition-transform ${isOpen ? 'rotate-90' : ''}`} />
                  </button>
                  <div className="flex-1 min-w-0">
                    <span className="text-[8px] font-semibold px-1.5 py-0.5 rounded border bg-blue-500/10 text-blue-400 border-blue-500/20">
                      #{item.row.No} · {item.row.Protocol}
                    </span>
                    <p className="text-[10px] font-mono text-white/50 mt-0.5 truncate">
                      {fmtTime(item.row.Timestamp ?? '')}
                    </p>
                    <p className="text-[10px] text-white/70 mt-0.5 leading-snug line-clamp-2">{item.title}</p>
                  </div>
                </div>

                {isOpen && (
                  <div className="mt-2 pl-[19px] space-y-1.5">
                    <div>
                      <label className="text-[8px] uppercase tracking-widest text-accent-muted/40">Title</label>
                      <input value={item.title}
                        onChange={e => onEdit(item.key, { title: e.target.value })}
                        className="w-full mt-0.5 bg-black/30 border border-white/10 rounded px-1.5 py-1 text-[10px] text-white/90 focus:border-accent-green/40 focus:outline-none" />
                    </div>
                    <div>
                      <label className="text-[8px] uppercase tracking-widest text-accent-muted/40">Description</label>
                      <textarea value={item.description} rows={4}
                        onChange={e => onEdit(item.key, { description: e.target.value })}
                        className="w-full mt-0.5 bg-black/30 border border-white/10 rounded px-1.5 py-1 text-[10px] font-mono text-accent-muted resize-y focus:border-accent-green/40 focus:outline-none" />
                    </div>
                  </div>
                )}

                <button onClick={() => onUnpin(item.key)}
                  className="absolute right-2 top-2.5 opacity-0 group-hover:opacity-100 text-accent-muted/30 hover:text-severity-critical transition-all">
                  <X size={10} />
                </button>
              </div>
            )
          })}
        </div>
      )}

      <div className="px-3 py-3 border-t border-white/5 shrink-0">
        <button onClick={onExport} disabled={pinned.length === 0 || exporting}
          className="w-full flex items-center justify-center gap-1.5 text-[11px] py-2 rounded border border-accent-green/30 text-accent-green bg-accent-green/5 hover:bg-accent-green/10 disabled:opacity-30 disabled:cursor-not-allowed transition-colors">
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
        <div className="flex items-center gap-2 text-sm text-accent-muted bg-white/[0.02] border border-white/8 rounded-lg px-4 py-3">
          <AlertCircle size={14} />
          Select a current case from the top bar to explore its captures.
        </div>
      </div>
    )
  }

  if (status && !status.available) {
    return (
      <div className="p-6">
        <div className="flex items-center gap-2 text-sm text-yellow-400 bg-yellow-500/5 border border-yellow-500/20 rounded-lg px-4 py-3">
          <AlertCircle size={14} />
          tshark is not available in the backend image - PCAP dissection is disabled.
        </div>
      </div>
    )
  }

  const totalPages = rows?.pages ?? 1

  return (
    <div className="flex h-full overflow-hidden">
      {/* ── Captures sidebar ─────────────────────────────────────────────── */}
      <div className="w-56 shrink-0 border-r border-white/5 bg-bg-card flex flex-col overflow-hidden">
        <p className="px-3 py-3 text-[10px] font-semibold uppercase tracking-widest text-accent-muted/50 flex items-center gap-1.5 border-b border-white/5">
          <Network size={11} /> Captures
          {captures.length > 0 && (
            <span className="ml-auto text-accent-muted/30">{captures.length}</span>
          )}
        </p>
        <div className="flex-1 overflow-y-auto">
          {captures.length === 0 && (
            <p className="px-3 py-6 text-[10px] text-accent-muted/30 leading-relaxed text-center">
              No capture in this case. Drop a .pcap / .pcapng into the drop folder
              ou depuis l'onglet Collection.
            </p>
          )}
          {captures.map(c => (
            <button key={c.id}
              onClick={() => { setSelectedId(c.id); setPage(1); setFrameNo(null) }}
              className={`w-full text-left px-3 py-2 border-b border-white/[0.03] transition-colors ${
                selectedId === c.id
                  ? 'bg-accent-green/5 border-l-2 border-l-accent-green/40'
                  : 'hover:bg-white/[0.02]'
              }`}>
              <p className="text-[11px] text-white/80 truncate font-mono">{captureName(c.original_name)}</p>
              <p className="text-[9px] text-accent-muted/35 mt-0.5">
                {c.row_count.toLocaleString()} paquets
              </p>
            </button>
          ))}
        </div>
      </div>

      {/* ── Main: packet list + detail ───────────────────────────────────── */}
      <div className="flex-1 min-w-0 flex flex-col overflow-hidden">
        {/* Toolbar */}
        <div className="flex items-center gap-2 px-3 py-2 border-b border-white/5 shrink-0">
          <div className="relative flex-1 max-w-md">
            <Search size={11} className="absolute left-2 top-1/2 -translate-y-1/2 text-accent-muted/30" />
            <input
              value={search}
              onChange={e => setSearch(e.target.value)}
              placeholder="Filter packets (full-text search)..."
              className="w-full bg-black/30 border border-white/10 rounded pl-7 pr-2 py-1 text-[11px] text-white/90 placeholder:text-accent-muted/30 focus:border-accent-green/40 focus:outline-none"
            />
            {search && (
              <button onClick={() => setSearch('')}
                className="absolute right-2 top-1/2 -translate-y-1/2 text-accent-muted/30 hover:text-white">
                <X size={10} />
              </button>
            )}
          </div>
          {debounced && (
            <span className="text-[10px] text-accent-green/60 flex items-center gap-1">
              <Filter size={9} /> {rows?.total ?? 0} paquet(s)
            </span>
          )}
          {isFetching && <Loader2 size={11} className="animate-spin text-accent-green/50" />}
          <div className="ml-auto flex items-center gap-1.5 text-[10px] text-accent-muted/50">
            <button disabled={page <= 1} onClick={() => setPage(p => p - 1)}
              className="px-2 py-0.5 rounded border border-white/10 disabled:opacity-25 hover:text-white">←</button>
            <span>page {page} / {totalPages}</span>
            <button disabled={page >= totalPages} onClick={() => setPage(p => p + 1)}
              className="px-2 py-0.5 rounded border border-white/10 disabled:opacity-25 hover:text-white">→</button>
          </div>
        </div>

        {/* Packet list */}
        <div className="flex-1 min-h-0 overflow-auto">
          <table className="w-full text-[10px] font-mono border-collapse">
            <thead className="sticky top-0 bg-bg-card z-10">
              <tr className="text-accent-muted/40 text-left">
                <th className="w-7 px-1 py-1.5" />
                <th className="px-2 py-1.5 w-14">No</th>
                <th className="px-2 py-1.5 w-48">Time</th>
                <th className="px-2 py-1.5 w-36">Source</th>
                <th className="px-2 py-1.5 w-36">Destination</th>
                <th className="px-2 py-1.5 w-16">Proto</th>
                <th className="px-2 py-1.5 w-14">Len</th>
                <th className="px-2 py-1.5">Info</th>
              </tr>
            </thead>
            <tbody>
              {(rows?.items ?? []).map(row => {
                const no       = Number(row.No)
                const key      = `${active?.id}${row.No}`
                const isPinned = pinnedKeys.has(key)
                const isActive = frameNo === no
                return (
                  <tr key={row.No}
                    onClick={() => { setFrameNo(no); setHighlight(null) }}
                    className={`border-t border-white/[0.03] cursor-pointer transition-colors ${
                      isActive ? 'bg-accent-green/10' : 'hover:bg-white/[0.03]'
                    }`}>
                    <td className="px-1 py-1 align-top">
                      <button
                        onClick={e => { e.stopPropagation(); togglePin(row) }}
                        title={isPinned ? 'Remove from the selection' : 'Pin this packet'}
                        className={`transition-colors ${
                          isPinned ? 'text-accent-green' : 'text-accent-muted/20 hover:text-accent-green'
                        }`}>
                        {isPinned ? <BookmarkCheck size={11} /> : <BookmarkPlus size={11} />}
                      </button>
                    </td>
                    <td className="px-2 py-1 text-accent-muted/50">{row.No}</td>
                    <td className="px-2 py-1 text-accent-muted/70 whitespace-nowrap">{fmtTime(row.Timestamp ?? '')}</td>
                    <td className="px-2 py-1 text-white/60 truncate">{row.Source}</td>
                    <td className="px-2 py-1 text-white/60 truncate">{row.Destination}</td>
                    <td className={`px-2 py-1 font-semibold ${protoClass(row.Protocol ?? '')}`}>{row.Protocol}</td>
                    <td className="px-2 py-1 text-accent-muted/40">{row.Length}</td>
                    <td className="px-2 py-1 text-white/45 truncate max-w-0">{row.Info}</td>
                  </tr>
                )
              })}
            </tbody>
          </table>
          {rows && rows.items.length === 0 && (
            <p className="p-6 text-center text-[11px] text-accent-muted/30">
              No packet matches the filter.
            </p>
          )}
        </div>

        {/* Detail panes */}
        <div className="h-64 shrink-0 border-t border-white/8 flex overflow-hidden">
          <div className="flex-1 min-w-0 border-r border-white/5 flex flex-col overflow-hidden">
            <div className="flex items-center gap-2 px-2 py-1 border-b border-white/5 shrink-0">
              <p className="text-[9px] uppercase tracking-widest text-accent-muted/35">
                Packet detail {frameNo !== null && `- #${frameNo}`}
              </p>
              {currentStream !== null && (
                <button
                  onClick={() => setFollowing(currentStream)}
                  disabled={loadingStream}
                  title="Reassemble the full conversation for this stream"
                  className="ml-auto flex items-center gap-1 text-[9px] px-1.5 py-0.5 rounded border border-accent-green/25 text-accent-green/80 hover:bg-accent-green/10 transition-colors disabled:opacity-40"
                >
                  {loadingStream
                    ? <Loader2 size={9} className="animate-spin" />
                    : <ArrowLeftRight size={9} />}
                  Suivre le flux TCP {currentStream}
                </button>
              )}
            </div>
            {streamError && following !== null && (
              <p className="px-2 py-1 text-[9px] text-severity-critical border-b border-white/5 shrink-0">
                {(streamError as any)?.response?.data?.detail ?? 'Reconstruction impossible.'}
              </p>
            )}
            {frameNo === null ? (
              <p className="p-3 text-[10px] text-accent-muted/30 italic">
                Select a packet to see its protocol tree.
              </p>
            ) : loadingFrame ? (
              <div className="flex items-center gap-2 p-3 text-[10px] text-accent-muted/40">
                <Loader2 size={11} className="animate-spin" /> Dissection…
              </div>
            ) : frameError ? (
              <p className="p-3 text-[10px] text-severity-critical">
                {(frameError as any)?.response?.data?.detail ?? 'Dissection impossible.'}
              </p>
            ) : frame ? (
              <ProtocolTree frame={frame} onHighlight={setHighlight} />
            ) : null}
          </div>

          <div className="w-[420px] shrink-0 flex flex-col overflow-hidden">
            <p className="px-2 py-1 text-[9px] uppercase tracking-widest text-accent-muted/35 border-b border-white/5 shrink-0">
              Octets
            </p>
            {frame ? <HexDump hex={hex} highlight={highlight} /> : (
              <p className="p-3 text-[10px] text-accent-muted/30 italic">—</p>
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
    </div>
  )
}
