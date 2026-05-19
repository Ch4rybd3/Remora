import { useState, useRef } from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import {
  Search, Shield, AlertTriangle, CheckCircle2, XCircle,
  Loader2, ExternalLink, Plus, Clock, Globe, Hash,
  Cpu, Link2, ChevronDown, ChevronUp, Info,
} from 'lucide-react'
import { ctiApi, type LookupResult, type IOCType } from '../api/cti'
import { iocsApi } from '../api/iocs'
import { useCurrentCase } from '../context/CurrentCaseContext'

// ── Helpers ───────────────────────────────────────────────────────────────────

function detectTypeHint(value: string): IOCType | undefined {
  const v = value.trim()
  if (/^(\d{1,3}\.){3}\d{1,3}$/.test(v)) return 'ip'
  if (/^[0-9a-fA-F]{32}$/.test(v) || /^[0-9a-fA-F]{40}$/.test(v) || /^[0-9a-fA-F]{64}$/.test(v)) return 'hash'
  if (v.toLowerCase().startsWith('http://') || v.toLowerCase().startsWith('https://')) return 'url'
  return undefined
}

function typeIcon(t: string) {
  if (t === 'ip')     return <Globe size={13} className="text-blue-400" />
  if (t === 'domain') return <Globe size={13} className="text-teal-400" />
  if (t === 'hash')   return <Hash  size={13} className="text-purple-400" />
  if (t === 'url')    return <Link2 size={13} className="text-orange-400" />
  return <Cpu size={13} className="text-accent-muted/40" />
}

function typeBadge(t: string) {
  const cls: Record<string, string> = {
    ip:     'bg-blue-500/10 text-blue-400 border-blue-500/20',
    domain: 'bg-teal-500/10 text-teal-400 border-teal-500/20',
    hash:   'bg-purple-500/10 text-purple-400 border-purple-500/20',
    url:    'bg-orange-500/10 text-orange-400 border-orange-500/20',
  }
  return (
    <span className={`text-[9px] font-mono px-1.5 py-0.5 rounded border ${cls[t] ?? 'bg-white/5 text-white/30 border-white/10'}`}>
      {t}
    </span>
  )
}

// Map CTI type → IOC type for case IOC creation
function ctiTypeToIocType(t: string): string {
  if (t === 'ip')     return 'ip'
  if (t === 'domain') return 'domain'
  if (t === 'url')    return 'url'
  if (t === 'hash')   return 'hash_sha256'
  return 'other'
}

// ── VT "not found" card ───────────────────────────────────────────────────────

function VTNotFoundCard({ link }: { link: string }) {
  return (
    <div className="bg-bg-card border border-white/8 rounded-xl overflow-hidden">
      <div className="flex items-center gap-3 px-4 py-3 border-b border-white/5 bg-bg-secondary/30">
        <div className="w-7 h-7 rounded-lg bg-blue-500/10 flex items-center justify-center">
          <Shield size={14} className="text-blue-400" />
        </div>
        <span className="text-sm font-semibold text-white">VirusTotal</span>
        <a
          href={link}
          target="_blank"
          rel="noopener noreferrer"
          className="ml-auto flex items-center gap-1 text-[10px] text-accent-green/50 hover:text-accent-green transition-colors"
        >
          <ExternalLink size={10} /> View on VT
        </a>
      </div>
      <div className="flex items-center gap-3 px-4 py-5">
        <div className="w-16 h-16 shrink-0 flex items-center justify-center rounded-full bg-white/5 border border-white/8">
          <Info size={20} className="text-accent-muted/30" />
        </div>
        <div>
          <p className="text-sm font-semibold text-accent-muted/70">Not in VirusTotal database</p>
          <p className="text-[11px] text-accent-muted/40 mt-0.5">
            This indicator has not been submitted to VirusTotal yet, or was submitted very recently.
          </p>
        </div>
      </div>
    </div>
  )
}

// ── VT Score ring ─────────────────────────────────────────────────────────────

