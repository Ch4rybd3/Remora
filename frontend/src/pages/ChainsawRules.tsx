import { useState, useEffect, useRef, useCallback } from 'react'
import {
  Swords, Search, Upload, Trash2, CheckCircle2, Loader2,
  Download, Info, ShieldCheck, AlertCircle,
} from 'lucide-react'
import { chainsawRulesApi, type RuleInfo, type SigmaStatus } from '../api/chainsaw'

// ── Level badge ───────────────────────────────────────────────────────────────

function LevelBadge({ level }: { level: string }) {
  const l = level.toLowerCase()
  const cls =
    l === 'critical'                       ? 'bg-red-500/15 text-red-400 border-red-500/25' :
    l === 'high'                           ? 'bg-orange-500/15 text-orange-400 border-orange-500/25' :
    l === 'medium'                         ? 'bg-yellow-500/15 text-yellow-400 border-yellow-500/25' :
    l === 'low'                            ? 'bg-blue-500/15 text-blue-400 border-blue-500/25' :
    /* informational / info / empty */       'bg-white/5 text-accent-muted border-white/10'

  return (
    <span className={`text-[10px] font-mono font-semibold px-1.5 py-0.5 rounded border uppercase tracking-wide ${cls}`}>
      {level || 'info'}
    </span>
  )
}

// ── Rules table ───────────────────────────────────────────────────────────────

interface RulesTableProps {
  rules: RuleInfo[]
  onDelete?: (filename: string) => void
  deletingFilename?: string | null
}

