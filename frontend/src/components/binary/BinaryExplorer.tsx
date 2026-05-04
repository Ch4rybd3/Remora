import { useState, useMemo } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import {
  Layers, AlignLeft, Code2, BarChart3, Package, ShieldAlert,
  ChevronDown, ChevronRight, Loader2, AlertTriangle, RefreshCw,
  Eye, EyeOff, Lock, Database,
} from 'lucide-react'
import { binaryApi, type BinaryFile, type BinaryAnalysis, type SectionInfo } from '../../api/binary'

interface Props {
  caseId:   string
  file:     BinaryFile
  onFileUpdate: (f: BinaryFile) => void
}

type Tab = 'overview' | 'sections' | 'strings' | 'disassembly' | 'imports'

// ── Entropy bar ───────────────────────────────────────────────────────────────

function EntropyBar({ value }: { value: number }) {
  const pct = Math.min(100, (value / 8) * 100)
  const color =
    value >= 7.2 ? 'bg-severity-critical' :
    value >= 6.5 ? 'bg-orange-400' :
    value >= 5.0 ? 'bg-yellow-400' :
    'bg-accent-green'
  const label =
    value >= 7.2 ? 'packed/encrypted' :
    value >= 6.5 ? 'high entropy' :
    value >= 5.0 ? 'compressed?' :
    'normal'

  return (
    <div className="flex items-center gap-2">
      <div className="flex-1 h-1.5 bg-white/5 rounded-full overflow-hidden">
        <div className={`h-full rounded-full ${color}`} style={{ width: `${pct}%` }} />
      </div>
      <span className="text-[9px] font-mono text-accent-muted/50 w-6 text-right">{value.toFixed(2)}</span>
      <span className={`text-[8px] ${color.replace('bg-', 'text-')} opacity-70`}>{label}</span>
    </div>
  )
}

// ── Type + arch badge ─────────────────────────────────────────────────────────

function TypeBadge({ type }: { type: string }) {
  const colors: Record<string, string> = {
    PE:      'bg-blue-500/10 text-blue-400 border-blue-500/20',
    ELF:     'bg-accent-green/10 text-accent-green border-accent-green/20',
    MachO:   'bg-purple-500/10 text-purple-400 border-purple-500/20',
    unknown: 'bg-white/5 text-white/30 border-white/10',
  }
  return (
    <span className={`text-[9px] font-mono px-2 py-0.5 rounded border ${colors[type] ?? colors.unknown}`}>
      {type}
    </span>
  )
}

// ── Overview tab ──────────────────────────────────────────────────────────────

function OverviewTab({ file, analysis }: { file: BinaryFile; analysis: BinaryAnalysis }) {
  const rows = [
    ['Filename',     file.filename],
    ['Type',         analysis.binary_type],
    ['Architecture', analysis.architecture ?? '—'],
    ['Entry point',  analysis.entrypoint != null ? `0x${analysis.entrypoint.toString(16).toUpperCase()}` : '—'],
    ['Image base',   analysis.image_base  != null ? `0x${analysis.image_base.toString(16).toUpperCase()}`  : '—'],
    ['File size',    file.file_size != null ? `${file.file_size.toLocaleString()} bytes` : '—'],
    ['SHA-256',      file.sha256_hash ?? '—'],
    ['Sections',     String(analysis.sections.length)],
    ['Imports',      String(analysis.imports.reduce((s, i) => s + i.functions.length, 0)) + ' functions'],
    ['Exports',      String(analysis.exports.length)],
    ['Strings',      String(analysis.strings.length)],
  ]

  return (
    <div className="space-y-4 p-4">
      {/* Entropy overview */}
      <div className="bg-bg-secondary rounded border border-white/5 p-3 space-y-2">
        <div className="flex items-center gap-2 mb-3">
          <BarChart3 size={12} className="text-accent-muted/40" />
          <span className="text-[10px] font-semibold tracking-widest uppercase text-accent-muted/50">
            Overall Entropy
          </span>
        </div>
        <EntropyBar value={analysis.overall_entropy} />
      </div>

      {/* Metadata table */}
      <div className="bg-bg-secondary rounded border border-white/5 overflow-hidden">
        <div className="px-3 py-2 border-b border-white/5 flex items-center gap-2">
          <Database size={11} className="text-accent-muted/40" />
          <span className="text-[10px] font-semibold tracking-widest uppercase text-accent-muted/50">
            File Metadata
          </span>
        </div>
        <div className="divide-y divide-white/5">
          {rows.map(([k, v]) => (
            <div key={k} className="flex text-[10px] font-mono px-3 py-1.5">
              <span className="w-32 text-accent-muted/40 shrink-0">{k}</span>
              <span className="text-white/70 break-all">{v}</span>
            </div>
          ))}
        </div>
      </div>

      {/* Security observations */}
      {analysis.overall_entropy >= 6.5 && (
        <div className="flex items-start gap-2 px-3 py-2.5 bg-severity-critical/5 border border-severity-critical/20 rounded">
          <ShieldAlert size={13} className="mt-0.5 shrink-0 text-severity-critical" />
          <div>
            <p className="text-[10px] font-semibold text-severity-critical">High Entropy Detected</p>
            <p className="text-[9px] text-accent-muted/50 mt-0.5">
              Overall entropy {analysis.overall_entropy.toFixed(2)} — file may be packed, obfuscated, or encrypted.
              Check section-level entropy for details.
            </p>
          </div>
        </div>
      )}

      {analysis.exports.length > 0 && (
        <div className="bg-bg-secondary rounded border border-white/5 p-3">
          <p className="text-[10px] font-semibold tracking-widest uppercase text-accent-muted/50 mb-2">Exports</p>
          <div className="flex flex-wrap gap-1">
            {analysis.exports.slice(0, 50).map((exp, i) => (
              <span key={i} className="text-[9px] font-mono px-1.5 py-0.5 bg-white/5 border border-white/10 rounded text-white/50">
                {exp}
              </span>
            ))}
            {analysis.exports.length > 50 && (
              <span className="text-[9px] text-accent-muted/30">+{analysis.exports.length - 50} more</span>
            )}
          </div>
        </div>
      )}
    </div>
  )
}