function VTScoreRing({ malicious, total }: { malicious: number; total: number }) {
  const pct   = total > 0 ? malicious / total : 0
  const color = malicious === 0 ? '#9FEF00' : malicious <= 3 ? '#FFAF00' : '#ef4444'
  const r     = 22
  const circ  = 2 * Math.PI * r
  const dash  = circ * (1 - pct)

  return (
    <div className="relative w-16 h-16 shrink-0">
      <svg width="64" height="64" className="-rotate-90">
        <circle cx="32" cy="32" r={r} fill="none" stroke="rgba(255,255,255,0.06)" strokeWidth="5" />
        <circle
          cx="32" cy="32" r={r}
          fill="none" stroke={color} strokeWidth="5"
          strokeDasharray={circ} strokeDashoffset={dash}
          strokeLinecap="round"
          style={{ transition: 'stroke-dashoffset 0.4s ease' }}
        />
      </svg>
      <div className="absolute inset-0 flex flex-col items-center justify-center">
        <span className="text-sm font-bold leading-none" style={{ color }}>{malicious}</span>
        <span className="text-[8px] text-accent-muted/40">/{total}</span>
      </div>
    </div>
  )
}

// ── VirusTotal result card ────────────────────────────────────────────────────

function VTCard({ result }: { result: NonNullable<LookupResult['virustotal']> }) {
  const [expanded, setExpanded] = useState(false)
  const { stats } = result

  const verdict =
    stats.malicious >= 5  ? { label: 'Malicious',  cls: 'text-severity-critical' } :
    stats.malicious >= 1  ? { label: 'Suspicious', cls: 'text-yellow-400' } :
    stats.suspicious >= 3 ? { label: 'Suspicious', cls: 'text-yellow-400' } :
                            { label: 'Clean',       cls: 'text-accent-green' }

  return (
    <div className="bg-bg-card border border-white/8 rounded-xl overflow-hidden">
      {/* Header */}
      <div className="flex items-center gap-3 px-4 py-3 border-b border-white/5 bg-bg-secondary/30">
        <div className="w-7 h-7 rounded-lg bg-blue-500/10 flex items-center justify-center">
          <Shield size={14} className="text-blue-400" />
        </div>
        <span className="text-sm font-semibold text-white">VirusTotal</span>
        <a
          href={result.link}
          target="_blank"
          rel="noopener noreferrer"
          className="ml-auto flex items-center gap-1 text-[10px] text-accent-green/50 hover:text-accent-green transition-colors"
        >
          <ExternalLink size={10} /> View on VT
        </a>
      </div>

      <div className="p-4">
        {/* Score + verdict */}
        <div className="flex items-center gap-4 mb-4">
          <VTScoreRing malicious={stats.malicious} total={stats.total} />

          <div className="flex-1 min-w-0">
            <p className={`text-lg font-bold ${verdict.cls}`}>{verdict.label}</p>
            <p className="text-[11px] text-accent-muted/50 mt-0.5">
              {stats.malicious} malicious · {stats.suspicious} suspicious · {stats.harmless} harmless
            </p>
            {result.reputation !== null && (
              <p className="text-[10px] text-accent-muted/40 mt-1">
                Reputation score: <span className={result.reputation < 0 ? 'text-severity-critical' : 'text-accent-green'}>{result.reputation}</span>
              </p>
            )}
          </div>
        </div>

        {/* Meta grid */}
        <div className="grid grid-cols-2 gap-2 text-[11px]">
          {result.country && (
            <div className="bg-bg-secondary/50 rounded px-2.5 py-1.5">
              <p className="text-accent-muted/40 text-[9px] uppercase tracking-wider mb-0.5">Country</p>
              <p className="text-white/80 font-mono">{result.country}</p>
            </div>
          )}
          {result.as_owner && (
            <div className="bg-bg-secondary/50 rounded px-2.5 py-1.5 col-span-1">
              <p className="text-accent-muted/40 text-[9px] uppercase tracking-wider mb-0.5">AS Owner</p>
              <p className="text-white/80 truncate" title={result.as_owner}>{result.as_owner}</p>
            </div>
          )}
          {result.network && (
            <div className="bg-bg-secondary/50 rounded px-2.5 py-1.5">
              <p className="text-accent-muted/40 text-[9px] uppercase tracking-wider mb-0.5">Network</p>
              <p className="text-white/80 font-mono">{result.network}</p>
            </div>
          )}
          {result.meaningful_name && (
            <div className="bg-bg-secondary/50 rounded px-2.5 py-1.5">
              <p className="text-accent-muted/40 text-[9px] uppercase tracking-wider mb-0.5">Name</p>
              <p className="text-white/80 font-mono truncate" title={result.meaningful_name}>{result.meaningful_name}</p>
            </div>
          )}
          {result.type_description && (
            <div className="bg-bg-secondary/50 rounded px-2.5 py-1.5">
              <p className="text-accent-muted/40 text-[9px] uppercase tracking-wider mb-0.5">Type</p>
              <p className="text-white/80">{result.type_description}</p>
            </div>
          )}
          {result.size != null && (
            <div className="bg-bg-secondary/50 rounded px-2.5 py-1.5">
              <p className="text-accent-muted/40 text-[9px] uppercase tracking-wider mb-0.5">Size</p>
              <p className="text-white/80 font-mono">{(result.size / 1024).toFixed(1)} KB</p>
            </div>
          )}
        </div>

        {/* Categories / tags */}
        {(result.categories.length > 0 || result.tags.length > 0) && (
          <div className="mt-3">
            <button
              onClick={() => setExpanded(v => !v)}
              className="flex items-center gap-1 text-[10px] text-accent-muted/40 hover:text-white transition-colors"
            >
              {expanded ? <ChevronUp size={11} /> : <ChevronDown size={11} />}
              Categories & tags ({result.categories.length + result.tags.length})
            </button>
            {expanded && (
              <div className="mt-2 flex flex-wrap gap-1">
                {result.categories.map((c, i) => (
                  <span key={i} className="text-[9px] px-1.5 py-0.5 rounded bg-blue-500/8 border border-blue-500/15 text-blue-300/70">{c}</span>
                ))}
                {result.tags.map((t, i) => (
                  <span key={i} className="text-[9px] px-1.5 py-0.5 rounded bg-white/5 border border-white/8 text-white/40">{t}</span>
                ))}
              </div>
            )}
          </div>
        )}

        {result.last_analysis_date && (
          <div className="flex items-center gap-1.5 mt-3 text-[10px] text-accent-muted/30">
            <Clock size={10} />
            Last analysis: {new Date(Number(result.last_analysis_date) * 1000).toLocaleDateString()}
          </div>
        )}
      </div>
    </div>
  )
}

