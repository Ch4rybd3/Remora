import { useState, useEffect, useRef, useCallback } from 'react'
import {
  Swords, Search, Upload, Trash2, CheckCircle2, Loader2,
  Download, Info, ShieldCheck, AlertCircle,
} from '../ui/icons'
import { chainsawRulesApi, type RuleInfo, type SigmaStatus } from '../api/chainsaw'

// ── Level badge ───────────────────────────────────────────────────────────────

function LevelBadge({ level }: { level: string }) {
  const l = level.toLowerCase()
  const cls =
    l === 'critical'                       ? 'bg-severity-critical/15 text-severity-critical border-severity-critical/25' :
    l === 'high'                           ? 'bg-severity-high/15 text-severity-high border-severity-high/25' :
    l === 'medium'                         ? 'bg-severity-medium/15 text-severity-medium border-severity-medium/25' :
    l === 'low'                            ? 'bg-severity-low/15 text-severity-low border-severity-low/25' :
    /* informational / info / empty */       'bg-fg/5 text-fg-secondary border-hairline'

  return (
    <span className={`text-label font-mono font-semibold px-1.5 py-0.5 rounded-control border uppercase tracking-wide ${cls}`}>
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
      <div className="flex flex-col items-center justify-center py-16 text-fg-secondary/50">
        <Swords size={32} className="mb-3 opacity-30" />
        <p className="text-ui">No rules found</p>
      </div>
    )
  }

  return (
    <div className="overflow-x-auto">
      <table className="w-full text-ui">
        <thead>
          <tr className="border-b border-hairline text-left">
            <th className="px-4 py-2.5 text-label font-semibold text-fg-secondary/60 uppercase tracking-wider">Title</th>
            <th className="px-4 py-2.5 text-label font-semibold text-fg-secondary/60 uppercase tracking-wider">Group</th>
            <th className="px-4 py-2.5 text-label font-semibold text-fg-secondary/60 uppercase tracking-wider">Level</th>
            <th className="px-4 py-2.5 text-label font-semibold text-fg-secondary/60 uppercase tracking-wider">Status</th>
            <th className="px-4 py-2.5 text-label font-semibold text-fg-secondary/60 uppercase tracking-wider">Description</th>
            {onDelete && (
              <th className="px-4 py-2.5 text-label font-semibold text-fg-secondary/60 uppercase tracking-wider w-12" />
            )}
          </tr>
        </thead>
        <tbody className="divide-y divide-hairline">
          {rules.map(rule => (
            <tr key={rule.path} className="hover:bg-fg/3 transition-colors">
              <td className="px-4 py-3 text-fg text-label font-medium max-w-[220px] truncate" title={rule.title}>
                {rule.title}
              </td>
              <td className="px-4 py-3 text-fg-secondary text-label max-w-[160px] truncate" title={rule.group}>
                {rule.group || <span className="opacity-30">—</span>}
              </td>
              <td className="px-4 py-3">
                <LevelBadge level={rule.level} />
              </td>
              <td className="px-4 py-3 text-fg-secondary text-label">
                {rule.status || <span className="opacity-30">—</span>}
              </td>
              <td className="px-4 py-3 text-fg-secondary/70 text-label max-w-[300px] truncate" title={rule.description}>
                {rule.description || <span className="opacity-30">No description</span>}
              </td>
              {onDelete && (
                <td className="px-4 py-3 text-right">
                  <button
                    onClick={() => onDelete(rule.filename)}
                    disabled={deletingFilename === rule.filename}
                    className="p-1.5 rounded-control hover:bg-severity-critical/10 text-fg-secondary/40 hover:text-severity-critical transition-colors disabled:opacity-40"
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
          <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-fg-secondary/40" />
          <input
            value={search}
            onChange={e => setSearch(e.target.value)}
            placeholder="Filter by title or group…"
            className="w-full pl-9 pr-3 py-2 text-ui bg-canvas border border-hairline text-fg placeholder:text-fg-secondary/30 focus:outline-none focus:border-accent/30"
          />
        </div>
        {!loading && (
          <span className="text-label text-fg-secondary/50 shrink-0">
            {filtered.length} rule{filtered.length !== 1 ? 's' : ''}
          </span>
        )}
      </div>

      {/* Content */}
      <div className="bg-panel border border-hairline overflow-hidden">
        {loading ? (
          <div className="flex items-center justify-center py-16 gap-2 text-fg-secondary/50">
            <Loader2 size={18} className="animate-spin" />
            <span className="text-ui">Loading rules…</span>
          </div>
        ) : error ? (
          <div className="flex items-center justify-center py-16 gap-2 text-severity-critical/70">
            <AlertCircle size={18} />
            <span className="text-ui">{error}</span>
          </div>
        ) : (
          <RulesTable rules={filtered} />
        )}
      </div>

      <p className="text-label text-fg-secondary/40 flex items-center gap-1.5">
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
        className={`border-2 border-dashed p-8 text-center cursor-pointer transition-colors ${
          dragOver
            ? 'border-accent/50 bg-accent/5'
            : 'border-hairline hover:border-strong hover:bg-fg/3'
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
          <div className="flex flex-col items-center gap-2 text-fg-secondary/60">
            <Loader2 size={24} className="animate-spin text-accent" />
            <p className="text-ui">Uploading…</p>
          </div>
        ) : (
          <div className="flex flex-col items-center gap-2 text-fg-secondary/50">
            <Upload size={24} className={dragOver ? 'text-accent' : ''} />
            <p className="text-ui font-medium text-fg/70">
              Drag &amp; drop rule files here, or click to browse
            </p>
            <p className="text-label">Accepts .yml and .yaml files</p>
          </div>
        )}
      </div>

      {error && (
        <div className="flex items-center gap-2 px-3 py-2 bg-severity-critical/10 border border-severity-critical/20 text-severity-critical text-ui">
          <AlertCircle size={14} />
          {error}
        </div>
      )}

      {/* Rules list */}
      <div className="bg-panel border border-hairline overflow-hidden">
        {loading ? (
          <div className="flex items-center justify-center py-16 gap-2 text-fg-secondary/50">
            <Loader2 size={18} className="animate-spin" />
            <span className="text-ui">Loading…</span>
          </div>
        ) : rules.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-16 gap-2 text-fg-secondary/40">
            <Swords size={28} className="opacity-30" />
            <p className="text-ui">No custom rules yet</p>
            <p className="text-label text-fg-secondary/30">Upload .yml rule files to get started</p>
          </div>
        ) : (
          <RulesTable rules={rules} onDelete={handleDelete} deletingFilename={deleting} />
        )}
      </div>

      <p className="text-label text-fg-secondary/40 flex items-center gap-1.5">
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
      <div className="bg-panel border border-hairline p-6">
        {loading ? (
          <div className="flex items-center gap-2 text-fg-secondary/50">
            <Loader2 size={18} className="animate-spin" />
            <span className="text-ui">Checking status…</span>
          </div>
        ) : error ? (
          <div className="flex items-center gap-2 text-severity-critical text-ui">
            <AlertCircle size={16} />
            {error}
          </div>
        ) : status ? (
          <div className="space-y-4">
            {/* Status indicator */}
            <div className="flex items-center gap-3">
              {status.installed ? (
                <CheckCircle2 size={20} className="text-accent shrink-0" />
              ) : (
                <AlertCircle size={20} className="text-fg-secondary/40 shrink-0" />
              )}
              <div>
                <p className="text-ui font-medium text-fg">
                  {status.installed ? 'SigmaHQ Windows Rules Installed' : 'SigmaHQ Rules Not Installed'}
                </p>
                {status.installed && (
                  <p className="text-label text-fg-secondary/60 mt-0.5">
                    {status.rule_count.toLocaleString()} rule{status.rule_count !== 1 ? 's' : ''} available
                  </p>
                )}
              </div>
            </div>

            {/* Download / Re-download button */}
            {downloading ? (
              <div className="flex items-center gap-3 px-4 py-3 bg-accent/5 border border-accent/15 ">
                <Loader2 size={16} className="animate-spin text-accent shrink-0" />
                <div>
                  <p className="text-ui text-accent font-medium">Downloading from GitHub…</p>
                  {message && <p className="text-label text-fg-secondary/60 mt-0.5">{message}</p>}
                </div>
              </div>
            ) : (
              <button
                onClick={handleDownload}
                className={`flex items-center gap-2 px-4 py-2.5 text-ui font-medium transition-colors border ${
                  status.installed
                    ? 'bg-fg/5 hover:bg-fg/8 text-fg-secondary hover:text-fg border-hairline'
                    : 'bg-accent/10 hover:bg-accent/20 text-accent border-accent/30'
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
      <div className="bg-panel border border-hairline p-5 space-y-3">
        <div className="flex items-center gap-2 text-accent">
          <ShieldCheck size={16} />
          <p className="text-ui font-semibold">About SigmaHQ Rules</p>
        </div>
        <div className="space-y-2 text-label text-fg-secondary/70 leading-relaxed">
          <p>
            SigmaHQ is an open-source collection of generic signatures for SIEM systems. The Windows ruleset
            covers common attack techniques mapped to the MITRE ATT&CK framework.
          </p>
          <p>
            Rules are downloaded from the official SigmaHQ GitHub repository
            (<span className="font-mono text-fg-secondary">SigmaHQ/sigma</span>) and cover Windows event
            logs across categories such as process creation, network connections, registry changes, and more.
          </p>
          <p className="flex items-start gap-1.5">
            <Info size={11} className="mt-0.5 shrink-0 text-accent/60" />
            SigmaHQ rules are used <span className="text-fg/80 font-medium">alongside built-in rules</span> in
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
    <div className="flex-1 flex flex-col min-h-0 bg-canvas">
      {/* Page header */}
      <div className="px-8 pt-8 pb-6 border-b border-hairline">
        <div className="flex items-center gap-3">
          <div className="w-9 h-9 bg-accent/10 border border-accent/20 flex items-center justify-center">
            <Swords size={18} className="text-accent" />
          </div>
          <div>
            <h1 className="text-title font-bold text-fg tracking-tight">Detection Rules</h1>
            <p className="text-label text-fg-secondary/60 mt-0.5">
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
              className={`px-4 py-2 text-ui font-medium rounded-t-lg border-b-2 transition-colors ${ tab === t.key
                  ? 'bg-accent/10 text-accent border-accent'
                  : 'text-fg-secondary/60 border-transparent hover:text-fg hover:bg-fg/5'
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