// ── Sections tab ──────────────────────────────────────────────────────────────

function SectionsTab({ sections }: { sections: SectionInfo[] }) {
  if (sections.length === 0) {
    return <p className="text-center text-[11px] text-accent-muted/30 py-12">No sections found</p>
  }
  return (
    <div className="p-4 space-y-2">
      {sections.map((sec, i) => (
        <div key={i} className="bg-bg-secondary rounded border border-white/5 p-3 space-y-2">
          <div className="flex items-center gap-2">
            <span className="text-[11px] font-mono font-semibold text-white/80">{sec.name || `[${i}]`}</span>
            <span className="text-[9px] font-mono text-accent-muted/30">
              VA: 0x{sec.virtual_address.toString(16).toUpperCase()}
            </span>
            <span className="text-[9px] font-mono text-accent-muted/30 ml-auto">
              {(sec.raw_size / 1024).toFixed(1)} KB
            </span>
          </div>
          <EntropyBar value={sec.entropy} />
          {sec.characteristics && (
            <p className="text-[8px] font-mono text-accent-muted/25">flags: {sec.characteristics}</p>
          )}
        </div>
      ))}
    </div>
  )
}

// ── Imports tab ───────────────────────────────────────────────────────────────

function ImportsTab({ imports }: { imports: BinaryAnalysis['imports'] }) {
  const [expanded, setExpanded] = useState<Record<string, boolean>>({})

  if (imports.length === 0) {
    return <p className="text-center text-[11px] text-accent-muted/30 py-12">No imports found</p>
  }

  const toggle = (lib: string) => setExpanded(p => ({ ...p, [lib]: !p[lib] }))

  return (
    <div className="p-4 space-y-1.5">
      {imports.map((imp, i) => (
        <div key={i} className="bg-bg-secondary rounded border border-white/5 overflow-hidden">
          <button
            onClick={() => toggle(imp.library)}
            className="w-full flex items-center gap-2 px-3 py-2 hover:bg-white/5 transition-colors text-left"
          >
            {expanded[imp.library]
              ? <ChevronDown size={11} className="text-accent-muted/40 shrink-0" />
              : <ChevronRight size={11} className="text-accent-muted/40 shrink-0" />
            }
            <Package size={11} className="text-accent-muted/30 shrink-0" />
            <span className="text-[11px] font-mono text-white/70 flex-1">{imp.library}</span>
            <span className="text-[9px] text-accent-muted/30">{imp.functions.length} fn</span>
          </button>
          {expanded[imp.library] && imp.functions.length > 0 && (
            <div className="border-t border-white/5 px-3 py-2 grid grid-cols-2 gap-x-4 gap-y-0.5">
              {imp.functions.map((fn, j) => (
                <span key={j} className="text-[9px] font-mono text-accent-muted/50 truncate">{fn}</span>
              ))}
            </div>
          )}
        </div>
      ))}
    </div>
  )
}