// ── AbuseIPDB result card ─────────────────────────────────────────────────────

function AbuseCard({ result }: { result: NonNullable<LookupResult['abuseipdb']> }) {
  const score = result.abuse_score
  const color =
    score >= 75 ? '#ef4444' :
    score >= 25 ? '#FFAF00' :
                  '#9FEF00'

  return (
    <div className="bg-bg-card border border-white/8 rounded-xl overflow-hidden">
      <div className="flex items-center gap-3 px-4 py-3 border-b border-white/5 bg-bg-secondary/30">
        <div className="w-7 h-7 rounded-lg bg-red-500/10 flex items-center justify-center">
          <AlertTriangle size={14} className="text-red-400" />
        </div>
        <span className="text-sm font-semibold text-white">AbuseIPDB</span>
        <a
          href={`https://www.abuseipdb.com/check/${result.isp ? '' : ''}`}
          target="_blank"
          rel="noopener noreferrer"
          className="ml-auto flex items-center gap-1 text-[10px] text-accent-green/50 hover:text-accent-green transition-colors"
        >
          <ExternalLink size={10} /> View report
        </a>
      </div>

      <div className="p-4">
        {/* Score */}
        <div className="flex items-center gap-4 mb-4">
          <div className="relative w-16 h-16 shrink-0">
            <svg width="64" height="64" className="-rotate-90">
              <circle cx="32" cy="32" r="22" fill="none" stroke="rgba(255,255,255,0.06)" strokeWidth="5" />
              <circle
                cx="32" cy="32" r="22"
                fill="none" stroke={color} strokeWidth="5"
                strokeDasharray={2 * Math.PI * 22}
                strokeDashoffset={2 * Math.PI * 22 * (1 - score / 100)}
                strokeLinecap="round"
                style={{ transition: 'stroke-dashoffset 0.4s ease' }}
              />
            </svg>
            <div className="absolute inset-0 flex flex-col items-center justify-center">
              <span className="text-sm font-bold leading-none" style={{ color }}>{score}</span>
              <span className="text-[8px] text-accent-muted/40">%</span>
            </div>
          </div>

          <div>
            <p className="font-bold text-lg" style={{ color }}>
              {score >= 75 ? 'High Risk' : score >= 25 ? 'Suspicious' : 'Low Risk'}
            </p>
            <p className="text-[11px] text-accent-muted/50 mt-0.5">
              {result.total_reports} report{result.total_reports !== 1 ? 's' : ''} · {result.num_distinct_users} reporter{result.num_distinct_users !== 1 ? 's' : ''}
            </p>
          </div>
        </div>

        {/* Meta grid */}
        <div className="grid grid-cols-2 gap-2 text-[11px]">
          {result.country_code && (
            <div className="bg-bg-secondary/50 rounded px-2.5 py-1.5">
              <p className="text-accent-muted/40 text-[9px] uppercase tracking-wider mb-0.5">Country</p>
              <p className="text-white/80 font-mono">{result.country_code}</p>
            </div>
          )}
          {result.isp && (
            <div className="bg-bg-secondary/50 rounded px-2.5 py-1.5">
              <p className="text-accent-muted/40 text-[9px] uppercase tracking-wider mb-0.5">ISP</p>
              <p className="text-white/80 truncate" title={result.isp}>{result.isp}</p>
            </div>
          )}
          {result.domain && (
            <div className="bg-bg-secondary/50 rounded px-2.5 py-1.5">
              <p className="text-accent-muted/40 text-[9px] uppercase tracking-wider mb-0.5">Domain</p>
              <p className="text-white/80 font-mono">{result.domain}</p>
            </div>
          )}
          {result.usage_type && (
            <div className="bg-bg-secondary/50 rounded px-2.5 py-1.5">
              <p className="text-accent-muted/40 text-[9px] uppercase tracking-wider mb-0.5">Usage</p>
              <p className="text-white/80">{result.usage_type}</p>
            </div>
          )}
        </div>

        {/* Flags */}
        <div className="flex flex-wrap gap-1.5 mt-3">
          {result.is_tor && (
            <span className="text-[9px] px-1.5 py-0.5 rounded border bg-severity-critical/10 border-severity-critical/25 text-severity-critical">
              TOR exit node
            </span>
          )}
          {result.is_whitelisted && (
            <span className="text-[9px] px-1.5 py-0.5 rounded border bg-accent-green/10 border-accent-green/25 text-accent-green">
              Whitelisted
            </span>
          )}
          {!result.is_public && (
            <span className="text-[9px] px-1.5 py-0.5 rounded border bg-white/5 border-white/10 text-white/40">
              Private IP
            </span>
          )}
        </div>
      </div>
    </div>
  )
}