function RulesTable({ rules, onDelete, deletingFilename }: RulesTableProps) {
  if (rules.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center py-16 text-accent-muted/50">
        <Swords size={32} className="mb-3 opacity-30" />
        <p className="text-sm">No rules found</p>
      </div>
    )
  }

  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b border-white/5 text-left">
            <th className="px-4 py-2.5 text-[11px] font-semibold text-accent-muted/60 uppercase tracking-wider">Title</th>
            <th className="px-4 py-2.5 text-[11px] font-semibold text-accent-muted/60 uppercase tracking-wider">Group</th>
            <th className="px-4 py-2.5 text-[11px] font-semibold text-accent-muted/60 uppercase tracking-wider">Level</th>
            <th className="px-4 py-2.5 text-[11px] font-semibold text-accent-muted/60 uppercase tracking-wider">Status</th>
            <th className="px-4 py-2.5 text-[11px] font-semibold text-accent-muted/60 uppercase tracking-wider">Description</th>
            {onDelete && (
              <th className="px-4 py-2.5 text-[11px] font-semibold text-accent-muted/60 uppercase tracking-wider w-12" />
            )}
          </tr>
        </thead>
        <tbody className="divide-y divide-white/3">
          {rules.map(rule => (
            <tr key={rule.path} className="hover:bg-white/3 transition-colors">
              <td className="px-4 py-3 text-white text-xs font-medium max-w-[220px] truncate" title={rule.title}>
                {rule.title}
              </td>
              <td className="px-4 py-3 text-accent-muted text-xs max-w-[160px] truncate" title={rule.group}>
                {rule.group || <span className="opacity-30">—</span>}
              </td>
              <td className="px-4 py-3">
                <LevelBadge level={rule.level} />
              </td>
              <td className="px-4 py-3 text-accent-muted text-xs">
                {rule.status || <span className="opacity-30">—</span>}
              </td>
              <td className="px-4 py-3 text-accent-muted/70 text-xs max-w-[300px] truncate" title={rule.description}>
                {rule.description || <span className="opacity-30">No description</span>}
              </td>
              {onDelete && (
                <td className="px-4 py-3 text-right">
                  <button
                    onClick={() => onDelete(rule.filename)}
                    disabled={deletingFilename === rule.filename}
                    className="p-1.5 rounded hover:bg-red-500/10 text-accent-muted/40 hover:text-red-400 transition-colors disabled:opacity-40"
                    title="Delete rule"
                  >
                    {deletingFilename === rule.filename
                      ? <Loader2 size={13} className="animate-spin" />
                      : <Trash2 size={13} />
                    }
                  </button>
                </td>
              )}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

// ── Built-in tab ──────────────────────────────────────────────────────────────

function BuiltinTab() {
  const [rules, setRules]     = useState<RuleInfo[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError]     = useState<string | null>(null)
  const [search, setSearch]   = useState('')

  useEffect(() => {
    setLoading(true)
    chainsawRulesApi.listBuiltin()
      .then(setRules)
      .catch(e => setError(e?.response?.data?.detail || 'Failed to load rules'))
      .finally(() => setLoading(false))
  }, [])

  const filtered = rules.filter(r => {
    const q = search.toLowerCase()
    return !q || r.title.toLowerCase().includes(q) || r.group.toLowerCase().includes(q)
  })

  return (
    <div className="space-y-4">
      {/* Search + count bar */}
      <div className="flex items-center gap-3">
        <div className="relative flex-1 max-w-sm">
          <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-accent-muted/40" />
          <input
            value={search}
            onChange={e => setSearch(e.target.value)}
            placeholder="Filter by title or group…"
            className="w-full pl-9 pr-3 py-2 text-sm bg-bg-primary border border-white/5 rounded-lg text-white placeholder:text-accent-muted/30 focus:outline-none focus:border-accent-green/30"
          />
        </div>
        {!loading && (
          <span className="text-xs text-accent-muted/50 shrink-0">
            {filtered.length} rule{filtered.length !== 1 ? 's' : ''}
          </span>
        )}
      </div>

      {/* Content */}
      <div className="bg-bg-secondary border border-white/5 rounded-xl overflow-hidden">
        {loading ? (
          <div className="flex items-center justify-center py-16 gap-2 text-accent-muted/50">
            <Loader2 size={18} className="animate-spin" />
            <span className="text-sm">Loading rules…</span>
          </div>
        ) : error ? (
          <div className="flex items-center justify-center py-16 gap-2 text-red-400/70">
            <AlertCircle size={18} />
            <span className="text-sm">{error}</span>
          </div>
        ) : (
          <RulesTable rules={filtered} />
        )}
      </div>

      <p className="text-xs text-accent-muted/40 flex items-center gap-1.5">
        <Info size={11} />
        Built-in rules are read-only Chainsaw native EVTX detection rules bundled with the application.
      </p>
    </div>
  )
}

// ── Custom tab ────────────────────────────────────────────────────────────────

function CustomTab() {
  const [rules, setRules]           = useState<RuleInfo[]>([])
  const [loading, setLoading]       = useState(true)
  const [uploading, setUploading]   = useState(false)
  const [deleting, setDeleting]     = useState<string | null>(null)
  const [error, setError]           = useState<string | null>(null)
  const [dragOver, setDragOver]     = useState(false)
  const fileInputRef                = useRef<HTMLInputElement>(null)

  const fetchRules = useCallback(() => {
    setLoading(true)
    chainsawRulesApi.listCustom()
      .then(setRules)
      .catch(e => setError(e?.response?.data?.detail || 'Failed to load custom rules'))
      .finally(() => setLoading(false))
  }, [])

  useEffect(() => { fetchRules() }, [fetchRules])

  const handleFiles = useCallback(async (files: File[]) => {
    const valid = files.filter(f => f.name.match(/\.(yml|yaml)$/i))
    if (valid.length === 0) {
      setError('Only .yml and .yaml files are accepted.')
      return
    }
    setUploading(true)
    setError(null)
    try {
      await chainsawRulesApi.uploadCustom(valid)
      fetchRules()
    } catch (e: any) {
      setError(e?.response?.data?.detail || 'Upload failed')
    } finally {
      setUploading(false)
    }
  }, [fetchRules])

  const handleDelete = useCallback(async (filename: string) => {
    setDeleting(filename)
    setError(null)
    try {
      await chainsawRulesApi.deleteCustom(filename)
      setRules(prev => prev.filter(r => r.filename !== filename))
    } catch (e: any) {
      setError(e?.response?.data?.detail || 'Delete failed')
    } finally {
      setDeleting(null)
    }
  }, [])

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault()
    setDragOver(false)
    const files = Array.from(e.dataTransfer.files)
    handleFiles(files)
  }, [handleFiles])

  return (
    <div className="space-y-4">
      {/* Upload zone */}
      <div
        onDragOver={e => { e.preventDefault(); setDragOver(true) }}
        onDragLeave={() => setDragOver(false)}
        onDrop={handleDrop}
        onClick={() => fileInputRef.current?.click()}
        className={`border-2 border-dashed rounded-xl p-8 text-center cursor-pointer transition-colors ${
          dragOver
            ? 'border-accent-green/50 bg-accent-green/5'
            : 'border-white/10 hover:border-white/20 hover:bg-white/3'
        }`}
      >
        <input
          ref={fileInputRef}
          type="file"
          accept=".yml,.yaml"
          multiple
          className="hidden"
          onChange={e => {
            const files = Array.from(e.target.files || [])
            if (files.length) handleFiles(files)
            e.target.value = ''
          }}
        />
        {uploading ? (
          <div className="flex flex-col items-center gap-2 text-accent-muted/60">
            <Loader2 size={24} className="animate-spin text-accent-green" />
            <p className="text-sm">Uploading…</p>
          </div>
        ) : (
          <div className="flex flex-col items-center gap-2 text-accent-muted/50">
            <Upload size={24} className={dragOver ? 'text-accent-green' : ''} />
            <p className="text-sm font-medium text-white/70">
              Drag &amp; drop rule files here, or click to browse
            </p>
            <p className="text-xs">Accepts .yml and .yaml files</p>
          </div>
        )}
      </div>

      {error && (
        <div className="flex items-center gap-2 px-3 py-2 bg-red-500/10 border border-red-500/20 rounded-lg text-red-400 text-sm">
          <AlertCircle size={14} />
          {error}
        </div>
      )}

      {/* Rules list */}
      <div className="bg-bg-secondary border border-white/5 rounded-xl overflow-hidden">
        {loading ? (
          <div className="flex items-center justify-center py-16 gap-2 text-accent-muted/50">
            <Loader2 size={18} className="animate-spin" />
            <span className="text-sm">Loading…</span>
          </div>
        ) : rules.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-16 gap-2 text-accent-muted/40">
            <Swords size={28} className="opacity-30" />
            <p className="text-sm">No custom rules yet</p>
            <p className="text-xs text-accent-muted/30">Upload .yml rule files to get started</p>
          </div>
        ) : (
          <RulesTable rules={rules} onDelete={handleDelete} deletingFilename={deleting} />
        )}
      </div>

      <p className="text-xs text-accent-muted/40 flex items-center gap-1.5">
        <Info size={11} />
        Custom rules are included alongside built-in rules in all scans. Use Chainsaw native EVTX format (kind: evtx).
      </p>
    </div>
  )
}