// ── Strings tab ───────────────────────────────────────────────────────────────

function StringsTab({ strings }: { strings: BinaryAnalysis['strings'] }) {
  const [search, setSearch] = useState('')
  const [enc,    setEnc]    = useState<'all' | 'ascii' | 'utf-16'>('all')

  const filtered = useMemo(() => {
    let s = strings
    if (enc !== 'all') s = s.filter(x => x.encoding === enc)
    if (search.trim()) {
      const q = search.toLowerCase()
      s = s.filter(x => x.value.toLowerCase().includes(q))
    }
    return s.slice(0, 500)
  }, [strings, search, enc])

  return (
    <div className="flex flex-col h-full overflow-hidden">
      {/* Filter bar */}
      <div className="flex items-center gap-2 px-4 py-2 border-b border-white/5 shrink-0">
        <input
          type="text"
          placeholder="Filter strings…"
          value={search}
          onChange={e => setSearch(e.target.value)}
          className="flex-1 bg-bg-primary border border-white/10 rounded px-2.5 py-1 text-[11px] text-white placeholder:text-accent-muted/30 focus:outline-none focus:border-accent-green/30"
        />
        {(['all', 'ascii', 'utf-16'] as const).map(e => (
          <button
            key={e}
            onClick={() => setEnc(e)}
            className={`text-[9px] font-mono px-2 py-1 rounded border transition-colors ${
              enc === e
                ? 'bg-accent-green/10 border-accent-green/30 text-accent-green'
                : 'border-white/10 text-accent-muted/30 hover:text-white/50'
            }`}
          >
            {e}
          </button>
        ))}
        <span className="text-[9px] text-accent-muted/30">{filtered.length} shown</span>
      </div>
      {/* List */}
      <div className="flex-1 overflow-y-auto">
        <table className="w-full text-[10px] font-mono">
          <thead className="sticky top-0 bg-bg-secondary border-b border-white/5">
            <tr>
              <th className="px-3 py-1.5 text-left text-accent-muted/40 font-normal w-24">Offset</th>
              <th className="px-2 py-1.5 text-left text-accent-muted/40 font-normal w-12">Enc</th>
              <th className="px-2 py-1.5 text-left text-accent-muted/40 font-normal">String</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-white/5">
            {filtered.map((s, i) => (
              <tr key={i} className="hover:bg-white/5">
                <td className="px-3 py-1 text-accent-muted/30">0x{s.offset.toString(16).padStart(8, '0')}</td>
                <td className="px-2 py-1 text-accent-muted/30">{s.encoding === 'utf-16' ? 'u16' : 'asc'}</td>
                <td className="px-2 py-1 text-white/70 break-all">{s.value}</td>
              </tr>
            ))}
          </tbody>
        </table>
        {filtered.length === 0 && (
          <p className="text-center text-[10px] text-accent-muted/30 py-8">No strings match</p>
        )}
      </div>
    </div>
  )
}

// ── Disassembly tab ───────────────────────────────────────────────────────────