// ── Add to case IOC ───────────────────────────────────────────────────────────

function AddToCase({ result }: { result: LookupResult }) {
  const qc = useQueryClient()
  const { currentCase } = useCurrentCase()
  const [added, setAdded] = useState(false)

  const add = useMutation({
    mutationFn: () => iocsApi.create(currentCase!.id, {
      type:        ctiTypeToIocType(result.detected_type) as any,
      value:       result.value,
      description: buildIocDescription(result),
      tags:        'cti',
      confidence:  result.virustotal?.stats.malicious ? 'high' : 'medium',
      tlp:         'amber',
    }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['iocs', currentCase!.id] })
      setAdded(true)
    },
  })

  if (!currentCase) return null

  return (
    <div className="flex items-center gap-2 p-4 bg-bg-card border border-white/8 rounded-xl">
      <Info size={13} className="text-accent-muted/40 shrink-0" />
      <span className="text-[11px] text-accent-muted/50 flex-1">
        Current case: <span className="text-white/60">{currentCase.title}</span>
      </span>
      {added ? (
        <span className="flex items-center gap-1 text-[11px] text-accent-green">
          <CheckCircle2 size={12} /> Added to IOCs
        </span>
      ) : (
        <button
          onClick={() => add.mutate()}
          disabled={add.isPending}
          className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-accent-green/30 text-accent-green text-[11px] hover:bg-accent-green/10 transition-colors disabled:opacity-40"
        >
          {add.isPending ? <Loader2 size={11} className="animate-spin" /> : <Plus size={11} />}
          Add to case IOCs
        </button>
      )}
    </div>
  )
}