// ── SigmaHQ tab ───────────────────────────────────────────────────────────────

function SigmaTab() {
  const [status, setStatus]         = useState<SigmaStatus | null>(null)
  const [loading, setLoading]       = useState(true)
  const [downloading, setDownloading] = useState(false)
  const [error, setError]           = useState<string | null>(null)
  const [message, setMessage]       = useState<string | null>(null)

  const fetchStatus = useCallback(() => {
    setLoading(true)
    chainsawRulesApi.sigmaStatus()
      .then(setStatus)
      .catch(e => setError(e?.response?.data?.detail || 'Failed to fetch status'))
      .finally(() => setLoading(false))
  }, [])

  useEffect(() => { fetchStatus() }, [fetchStatus])

  const handleDownload = useCallback(async () => {
    setDownloading(true)
    setError(null)
    setMessage(null)
    try {
      const res = await chainsawRulesApi.sigmaDownload()
      setMessage(res.message)
      // Poll for completion every 5 seconds up to 5 minutes
      let attempts = 0
      const poll = setInterval(async () => {
        attempts++
        try {
          const s = await chainsawRulesApi.sigmaStatus()
          setStatus(s)
          if (s.installed || attempts > 60) {
            clearInterval(poll)
            setDownloading(false)
          }
        } catch {
          if (attempts > 60) {
            clearInterval(poll)
            setDownloading(false)
          }
        }
      }, 5000)
    } catch (e: any) {
      setError(e?.response?.data?.detail || 'Download failed')
      setDownloading(false)
    }
  }, [])

  return (
    <div className="space-y-4">
      {/* Status card */}
      <div className="bg-bg-secondary border border-white/5 rounded-xl p-6">
        {loading ? (
          <div className="flex items-center gap-2 text-accent-muted/50">
            <Loader2 size={18} className="animate-spin" />
            <span className="text-sm">Checking status…</span>
          </div>
        ) : error ? (
          <div className="flex items-center gap-2 text-red-400 text-sm">
            <AlertCircle size={16} />
            {error}
          </div>
        ) : status ? (
          <div className="space-y-4">
            {/* Status indicator */}
            <div className="flex items-center gap-3">
              {status.installed ? (
                <CheckCircle2 size={20} className="text-accent-green shrink-0" />
              ) : (
                <AlertCircle size={20} className="text-accent-muted/40 shrink-0" />
              )}
              <div>
                <p className="text-sm font-medium text-white">
                  {status.installed ? 'SigmaHQ Windows Rules Installed' : 'SigmaHQ Rules Not Installed'}
                </p>
                {status.installed && (
                  <p className="text-xs text-accent-muted/60 mt-0.5">
                    {status.rule_count.toLocaleString()} rule{status.rule_count !== 1 ? 's' : ''} available
                  </p>
                )}
              </div>
            </div>

            {/* Download / Re-download button */}
            {downloading ? (
              <div className="flex items-center gap-3 px-4 py-3 bg-accent-green/5 border border-accent-green/15 rounded-lg">
                <Loader2 size={16} className="animate-spin text-accent-green shrink-0" />
                <div>
                  <p className="text-sm text-accent-green font-medium">Downloading from GitHub…</p>
                  {message && <p className="text-xs text-accent-muted/60 mt-0.5">{message}</p>}
                </div>
              </div>
            ) : (
              <button
                onClick={handleDownload}
                className={`flex items-center gap-2 px-4 py-2.5 rounded-lg text-sm font-medium transition-colors border ${
                  status.installed
                    ? 'bg-white/5 hover:bg-white/8 text-accent-muted hover:text-white border-white/10'
                    : 'bg-accent-green/10 hover:bg-accent-green/20 text-accent-green border-accent-green/30'
                }`}
              >
                <Download size={15} />
                {status.installed ? 'Re-download SigmaHQ Rules' : 'Download SigmaHQ Windows Rules'}
              </button>
            )}
          </div>
        ) : null}
      </div>

      {/* Info section */}
      <div className="bg-bg-secondary border border-white/5 rounded-xl p-5 space-y-3">
        <div className="flex items-center gap-2 text-accent-green">
          <ShieldCheck size={16} />
          <p className="text-sm font-semibold">About SigmaHQ Rules</p>
        </div>
        <div className="space-y-2 text-xs text-accent-muted/70 leading-relaxed">
          <p>
            SigmaHQ is an open-source collection of generic signatures for SIEM systems. The Windows ruleset
            covers common attack techniques mapped to the MITRE ATT&CK framework.
          </p>
          <p>
            Rules are downloaded from the official SigmaHQ GitHub repository
            (<span className="font-mono text-accent-muted">SigmaHQ/sigma</span>) and cover Windows event
            logs across categories such as process creation, network connections, registry changes, and more.
          </p>
          <p className="flex items-start gap-1.5">
            <Info size={11} className="mt-0.5 shrink-0 text-accent-green/60" />
            SigmaHQ rules are used <span className="text-white/80 font-medium">alongside built-in rules</span> in
            all Chainsaw scans automatically, provided the mapping file is present.
          </p>
        </div>
      </div>
    </div>
  )
}