function DisassemblyTab({ lines }: { lines: BinaryAnalysis['disassembly'] }) {
  if (lines.length === 0) {
    return (
      <div className="flex items-center justify-center h-full">
        <p className="text-[11px] text-accent-muted/30">
          No disassembly available — install <code className="font-mono text-accent-muted/50">capstone</code> on the server
        </p>
      </div>
    )
  }
  return (
    <div className="overflow-y-auto h-full">
      <table className="w-full text-[10px] font-mono">
        <thead className="sticky top-0 bg-bg-secondary border-b border-white/5">
          <tr>
            <th className="px-3 py-1.5 text-left text-accent-muted/40 font-normal w-28">Address</th>
            <th className="px-2 py-1.5 text-left text-accent-muted/40 font-normal w-32">Bytes</th>
            <th className="px-2 py-1.5 text-left text-accent-muted/40 font-normal w-20">Mnemonic</th>
            <th className="px-2 py-1.5 text-left text-accent-muted/40 font-normal">Operands</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-white/5">
          {lines.map((l, i) => (
            <tr key={i} className="hover:bg-white/5">
              <td className="px-3 py-0.5 text-accent-muted/40">
                0x{l.address.toString(16).padStart(8, '0').toUpperCase()}
              </td>
              <td className="px-2 py-0.5 text-accent-muted/25">{l.bytes_hex}</td>
              <td className="px-2 py-0.5 text-accent-green/70 font-semibold">{l.mnemonic}</td>
              <td className="px-2 py-0.5 text-white/60">{l.op_str}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

// ── Re-analyse modal ──────────────────────────────────────────────────────────

function ReanalyseModal({
  caseId,
  fileId,
  onClose,
  onDone,
}: {
  caseId:  string
  fileId:  string
  onClose: () => void
  onDone:  (f: BinaryFile) => void
}) {
  const [password, setPassword] = useState('')
  const [showPass, setShowPass] = useState(false)
  const [err,      setErr]      = useState<string | null>(null)

  const mut = useMutation({
    mutationFn: () => binaryApi.reanalyse(caseId, fileId, password),
    onSuccess: (f) => { onDone(f); onClose() },
    onError: (e: any) => setErr(e?.response?.data?.detail ?? 'Re-analysis failed'),
  })

  return (
    <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50">
      <div className="bg-bg-secondary border border-white/10 rounded-lg w-80 p-5 space-y-4">
        <div>
          <p className="text-sm font-semibold text-white">Re-analyse Binary</p>
          <p className="text-[10px] text-accent-muted/50 mt-1">
            Provide the original upload password to decrypt and re-analyse the file.
          </p>
        </div>
        <div className="relative">
          <Lock size={10} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-accent-muted/30" />
          <input
            type={showPass ? 'text' : 'password'}
            placeholder="Decryption password"
            value={password}
            onChange={e => setPassword(e.target.value)}
            onKeyDown={e => e.key === 'Enter' && password && mut.mutate()}
            className="w-full bg-bg-primary border border-white/10 rounded px-7 py-1.5 text-[11px] text-white placeholder:text-accent-muted/30 focus:outline-none focus:border-accent-green/30"
          />
          <button
            onClick={() => setShowPass(v => !v)}
            className="absolute right-2 top-1/2 -translate-y-1/2 text-accent-muted/30 hover:text-white"
            type="button"
          >
            {showPass ? <EyeOff size={11} /> : <Eye size={11} />}
          </button>
        </div>
        {err && <p className="text-[10px] text-severity-critical">{err}</p>}
        <div className="flex gap-2">
          <button
            onClick={onClose}
            className="flex-1 py-1.5 rounded border border-white/10 text-[11px] text-accent-muted hover:text-white transition-colors"
          >
            Cancel
          </button>
          <button
            onClick={() => mut.mutate()}
            disabled={!password || mut.isPending}
            className="flex-1 py-1.5 rounded bg-accent-green/10 border border-accent-green/20 text-accent-green text-[11px] hover:bg-accent-green/15 disabled:opacity-40 transition-colors"
          >
            {mut.isPending ? 'Starting…' : 'Re-analyse'}
          </button>
        </div>
      </div>
    </div>
  )
}

// ── Main explorer ─────────────────────────────────────────────────────────────

const TABS: { id: Tab; label: string; icon: React.ElementType }[] = [
  { id: 'overview',     label: 'Overview',     icon: BarChart3  },
  { id: 'sections',     label: 'Sections',     icon: Layers     },
  { id: 'imports',      label: 'Imports',      icon: Package    },
  { id: 'strings',      label: 'Strings',      icon: AlignLeft  },
  { id: 'disassembly',  label: 'Disassembly',  icon: Code2      },
]

export default function BinaryExplorer({ caseId, file, onFileUpdate }: Props) {
  const qc = useQueryClient()
  const [activeTab,    setActiveTab]    = useState<Tab>('overview')
  const [showReanalyse, setShowReanalyse] = useState(false)

  // Poll file status until ready
  const { data: currentFile } = useQuery({
    queryKey:  ['binary-file', file.id],
    queryFn:   () => binaryApi.getFile(caseId, file.id),
    initialData: file,
    refetchInterval: (query) => {
      const f = query.state.data
      return (f?.status === 'pending' || f?.status === 'analysing') ? 2000 : false
    },
  })

  const { data: analysis, isLoading: loadingAnalysis } = useQuery({
    queryKey: ['binary-analysis', file.id],
    queryFn:  () => binaryApi.getAnalysis(caseId, file.id),
    enabled:  currentFile?.status === 'ready',
  })

  const f = currentFile ?? file
  const isAnalysing = f.status === 'pending' || f.status === 'analysing'
  const isError     = f.status === 'error'
  const isReady     = f.status === 'ready'

  return (
    <div className="flex flex-col h-full overflow-hidden">
      {/* Header */}
      <div className="shrink-0 border-b border-white/5 bg-bg-secondary/50">
        <div className="flex items-center gap-3 px-4 py-2.5">
          <Lock size={12} className="text-accent-muted/30 shrink-0" />
          <span className="text-[11px] font-mono text-white/70 truncate flex-1">{f.filename}</span>
          {f.binary_type && <TypeBadge type={f.binary_type} />}
          {f.sha256_hash && (
            <span className="text-[8px] font-mono text-accent-muted/25 hidden xl:block">
              SHA256: {f.sha256_hash.slice(0, 16)}…
            </span>
          )}

          {/* Actions */}
          <div className="flex items-center gap-1.5 ml-auto shrink-0">
            <button
              onClick={() => setShowReanalyse(true)}
              disabled={isAnalysing}
              className="flex items-center gap-1 px-2 py-1 rounded border border-white/10 text-[9px] text-accent-muted/40 hover:text-white hover:border-white/20 disabled:opacity-40 transition-colors"
              title="Re-analyse with password"
            >
              <RefreshCw size={10} />
              Re-analyse
            </button>
          </div>
        </div>

        {/* Tab bar */}
        <div className="flex border-t border-white/5">
          {TABS.map(tab => {
            const Icon = tab.icon
            return (
              <button
                key={tab.id}
                onClick={() => setActiveTab(tab.id)}
                disabled={!isReady}
                className={`flex items-center gap-1.5 px-3 py-2 text-[9px] font-semibold tracking-widest uppercase transition-colors border-b-2 ${
                  activeTab === tab.id
                    ? 'text-accent-green border-accent-green bg-accent-green/5'
                    : 'text-accent-muted/40 border-transparent hover:text-white/60 disabled:opacity-30'
                }`}
              >
                <Icon size={10} />
                {tab.label}
              </button>
            )
          })}
        </div>
      </div>

      {/* Content */}
      <div className="flex-1 overflow-hidden">
        {isAnalysing && (
          <div className="flex flex-col items-center justify-center h-full gap-3">
            <Loader2 size={24} className="animate-spin text-accent-green/40" />
            <p className="text-[11px] text-accent-muted/50">
              {f.status === 'analysing' ? 'Analysing binary…' : 'Queued for analysis…'}
            </p>
            <p className="text-[9px] text-accent-muted/25">Extracting sections · strings · disassembly</p>
          </div>
        )}

        {isError && (
          <div className="flex flex-col items-center justify-center h-full gap-2">
            <AlertTriangle size={22} className="text-severity-critical/60" />
            <p className="text-[11px] text-severity-critical/70">Analysis failed</p>
            <p className="text-[9px] text-accent-muted/40 max-w-xs text-center">{f.error_msg}</p>
          </div>
        )}

        {isReady && loadingAnalysis && (
          <div className="flex items-center justify-center h-full">
            <Loader2 size={18} className="animate-spin text-accent-muted/40" />
          </div>
        )}

        {isReady && analysis && (
          <div className="h-full overflow-hidden">
            {activeTab === 'overview'    && <div className="h-full overflow-y-auto"><OverviewTab file={f} analysis={analysis} /></div>}
            {activeTab === 'sections'    && <div className="h-full overflow-y-auto"><SectionsTab sections={analysis.sections} /></div>}
            {activeTab === 'imports'     && <div className="h-full overflow-y-auto"><ImportsTab imports={analysis.imports} /></div>}
            {activeTab === 'strings'     && <div className="h-full overflow-hidden flex flex-col"><StringsTab strings={analysis.strings} /></div>}
            {activeTab === 'disassembly' && <DisassemblyTab lines={analysis.disassembly} />}
          </div>
        )}
      </div>

      {showReanalyse && (
        <ReanalyseModal
          caseId={caseId}
          fileId={file.id}
          onClose={() => setShowReanalyse(false)}
          onDone={(f) => { onFileUpdate(f); qc.invalidateQueries({ queryKey: ['binary-file', file.id] }) }}
        />
      )}
    </div>
  )
}
