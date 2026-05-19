import { useRef, useState, useCallback, useMemo } from 'react'
import { useQuery } from '@tanstack/react-query'
import {
  Upload, Mail, Link2, Paperclip, ChevronDown, ChevronRight,
  CheckCircle2, AlertCircle, Copy, Plus, Loader2, Info, FileText,
  ShieldAlert, ShieldX, AlertTriangle,
} from 'lucide-react'
import { emailAnalysisApi, type EmailAnalysisResult, type HeaderItem, type AttachmentItem, type EmailWarning, type WarningLevel } from '../api/emailAnalysis'
import { iocsApi } from '../api/iocs'
import { useCurrentCase } from '../context/CurrentCaseContext'

// ── helpers ────────────────────────────────────────────────────────────────

function formatBytes(bytes: number) {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(2)} MB`
}

function copyToClipboard(text: string) {
  navigator.clipboard.writeText(text).catch(() => {})
}

function iocKey(type: string, value: string) {
  return `${type}:${value.trim()}`
}

function headerIocType(headerName: string): string | null {
  const n = headerName.toLowerCase()
  if (n === 'from' || n === 'reply-to' || n === 'return-path' || n === 'to' || n === 'cc') return 'email'
  if (n === 'x-originating-ip') return 'ip'
  if (n === 'user-agent' || n === 'x-mailer') return 'user_agent'
  return null
}

function extractIocValue(headerName: string, raw: string): string {
  const n = headerName.toLowerCase()
  if (['from', 'reply-to', 'return-path', 'to', 'cc'].includes(n)) {
    const match = raw.match(/[a-zA-Z0-9._%+\-]+@[a-zA-Z0-9.\-]+\.[a-zA-Z]{2,}/)
    return match ? match[0] : raw.trim()
  }
  if (n === 'x-originating-ip') {
    const match = raw.match(/[\d.:a-fA-F]+/)
    return match ? match[0] : raw.trim()
  }
  return raw.trim()
}

function extractEmailAddress(raw: string): string {
  const match = raw.match(/[a-zA-Z0-9._%+\-]+@[a-zA-Z0-9.\-]+\.[a-zA-Z]{2,}/)
  return match ? match[0] : raw.trim()
}

function extractSenderName(raw: string): string | null {
  const match = raw.match(/^"?([^"<]+?)"?\s*</)
  if (match) {
    const name = match[1].trim()
    return name.length > 0 ? name : null
  }
  return null
}

// ── Warnings ───────────────────────────────────────────────────────────────

const WARNING_STYLES: Record<WarningLevel, { bar: string; icon: string; badge: string }> = {
  critical: {
    bar:   'border-severity-critical/30 bg-severity-critical/8',
    icon:  'text-severity-critical',
    badge: 'bg-severity-critical/15 text-severity-critical border-severity-critical/30',
  },
  high: {
    bar:   'border-orange-500/30 bg-orange-500/8',
    icon:  'text-orange-400',
    badge: 'bg-orange-500/15 text-orange-400 border-orange-500/30',
  },
  medium: {
    bar:   'border-severity-medium/30 bg-severity-medium/8',
    icon:  'text-severity-medium',
    badge: 'bg-severity-medium/15 text-severity-medium border-severity-medium/30',
  },
  info: {
    bar:   'border-blue-500/30 bg-blue-500/8',
    icon:  'text-blue-400',
    badge: 'bg-blue-500/15 text-blue-400 border-blue-500/30',
  },
}

const WARNING_ICONS: Record<WarningLevel, React.ElementType> = {
  critical: ShieldX,
  high:     ShieldAlert,
  medium:   AlertTriangle,
  info:     Info,
}

function WarningBadge({ level }: { level: WarningLevel }) {
  const s = WARNING_STYLES[level]
  return (
    <span className={`text-[9px] font-bold uppercase tracking-wider px-1.5 py-0.5 rounded border ${s.badge}`}>
      {level}
    </span>
  )
}

function WarningsSection({ warnings }: { warnings: EmailWarning[] }) {
  if (warnings.length === 0) return null
  const order: WarningLevel[] = ['critical', 'high', 'medium', 'info']
  const sorted = [...warnings].sort((a, b) => order.indexOf(a.level) - order.indexOf(b.level))
  return (
    <div className="space-y-2">
      <p className="text-[10px] font-semibold tracking-widest uppercase text-accent-muted/50">
        Security Alerts ({warnings.length})
      </p>
      {sorted.map((w, i) => {
        const s    = WARNING_STYLES[w.level]
        const Icon = WARNING_ICONS[w.level]
        return (
          <div key={i} className={`flex items-start gap-3 rounded-lg border px-4 py-3 ${s.bar}`}>
            <Icon size={15} className={`shrink-0 mt-0.5 ${s.icon}`} />
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2 mb-0.5">
                <span className="text-sm font-semibold text-white">{w.title}</span>
                <WarningBadge level={w.level} />
              </div>
              <p className="text-[11px] text-white/60 leading-relaxed">{w.detail}</p>
            </div>
          </div>
        )
      })}
    </div>
  )
}

// ── IocButton ──────────────────────────────────────────────────────────────

function IocButton({
  caseId, caseTitle, type, value, description, label, addedKeys, onAdded,
}: {
  caseId?: string
  caseTitle?: string
  type: string
  value: string
  description?: string
  label?: string
  addedKeys: Set<string>
  onAdded: (type: string, value: string) => void
}) {
  const key = iocKey(type, value)
  const alreadyAdded = addedKeys.has(key)
  const [state, setState] = useState<'idle' | 'loading' | 'err'>('idle')

  const handleAdd = async () => {
    if (!caseId || alreadyAdded || state !== 'idle') return
    setState('loading')
    try {
      await iocsApi.create(caseId, {
        type: type as never,
        value,
        description: description ?? 'Extracted from email analysis',
        confidence: 'medium',
        tlp: 'TLP:AMBER',
      })
      onAdded(type, value)
    } catch {
      setState('err')
    } finally {
      setState('idle')
    }
  }

  if (!caseId) {
    return (
      <span
        title="Set a current case to export IOCs"
        className="inline-flex items-center gap-1 text-[10px] text-accent-muted/30 cursor-not-allowed select-none"
      >
        <Plus size={10} /> {label ?? 'IOC'}
      </span>
    )
  }

  if (alreadyAdded) {
    return (
      <span className="inline-flex items-center gap-1 text-[10px] text-accent-green/70">
        <CheckCircle2 size={10} /> {label ? `${label} added` : 'Added'}
      </span>
    )
  }

  if (state === 'err') {
    return (
      <span className="inline-flex items-center gap-1 text-[10px] text-severity-critical cursor-pointer" onClick={() => setState('idle')}>
        <AlertCircle size={10} /> Retry
      </span>
    )
  }

  return (
    <button
      onClick={handleAdd}
      disabled={state === 'loading'}
      title={`Add to case "${caseTitle}" as ${type} IOC`}
      className="inline-flex items-center gap-1 text-[10px] px-1.5 py-0.5 rounded
                 text-accent-green/70 border border-accent-green/20 hover:bg-accent-green/10
                 hover:text-accent-green hover:border-accent-green/40 transition-colors disabled:opacity-50"
    >
      {state === 'loading' ? <Loader2 size={10} className="animate-spin" /> : <Plus size={10} />}
      {label ?? 'IOC'}
    </button>
  )
}

// ── SummaryCard ────────────────────────────────────────────────────────────

interface IocAction { type: string; value: string; label?: string; description?: string }

function SummaryCard({
  label, value, iocActions, caseId, caseTitle, addedKeys, onAdded,
}: {
  label: string
  value: string
  iocActions?: IocAction[]
  caseId?: string
  caseTitle?: string
  addedKeys: Set<string>
  onAdded: (type: string, value: string) => void
}) {
  const actions = iocActions?.filter(a => a.value.trim().length > 0) ?? []
  return (
    <div className="group rounded-lg bg-bg-secondary border border-white/8 px-3 py-2.5 min-w-0">
      <div className="flex items-center justify-between mb-0.5">
        <p className="text-[9px] font-semibold tracking-widest uppercase text-accent-muted/50">{label}</p>
        {actions.length > 0 && (
          <div className="flex items-center gap-1.5 opacity-0 group-hover:opacity-100 transition-opacity">
            {actions.map((a, i) => (
              <IocButton
                key={i}
                caseId={caseId} caseTitle={caseTitle}
                type={a.type} value={a.value}
                description={a.description ?? `${label}: ${value}`}
                label={a.label}
                addedKeys={addedKeys} onAdded={onAdded}
              />
            ))}
          </div>
        )}
      </div>
      <p className="text-[11px] text-white/80 truncate font-mono" title={value}>{value || '—'}</p>
    </div>
  )
}

// ── HeaderRow ──────────────────────────────────────────────────────────────

function HeaderRow({
  h, caseId, caseTitle, addedKeys, onAdded,
}: { h: HeaderItem; caseId?: string; caseTitle?: string; addedKeys: Set<string>; onAdded: (t: string, v: string) => void }) {
  const [open, setOpen] = useState(false)
  const iocType = headerIocType(h.name)
  const iocValue = iocType ? extractIocValue(h.name, h.value) : null

  return (
    <div className="border-b border-white/5 last:border-0">
      <div className="flex items-start gap-3 px-3 py-2 group hover:bg-white/[0.02] transition-colors">
        <span className="text-[11px] font-mono text-accent-green/80 w-44 shrink-0 truncate pt-0.5">{h.name}</span>
        <span className="flex-1 text-[11px] text-white/70 font-mono break-all leading-relaxed">{h.value}</span>
        <div className="flex items-center gap-2 shrink-0 opacity-0 group-hover:opacity-100 transition-opacity">
          <button onClick={() => copyToClipboard(h.value)} title="Copy value" className="text-accent-muted/50 hover:text-white transition-colors">
            <Copy size={11} />
          </button>
          {h.description && (
            <button onClick={() => setOpen(o => !o)} title="Show description" className="text-accent-muted/50 hover:text-accent-green transition-colors">
              <Info size={11} />
            </button>
          )}
          {iocType && iocValue && (
            <IocButton
              caseId={caseId} caseTitle={caseTitle}
              type={iocType} value={iocValue}
              description={`${h.name}: ${h.value}`}
              addedKeys={addedKeys} onAdded={onAdded}
            />
          )}
        </div>
      </div>
      {open && h.description && (
        <div className="px-3 pb-2 ml-[11.5rem]">
          <p className="text-[10px] text-accent-muted/70 italic leading-relaxed bg-white/[0.02] rounded px-2 py-1.5 border border-white/5">
            {h.description}
          </p>
        </div>
      )}
    </div>
  )
}

// ── Section ────────────────────────────────────────────────────────────────

function Section({
  icon: Icon, title, count, children, defaultOpen = true,
}: {
  icon: React.ElementType
  title: string
  count: number
  children: React.ReactNode
  defaultOpen?: boolean
}) {
  const [open, setOpen] = useState(defaultOpen)
  return (
    <div className="rounded-xl border border-white/8 bg-bg-secondary overflow-hidden">
      <button
        onClick={() => setOpen(o => !o)}
        className="w-full flex items-center gap-3 px-4 py-3 hover:bg-white/[0.02] transition-colors text-left"
      >
        <Icon size={14} className="text-accent-green shrink-0" />
        <span className="text-sm font-medium text-white flex-1">{title}</span>
        {count > 0 && <span className="text-[10px] font-mono text-accent-muted/50 mr-2">{count}</span>}
        {open ? <ChevronDown size={13} className="text-accent-muted/50" /> : <ChevronRight size={13} className="text-accent-muted/50" />}
      </button>
      {open && <div className="border-t border-white/5">{children}</div>}
    </div>
  )
}

// ── AttachmentRow ──────────────────────────────────────────────────────────

function AttachmentRow({
  att, caseId, caseTitle, addedKeys, onAdded,
}: { att: AttachmentItem; caseId?: string; caseTitle?: string; addedKeys: Set<string>; onAdded: (t: string, v: string) => void }) {
  return (
    <div className="px-3 py-3 group hover:bg-white/[0.02] transition-colors">
      <div className="flex items-start gap-3">
        <Paperclip size={13} className="text-accent-muted/40 mt-0.5 shrink-0" />
        <div className="flex-1 min-w-0 space-y-1">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="text-[12px] font-medium text-white/90 truncate">{att.filename}</span>
            <span className="text-[10px] text-accent-muted/50 font-mono">{att.content_type}</span>
            <span className="text-[10px] text-accent-muted/50">{formatBytes(att.size)}</span>
          </div>
          <div className="flex items-center gap-2">
            <span className="text-[10px] font-mono text-white/40 break-all">{att.sha256}</span>
            <div className="flex items-center gap-2 shrink-0 opacity-0 group-hover:opacity-100 transition-opacity">
              <button onClick={() => copyToClipboard(att.sha256)} title="Copy SHA256" className="text-accent-muted/50 hover:text-white transition-colors">
                <Copy size={10} />
              </button>
              <IocButton
                caseId={caseId} caseTitle={caseTitle}
                type="hash_sha256" value={att.sha256}
                description={`SHA256 of attachment "${att.filename}" (${att.content_type}, ${formatBytes(att.size)})`}
                addedKeys={addedKeys} onAdded={onAdded}
              />
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}

// ── Main page ──────────────────────────────────────────────────────────────

export default function EmailAnalysis() {
  const { currentCase } = useCurrentCase()
  const caseId = currentCase?.id
  const caseTitle = currentCase?.title

  // Fetch existing IOCs for dedup
  const { data: existingIocs = [] } = useQuery({
    queryKey: ['iocs', caseId],
    queryFn: () => iocsApi.list(caseId!),
    enabled: !!caseId,
  })

  // Locally tracked additions (avoids re-fetch latency)
  const [localAdded, setLocalAdded] = useState<Set<string>>(new Set())

  const addedKeys = useMemo(() => {
    const s = new Set(existingIocs.map(ioc => iocKey(ioc.type, ioc.value)))
    localAdded.forEach(k => s.add(k))
    return s
  }, [existingIocs, localAdded])

  const handleAdded = useCallback((type: string, value: string) => {
    setLocalAdded(prev => new Set([...prev, iocKey(type, value)]))
  }, [])

  // Reset local additions when case changes or new email is loaded
  const [result, setResult] = useState<EmailAnalysisResult | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [bodyView, setBodyView] = useState<'plain' | 'html'>('plain')
  const [dragging, setDragging] = useState(false)
  const fileRef = useRef<HTMLInputElement>(null)

  const processFile = useCallback(async (file: File) => {
    if (!file.name.endsWith('.eml') && file.type !== 'message/rfc822') {
      setError('Please provide a valid .eml file.')
      return
    }
    setError(null)
    setLoading(true)
    setResult(null)
    setLocalAdded(new Set())
    try {
      const data = await emailAnalysisApi.analyze(file)
      setResult(data)
    } catch (e: unknown) {
      const msg = (e as { response?: { data?: { detail?: string } }, message?: string })
        ?.response?.data?.detail ?? (e as { message?: string })?.message ?? 'Analysis failed'
      setError(String(msg))
    } finally {
      setLoading(false)
    }
  }, [])

  const handleFile = (e: React.ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0]
    if (f) processFile(f)
  }

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault()
    setDragging(false)
    const f = e.dataTransfer.files[0]
    if (f) processFile(f)
  }

  // Shared props for all IocButton / rows
  const iocProps = { caseId, caseTitle, addedKeys, onAdded: handleAdded }

  return (
    <div className="p-6 max-w-6xl mx-auto space-y-6">
      {/* Page header */}
      <div>
        <h1 className="text-xl font-bold text-white flex items-center gap-2">
          <Mail size={18} className="text-accent-green" />
          Email Analysis
        </h1>
        <p className="text-accent-muted text-sm mt-0.5">
          Upload a .eml file to parse headers, extract URLs and hash attachments.
        </p>
      </div>

      {/* Current case indicator */}
      {currentCase ? (
        <div className="flex items-center gap-2 text-[11px] text-accent-green/70 bg-accent-green/5 border border-accent-green/15 rounded-lg px-3 py-2">
          <CheckCircle2 size={12} />
          IOC exports will be added to case&nbsp;
          <span className="font-semibold text-accent-green">{currentCase.title}</span>
          {existingIocs.length > 0 && (
            <span className="text-accent-muted/50">— {existingIocs.length} IOC{existingIocs.length > 1 ? 's' : ''} already in case (duplicates detected automatically)</span>
          )}
        </div>
      ) : (
        <div className="flex items-center gap-2 text-[11px] text-accent-muted/60 bg-white/[0.02] border border-white/8 rounded-lg px-3 py-2">
          <Info size={12} />
          No current case selected — IOC export buttons will be disabled. Set a current case from the top bar.
        </div>
      )}

      {/* Drop zone */}
      <div
        onClick={() => fileRef.current?.click()}
        onDrop={handleDrop}
        onDragOver={e => { e.preventDefault(); setDragging(true) }}
        onDragLeave={() => setDragging(false)}
        className={`relative flex flex-col items-center justify-center gap-3 rounded-xl border-2 border-dashed py-12 cursor-pointer transition-colors select-none
          ${dragging ? 'border-accent-green/60 bg-accent-green/5' : 'border-white/10 hover:border-white/20 hover:bg-white/[0.015]'}
          ${loading ? 'pointer-events-none opacity-60' : ''}
        `}
      >
        <input ref={fileRef} type="file" accept=".eml,message/rfc822" className="sr-only" onChange={handleFile} />
        {loading ? (
          <>
            <Loader2 size={32} className="animate-spin text-accent-green/50" />
            <span className="text-sm text-accent-muted">Analysing…</span>
          </>
        ) : (
          <>
            <Upload size={28} className="text-accent-muted/40" />
            <div className="text-center">
              <p className="text-sm text-white/70">
                Drop a <span className="font-mono text-accent-green">.eml</span> file here
              </p>
              <p className="text-xs text-accent-muted/50 mt-0.5">or click to browse</p>
            </div>
          </>
        )}
      </div>

      {error && (
        <div className="flex items-center gap-2 text-sm text-severity-critical bg-severity-critical/10 border border-severity-critical/20 rounded-lg px-4 py-3">
          <AlertCircle size={14} />
          {error}
        </div>
      )}

      {result && (
        <div className="space-y-4">
          {/* Security warnings */}
          <WarningsSection warnings={result.warnings} />

          {/* Summary cards — row 1: From / To / Date */}
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
            <SummaryCard
              label="From" value={result.from_addr}
              iocActions={[
                { type: 'email', value: extractEmailAddress(result.from_addr), label: 'Email' },
                ...(extractSenderName(result.from_addr)
                  ? [{ type: 'sender_name', value: extractSenderName(result.from_addr)!, label: 'Name' }]
                  : []),
              ]}
              {...iocProps}
            />
            <SummaryCard
              label="To" value={result.to_addr}
              iocActions={[{ type: 'email', value: extractEmailAddress(result.to_addr), label: 'Email' }]}
              {...iocProps}
            />
            <SummaryCard label="Date" value={result.date} addedKeys={addedKeys} onAdded={handleAdded} />
          </div>

          {/* Reply-To / Return-Path — shown only when present, with mismatch badges */}
          {(result.reply_to || result.return_path) && (() => {
            const fromEmail    = extractEmailAddress(result.from_addr)
            const replyEmail   = result.reply_to    ? extractEmailAddress(result.reply_to)    : ''
            const returnEmail  = result.return_path ? extractEmailAddress(result.return_path) : ''
            const replyMismatch  = !!(replyEmail  && replyEmail  !== fromEmail)
            const returnMismatch = !!(returnEmail && returnEmail.split('@')[1] !== fromEmail.split('@')[1])
            return (
              <div className="grid grid-cols-2 gap-3">
                {result.reply_to && (
                  <div className={`rounded-lg border px-3 py-2.5 min-w-0 ${replyMismatch ? 'border-severity-critical/30 bg-severity-critical/5' : 'border-white/8 bg-bg-secondary'}`}>
                    <div className="flex items-center gap-1.5 mb-0.5">
                      <p className="text-[9px] font-semibold tracking-widest uppercase text-accent-muted/50">Reply-To</p>
                      {replyMismatch && (
                        <span className="flex items-center gap-0.5 text-[9px] font-bold text-severity-critical bg-severity-critical/10 border border-severity-critical/30 px-1.5 py-0.5 rounded">
                          <AlertTriangle size={8} /> MISMATCH
                        </span>
                      )}
                    </div>
                    <p className={`text-[11px] font-mono truncate ${replyMismatch ? 'text-severity-critical/90' : 'text-white/80'}`} title={result.reply_to}>
                      {result.reply_to || '—'}
                    </p>
                  </div>
                )}
                {result.return_path && (
                  <div className={`rounded-lg border px-3 py-2.5 min-w-0 ${returnMismatch ? 'border-orange-500/30 bg-orange-500/5' : 'border-white/8 bg-bg-secondary'}`}>
                    <div className="flex items-center gap-1.5 mb-0.5">
                      <p className="text-[9px] font-semibold tracking-widest uppercase text-accent-muted/50">Return-Path</p>
                      {returnMismatch && (
                        <span className="flex items-center gap-0.5 text-[9px] font-bold text-orange-400 bg-orange-500/10 border border-orange-500/30 px-1.5 py-0.5 rounded">
                          <AlertTriangle size={8} /> DOMAIN MISMATCH
                        </span>
                      )}
                    </div>
                    <p className={`text-[11px] font-mono truncate ${returnMismatch ? 'text-orange-400/90' : 'text-white/80'}`} title={result.return_path}>
                      {result.return_path || '—'}
                    </p>
                  </div>
                )}
              </div>
            )
          })()}

          {/* Subject — full width */}
          <SummaryCard
            label="Subject" value={result.subject}
            iocActions={[{ type: 'email_subject', value: result.subject, description: `Email subject: ${result.subject}` }]}
            {...iocProps}
          />

          {/* Body */}
          {(result.body_plain || result.body_html) && (
            <Section icon={FileText} title="Message Body" count={0}>
              <div className="flex items-center gap-2 px-3 py-2 border-b border-white/5">
                {result.body_plain && (
                  <button
                    onClick={() => setBodyView('plain')}
                    className={`text-[10px] px-2.5 py-1 rounded transition-colors ${bodyView === 'plain' ? 'bg-accent-green/10 text-accent-green' : 'text-accent-muted hover:text-white'}`}
                  >Plain text</button>
                )}
                {result.body_html && (
                  <button
                    onClick={() => setBodyView('html')}
                    className={`text-[10px] px-2.5 py-1 rounded transition-colors ${bodyView === 'html' ? 'bg-accent-green/10 text-accent-green' : 'text-accent-muted hover:text-white'}`}
                  >HTML source</button>
                )}
              </div>
              {bodyView === 'plain' && result.body_plain && (
                <pre className="px-4 py-3 text-[11px] font-mono text-white/70 whitespace-pre-wrap break-words leading-relaxed max-h-96 overflow-y-auto">
                  {result.body_plain}
                </pre>
              )}
              {bodyView === 'html' && result.body_html && (
                <pre className="px-4 py-3 text-[11px] font-mono text-white/70 whitespace-pre-wrap break-words leading-relaxed max-h-96 overflow-y-auto">
                  {result.body_html}
                </pre>
              )}
            </Section>
          )}

          {/* Key headers */}
          <Section icon={Mail} title="Key Headers" count={result.key_headers.length}>
            {result.key_headers.length === 0
              ? <p className="px-4 py-3 text-xs text-accent-muted/40 italic">No key headers found.</p>
              : result.key_headers.map((h, i) => <HeaderRow key={i} h={h} {...iocProps} />)
            }
          </Section>

          {/* All headers */}
          <Section icon={ChevronDown} title="All Headers" count={result.all_headers.length} defaultOpen={false}>
            {result.all_headers.map((h, i) => <HeaderRow key={i} h={h} {...iocProps} />)}
          </Section>

          {/* URLs */}
          <Section icon={Link2} title="Extracted URLs" count={result.urls.length}>
            {result.urls.length === 0
              ? <p className="px-4 py-3 text-xs text-accent-muted/40 italic">No URLs found.</p>
              : (
                <div className="divide-y divide-white/5">
                  {result.urls.map((url, i) => (
                    <div key={i} className="flex items-center gap-3 px-3 py-2 group hover:bg-white/[0.02] transition-colors">
                      <span className="flex-1 text-[11px] font-mono text-blue-400/80 break-all">{url}</span>
                      <div className="flex items-center gap-2 shrink-0 opacity-0 group-hover:opacity-100 transition-opacity">
                        <button onClick={() => copyToClipboard(url)} title="Copy URL" className="text-accent-muted/50 hover:text-white transition-colors">
                          <Copy size={11} />
                        </button>
                        <IocButton type="url" value={url} description="Extracted from email body" {...iocProps} />
                      </div>
                    </div>
                  ))}
                </div>
              )
            }
          </Section>

          {/* Attachments */}
          <Section icon={Paperclip} title="Attachments" count={result.attachments.length}>
            {result.attachments.length === 0
              ? <p className="px-4 py-3 text-xs text-accent-muted/40 italic">No attachments found.</p>
              : (
                <div className="divide-y divide-white/5">
                  {result.attachments.map((att, i) => (
                    <AttachmentRow key={i} att={att} {...iocProps} />
                  ))}
                </div>
              )
            }
          </Section>
        </div>
      )}
    </div>
  )
}