// ── Page ──────────────────────────────────────────────────────────────────────

type Tab = 'builtin' | 'custom' | 'sigma'

export default function ChainsawRules() {
  const [tab, setTab] = useState<Tab>('builtin')

  const tabs: { key: Tab; label: string }[] = [
    { key: 'builtin', label: 'Built-in' },
    { key: 'custom',  label: 'Custom'   },
    { key: 'sigma',   label: 'SigmaHQ'  },
  ]

  return (
    <div className="flex-1 flex flex-col min-h-0 bg-bg-primary">
      {/* Page header */}
      <div className="px-8 pt-8 pb-6 border-b border-white/5">
        <div className="flex items-center gap-3">
          <div className="w-9 h-9 rounded-lg bg-accent-green/10 border border-accent-green/20 flex items-center justify-center">
            <Swords size={18} className="text-accent-green" />
          </div>
          <div>
            <h1 className="text-xl font-bold text-white tracking-tight">Detection Rules</h1>
            <p className="text-xs text-accent-muted/60 mt-0.5">
              Manage Chainsaw built-in, custom, and SigmaHQ detection rules
            </p>
          </div>
        </div>

        {/* Tabs */}
        <div className="flex gap-1 mt-5">
          {tabs.map(t => (
            <button
              key={t.key}
              onClick={() => setTab(t.key)}
              className={`px-4 py-2 text-sm font-medium rounded-t-lg border-b-2 transition-colors ${
                tab === t.key
                  ? 'bg-accent-green/10 text-accent-green border-accent-green'
                  : 'text-accent-muted/60 border-transparent hover:text-white hover:bg-white/5'
              }`}
            >
              {t.label}
            </button>
          ))}
        </div>
      </div>

      {/* Tab content */}
      <div className="flex-1 overflow-y-auto px-8 py-6">
        {tab === 'builtin' && <BuiltinTab />}
        {tab === 'custom'  && <CustomTab />}
        {tab === 'sigma'   && <SigmaTab />}
      </div>
    </div>
  )
}