function buildIocDescription(r: LookupResult): string {
  const lines: string[] = ['[CTI Lookup]']
  const vt = r.virustotal
  if (vt) {
    lines.push(`VT: ${vt.stats.malicious}/${vt.stats.total} engines detected`)
    if (vt.country)  lines.push(`Country: ${vt.country}`)
    if (vt.as_owner) lines.push(`AS: ${vt.as_owner}`)
  }
  const abuse = r.abuseipdb
  if (abuse) {
    lines.push(`AbuseIPDB score: ${abuse.abuse_score}% (${abuse.total_reports} reports)`)
    if (abuse.isp) lines.push(`ISP: ${abuse.isp}`)
  }
  return lines.join('\n')
}

// ── Search history chip ───────────────────────────────────────────────────────

interface HistoryItem {
  value: string
  type:  string
  at:    number
}

// ── Main page ─────────────────────────────────────────────────────────────────

export default function CTILookup() {
  const [input,   setInput]   = useState('')
  const [history, setHistory] = useState<HistoryItem[]>([])
  const [result,  setResult]  = useState<LookupResult | null>(null)
  const inputRef = useRef<HTMLInputElement>(null)

  const lookup = useMutation({
    mutationFn: (value: string) =>
      ctiApi.lookup({ value: value.trim(), type_hint: detectTypeHint(value.trim()) }),
    onSuccess: (data) => {
      setResult(data)
      setHistory(prev => {
        const item: HistoryItem = { value: data.value, type: data.detected_type, at: Date.now() }
        return [item, ...prev.filter(h => h.value !== data.value)].slice(0, 10)
      })
    },
  })

  function submit(value: string) {
    if (!value.trim()) return
    setInput(value)
    lookup.mutate(value)
  }

  const handleKey = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter') submit(input)
  }

  // A VT not_found result still counts as "has result" (we show the not-found card)
  const hasResults = result && (result.virustotal || result.abuseipdb)
  const hasErrors  = result && Object.keys(result.errors).length > 0

  return (
    <div className="flex flex-col h-full overflow-hidden">

      {/* ── Search bar ─────────────────────────────────────────────────── */}
      <div className="px-6 pt-6 pb-4 border-b border-white/5 bg-bg-secondary/20 shrink-0">
        <div className="flex items-center gap-2 mb-3">
          <Shield size={16} className="text-accent-green" />
          <h1 className="text-sm font-semibold text-white tracking-wide">CTI Lookup</h1>
        </div>

        <div className="flex gap-2">
          <div className="relative flex-1">
            <Search size={14} className="absolute left-3.5 top-1/2 -translate-y-1/2 text-accent-muted/40 pointer-events-none" />
            <input
              ref={inputRef}
              type="text"
              value={input}
              onChange={e => setInput(e.target.value)}
              onKeyDown={handleKey}
              placeholder="IP address, domain, MD5/SHA1/SHA256 hash, or URL…"
              className="w-full pl-10 pr-4 py-2.5 bg-bg-secondary border border-white/10 rounded-xl text-sm text-white placeholder:text-accent-muted/30 focus:outline-none focus:border-accent-green/40 transition-colors font-mono"
              autoFocus
              spellCheck={false}
              autoComplete="off"
            />
          </div>
          <button
            onClick={() => submit(input)}
            disabled={lookup.isPending || !input.trim()}
            className="px-5 py-2.5 rounded-xl bg-accent-green/15 border border-accent-green/30 text-accent-green text-sm font-semibold hover:bg-accent-green/25 transition-colors disabled:opacity-40 flex items-center gap-2"
          >
            {lookup.isPending ? <Loader2 size={14} className="animate-spin" /> : <Search size={14} />}
            Lookup
          </button>
        </div>

        {/* Type hint chips */}
        <div className="flex items-center gap-1.5 mt-2.5 flex-wrap">
          <span className="text-[9px] text-accent-muted/30 mr-1">Supported:</span>
          {(['ip', 'domain', 'hash', 'url'] as const).map(t => (
            <span key={t} className="text-[9px] font-mono px-1.5 py-0.5 rounded border border-white/8 text-accent-muted/40">
              {t}
            </span>
          ))}
        </div>
      </div>

      <div className="flex flex-1 overflow-hidden">

        {/* ── Left: history ───────────────────────────────────────────── */}
        {history.length > 0 && (
          <div className="w-52 shrink-0 border-r border-white/5 bg-bg-secondary/10 flex flex-col overflow-hidden">
            <p className="px-3 py-2.5 text-[9px] font-semibold tracking-widest uppercase text-accent-muted/30 border-b border-white/5 shrink-0">
              Recent
            </p>
            <div className="flex-1 overflow-y-auto">
              {history.map((h, i) => (
                <button
                  key={i}
                  onClick={() => submit(h.value)}
                  className={`w-full text-left px-3 py-2 border-b border-white/[0.03] transition-colors hover:bg-white/[0.03] ${
                    result?.value === h.value ? 'bg-accent-green/5' : ''
                  }`}
                >
                  <div className="flex items-center gap-1.5 min-w-0">
                    {typeIcon(h.type)}
                    <span className="text-[10px] font-mono text-white/60 truncate flex-1" title={h.value}>
                      {h.value}
                    </span>
                  </div>
                  <div className="flex items-center gap-1 mt-0.5">
                    {typeBadge(h.type)}
                  </div>
                </button>
              ))}
            </div>
          </div>
        )}

        {/* ── Right: results ───────────────────────────────────────────── */}
        <div className="flex-1 overflow-y-auto">
          {lookup.isPending && (
            <div className="flex flex-col items-center justify-center h-64 gap-3">
              <Loader2 size={24} className="animate-spin text-accent-green/50" />
              <p className="text-sm text-accent-muted/40">Querying threat intelligence…</p>
            </div>
          )}

          {lookup.isError && !lookup.isPending && (
            <div className="m-6 flex items-start gap-3 p-4 rounded-xl bg-severity-critical/5 border border-severity-critical/20">
              <XCircle size={16} className="text-severity-critical shrink-0 mt-0.5" />
              <div>
                <p className="text-sm font-medium text-severity-critical">Lookup failed</p>
                <p className="text-[11px] text-severity-critical/70 mt-0.5">
                  {(lookup.error as any)?.response?.data?.detail ?? (lookup.error as Error)?.message ?? 'Unknown error'}
                </p>
              </div>
            </div>
          )}

          {result && !lookup.isPending && (
            <div className="p-6 space-y-4 max-w-3xl">

              {/* Result header */}
              <div className="flex items-center gap-3 flex-wrap">
                {typeIcon(result.detected_type)}
                <span className="font-mono text-white/80 text-sm break-all">{result.value}</span>
                {typeBadge(result.detected_type)}
              </div>

              {/* Connector errors — prominent banner */}
              {hasErrors && (
                <div className="space-y-2">
                  {Object.entries(result.errors).map(([src, msg]) => (
                    <div key={src} className="flex items-start gap-3 px-4 py-3 rounded-xl bg-severity-critical/5 border border-severity-critical/20 text-[12px]">
                      <XCircle size={14} className="text-severity-critical shrink-0 mt-0.5" />
                      <div>
                        <p className="font-semibold text-severity-critical capitalize">{src} error</p>
                        <p className="text-severity-critical/70 mt-0.5">{msg}</p>
                      </div>
                    </div>
                  ))}
                </div>
              )}

              {/* Add to case */}
              <AddToCase result={result} />

              {/* No results at all (no VT, no AbuseIPDB, no errors) */}
              {!hasResults && !hasErrors && (
                <div className="flex items-center gap-2 px-4 py-3 rounded-xl bg-bg-card border border-white/8 text-[12px] text-accent-muted/50">
                  <Info size={14} className="shrink-0" />
                  No results — no CTI connectors returned data for this indicator.
                </div>
              )}

              {/* Result cards */}
              {result.virustotal && (
                result.virustotal.not_found
                  ? <VTNotFoundCard link={result.virustotal.link} />
                  : <VTCard result={result.virustotal} />
              )}
              {result.abuseipdb  && <AbuseCard result={result.abuseipdb} />}
            </div>
          )}

          {!result && !lookup.isPending && !lookup.isError && (
            <div className="flex flex-col items-center justify-center h-full gap-4 text-center px-6">
              <div className="text-5xl opacity-10">🛡️</div>
              <div>
                <p className="text-sm text-accent-muted/40">Enter an indicator above to start</p>
                <p className="text-xs text-accent-muted/25 mt-1">
                  Queries VirusTotal and AbuseIPDB in parallel using your configured API keys
                </p>
              </div>
              {history.length === 0 && (
                <div className="text-[10px] text-accent-muted/25 space-y-1 mt-2">
                  <p className="font-mono">8.8.8.8</p>
                  <p className="font-mono">evil.example.com</p>
                  <p className="font-mono">d41d8cd98f00b204e9800998ecf8427e</p>
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
