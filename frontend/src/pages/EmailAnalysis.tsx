import { useRef, useState, useCallback, useMemo } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import {
  Upload, Mail, Link2, Paperclip, ChevronDown, ChevronRight,
  CheckCircle2, AlertCircle, Copy, Plus, Loader2, Info, FileText,
  ShieldAlert, ShieldX, AlertTriangle, Trash2, Clock,
} from 'lucide-react'
import { emailAnalysisApi, type EmailAnalysisResult, type HeaderItem, type AttachmentItem, type EmailWarning, type WarningLevel, type CaseEmailSummary } from '../api/emailAnalysis'
import { iocsApi } from '../api/iocs'
import { timelineApi } from '../api/timeline'
import { useCurrentCase } from '../context/CurrentCaseContext'
import { fmtRelative } from '../utils/dateUtils'

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
    const match = raw.match(/[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/)
    return match ? match[0] : raw.trim()
  }
  if (n === 'x-originating-ip') {
    const match = raw.match(/[\d.:a-fA-F]+/)
    return match ? match[0] : raw.trim()
  }
  return raw.trim()
}

function extractEmailAddress(raw: string): string {
  const match = raw.match(/[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/)
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

// ── Send to timeline ───────────────────────────────────────────────────────
// Same contract as the Artifact Explorer pinned panel: the analyst edits the
// title and description before sending, and the full record travels along in
// raw_payload so the Timeline tab can show it under a chevron without ever
// overwriting what was written here.

/** RFC 2822 Date header → value for a datetime-local input. Falls back to now. */
function emailDateToLocalInput(raw: string): string {
  const d = new Date(raw)
  if (isNaN(d.getTime())) return new Date().toISOString().slice(0, 16)
  // Shift by the local offset so the datetime-local input shows local wall time
  return new Date(d.getTime() - d.getTimezoneOffset() * 60_000).toISOString().slice(0, 16)
}

function buildEmailTitle(r: EmailAnalysisResult): string {
  const sender = extractEmailAddress(r.from_addr) || r.from_addr
  const subject = r.subject?.trim() || '(no subject)'
  return `Email — ${subject}${sender ? ` — de ${sender}` : ''}`.slice(0, 120)
}

function buildEmailDescription(r: EmailAnalysisResult): string {
  const lines = [
    `From: ${r.from_addr}`,
    `To: ${r.to_addr}`,
    r.reply_to    ? `Reply-To: ${r.reply_to}` : '',
    r.return_path ? `Return-Path: ${r.return_path}` : '',
    `Subject: ${r.subject}`,
    `Date: ${r.date}`,
    r.attachments.length ? `Attachments: ${r.attachments.map(a => a.filename).join(', ')}` : '',
    r.urls.length ? `URLs: ${r.urls.length}` : '',
  ].filter(Boolean)

  const critical = r.warnings.filter(w => w.level === 'critical' || w.level === 'high')
  if (critical.length) {
    lines.push('', 'Alertes:', ...critical.map(w => `- [${w.level}] ${w.title}`))
  }
  return lines.join('\n')
}

/** Every parsed field, untruncated — rendered under the Timeline chevron. */
function buildEmailRawPayload(r: EmailAnalysisResult, filename?: string): string {
  const payload: Record<string, string> = {
    ...(filename ? { SourceFile: filename } : {}),
    Subject:     r.subject,
    From:        r.from_addr,
    To:          r.to_addr,
    ReplyTo:     r.reply_to,
    ReturnPath:  r.return_path,
    Date:        r.date,
  }
  // All headers, key ones first; duplicates suffixed rather than dropped
  for (const h of [...r.key_headers, ...r.all_headers]) {
    let name = h.name
    let i = 2
    while (name in payload) name = `${h.name} (${i++})`
    payload[name] = h.value
  }
  r.attachments.forEach((a, i) => {
    payload[`Attachment ${i + 1}`] = `${a.filename} · ${a.content_type} · ${a.size} B · sha256=${a.sha256}`
  })
  r.urls.forEach((u, i) => { payload[`URL ${i + 1}`] = u })
  r.warnings.forEach((w, i) => { payload[`Warning ${i + 1}`] = `[${w.level}] ${w.title} — ${w.detail}` })
  return JSON.stringify(payload)
}

function SendEmailToTimeline({ result, caseId, filename }: {
  result:   EmailAnalysisResult
  caseId:   string
  filename?: string
}) {
  const qc = useQueryClient()
  const [open, setOpen] = useState(false)
  const [ts,   setTs]   = useState(() => emailDateToLocalInput(result.date))
  const [title, setTitle] = useState(() => buildEmailTitle(result))
  const [desc,  setDesc]  = useState(() => buildEmailDescription(result))
  const [sent,  setSent]  = useState(false)

  // Re-seed the form when the analyst switches to another email
  const seedKey = `${filename ?? ''}|${result.subject}|${result.date}`
  const [lastSeed, setLastSeed] = useState(seedKey)
  if (seedKey !== lastSeed) {
    setLastSeed(seedKey)
    setTs(emailDateToLocalInput(result.date))
    setTitle(buildEmailTitle(result))
    setDesc(buildEmailDescription(result))
    setSent(false)
  }

  const dateUnparsable = isNaN(new Date(result.date).getTime())

  const send = useMutation({
    mutationFn: () => timelineApi.create(caseId, {
      event_ts:    new Date(ts).toISOString(),
      title:       title.trim() || buildEmailTitle(result),
      description: desc,
      actor:       extractEmailAddress(result.from_addr),
      source:      filename ?? 'Email Analysis',
      tags:        'email',
      origin:      'artifact',
      raw_payload: buildEmailRawPayload(result, filename),
      raw_source:  `Email · ${filename ?? result.subject}`,
    }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['timeline', caseId] })
      setSent(true)
      setOpen(false)
    },
  })

  return (
    <div className="rounded-lg border border-white/8 bg-bg-secondary overflow-hidden">
      <div className="flex items-center gap-2 px-3 py-2">
        <button onClick={() => setOpen(o => !o)} className="flex items-center gap-2 flex-1 min-w-0 text-left">
          <ChevronRight size={11} className={`text-accent-muted/40 transition-transform ${open ? 'rotate-90' : ''}`} />
          <Clock size={12} className="text-accent-green shrink-0" />
          <span className="text-[11px] font-semibold text-white">Add to the timeline</span>
          <span className="text-[10px] text-accent-muted/40 truncate">
            {dateUnparsable
              ? 'email date unreadable - please correct'
              : `dated ${new Date(result.date).toLocaleString()}`}
          </span>
        </button>
        {sent && (
          <span className="flex items-center gap-1 text-[10px] text-accent-green/70 shrink-0">
            <CheckCircle2 size={10} /> sent
          </span>
        )}
        {!open && !sent && (
          <button
            onClick={() => send.mutate()}
            disabled={send.isPending}
            className="flex items-center gap-1 text-[10px] px-2 py-1 rounded border border-accent-green/30 text-accent-green bg-accent-green/5 hover:bg-accent-green/10 transition-colors disabled:opacity-40 shrink-0"
          >
            {send.isPending ? <Loader2 size={10} className="animate-spin" /> : <Plus size={10} />}
            Envoyer
          </button>
        )}
      </div>

      {open && (
        <div className="px-3 pb-3 pt-1 border-t border-white/5 space-y-2">
          {dateUnparsable && (
            <p className="flex items-center gap-1.5 text-[10px] text-yellow-400/80">
              <AlertTriangle size={10} />
              The Date header could not be parsed ({result.date || 'empty'}) - the timestamp was
              set to now; correct it below.
            </p>
          )}
          <div>
            <label className="text-[9px] uppercase tracking-widest text-accent-muted/40">Horodatage</label>
            <input
              type="datetime-local"
              value={ts}
              onChange={e => setTs(e.target.value)}
              className="w-full mt-0.5 bg-black/30 border border-white/10 rounded px-2 py-1 text-[11px] font-mono text-white/90 focus:border-accent-green/40 focus:outline-none"
            />
          </div>
          <div>
            <label className="text-[9px] uppercase tracking-widest text-accent-muted/40">Title</label>
            <input
              value={title}
              onChange={e => setTitle(e.target.value)}
              className="w-full mt-0.5 bg-black/30 border border-white/10 rounded px-2 py-1 text-[11px] text-white/90 focus:border-accent-green/40 focus:outline-none"
            />
          </div>
          <div>
            <label className="text-[9px] uppercase tracking-widest text-accent-muted/40">Description</label>
            <textarea
              value={desc}
              onChange={e => setDesc(e.target.value)}
              rows={7}
              className="w-full mt-0.5 bg-black/30 border border-white/10 rounded px-2 py-1 text-[10px] font-mono text-accent-muted resize-y focus:border-accent-green/40 focus:outline-none"
            />
          </div>
          <div className="flex items-center justify-between">
            <button
              onClick={() => {
                setTs(emailDateToLocalInput(result.date))
                setTitle(buildEmailTitle(result))
                setDesc(buildEmailDescription(result))
              }}
              className="text-[10px] text-accent-muted/40 hover:text-accent-green transition-colors"
            >
              Reset
            </button>
            <button
              onClick={() => send.mutate()}
              disabled={send.isPending}
              className="flex items-center gap-1 text-[10px] px-2.5 py-1 rounded border border-accent-green/30 text-accent-green bg-accent-green/5 hover:bg-accent-green/10 transition-colors disabled:opacity-40"
            >
              {send.isPending ? <Loader2 size={10} className="animate-spin" /> : <Plus size={10} />}
              Send to the timeline
            </button>
          </div>
          <p className="text-[9px] text-accent-muted/30">
            The full email (all headers, attachments, URLs, alerts) is attached to the
            event and can be expanded from a chevron in the timeline.
          </p>
          {send.isError && (
            <p className="text-[10px] text-severity-critical">
              {(send.error as Error)?.message ?? 'Échec de l\'envoi'}
            </p>
          )}
        </div>
      )}
    </div>
  )
}

// ── EmailResultView — shared analysis display ──────────────────────────────

function EmailResultView({
  result,
  caseId,
  caseTitle,
  filename,
  addedKeys,
  onAdded,
}: {
  result: EmailAnalysisResult
  caseId?: string
  caseTitle?: string
  filename?: string
  addedKeys: Set<string>
  onAdded: (type: string, value: string) => void
}) {
  const [bodyView, setBodyView] = useState<'plain' | 'html'>('plain')
  const iocProps = { caseId, caseTitle, addedKeys, onAdded }

  return (
    <div className="space-y-4">
      {/* Timeline export — only meaningful with a case to send to */}
      {caseId && <SendEmailToTimeline result={result} caseId={caseId} filename={filename} />}

      <WarningsSection warnings={result.warnings} />

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
        <SummaryCard label="Date" value={result.date} addedKeys={addedKeys} onAdded={onAdded} />
      </div>

      {(result.reply_to || result.return_path) && (() => {
        const fromEmail   = extractEmailAddress(result.from_addr)
        const replyEmail  = result.reply_to    ? extractEmailAddress(result.reply_to)    : ''
        const returnEmail = result.return_path ? extractEmailAddress(result.return_path) : ''
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

      <SummaryCard
        label="Subject" value={result.subject}
        iocActions={[{ type: 'email_subject', value: result.subject, description: `Email subject: ${result.subject}` }]}
        {...iocProps}
      />

      {(result.body_plain || result.body_html) && (
        <Section icon={FileText} title="Message Body" count={0}>
          <div className="flex items-center gap-2 px-3 py-2 border-b border-white/5">
            {result.body_plain && (
              <button onClick={() => setBodyView('plain')} className={`text-[10px] px-2.5 py-1 rounded transition-colors ${bodyView === 'plain' ? 'bg-accent-green/10 text-accent-green' : 'text-accent-muted hover:text-white'}`}>Plain text</button>
            )}
            {result.body_html && (
              <button onClick={() => setBodyView('html')} className={`text-[10px] px-2.5 py-1 rounded transition-colors ${bodyView === 'html' ? 'bg-accent-green/10 text-accent-green' : 'text-accent-muted hover:text-white'}`}>HTML source</button>
            )}
          </div>
          {bodyView === 'plain' && result.body_plain && (
            <pre className="px-4 py-3 text-[11px] font-mono text-white/70 whitespace-pre-wrap break-words leading-relaxed max-h-96 overflow-y-auto">{result.body_plain}</pre>
          )}
          {bodyView === 'html' && result.body_html && (
            <pre className="px-4 py-3 text-[11px] font-mono text-white/70 whitespace-pre-wrap break-words leading-relaxed max-h-96 overflow-y-auto">{result.body_html}</pre>
          )}
        </Section>
      )}

      <Section icon={Mail} title="Key Headers" count={result.key_headers.length}>
        {result.key_headers.length === 0
          ? <p className="px-4 py-3 text-xs text-accent-muted/40 italic">No key headers found.</p>
          : result.key_headers.map((h, i) => <HeaderRow key={i} h={h} {...iocProps} />)
        }
      </Section>

      <Section icon={ChevronDown} title="All Headers" count={result.all_headers.length} defaultOpen={false}>
        {result.all_headers.map((h, i) => <HeaderRow key={i} h={h} {...iocProps} />)}
      </Section>

      <Section icon={Link2} title="Extracted URLs" count={result.urls.length}>
        {result.urls.length === 0
          ? <p className="px-4 py-3 text-xs text-accent-muted/40 italic">No URLs found.</p>
          : (
            <div className="divide-y divide-white/5">
              {result.urls.map((url, i) => (
                <div key={i} className="flex items-center gap-3 px-3 py-2 group hover:bg-white/[0.02] transition-colors">
                  <span className="flex-1 text-[11px] font-mono text-blue-400/80 break-all">{url}</span>
                  <div className="flex items-center gap-2 shrink-0 opacity-0 group-hover:opacity-100 transition-opacity">
                    <button onClick={() => copyToClipboard(url)} title="Copy URL" className="text-accent-muted/50 hover:text-white transition-colors"><Copy size={11} /></button>
                    <IocButton type="url" value={url} description="Extracted from email body" {...iocProps} />
                  </div>
                </div>
              ))}
            </div>
          )
        }
      </Section>

      <Section icon={Paperclip} title="Attachments" count={result.attachments.length}>
        {result.attachments.length === 0
          ? <p className="px-4 py-3 text-xs text-accent-muted/40 italic">No attachments found.</p>
          : (
            <div className="divide-y divide-white/5">
              {result.attachments.map((att, i) => <AttachmentRow key={i} att={att} {...iocProps} />)}
            </div>
          )
        }
      </Section>
    </div>
  )
}

// ── Sidebar email row ──────────────────────────────────────────────────────

function EmailSidebarRow({
  email, selected, onSelect, onDelete,
}: {
  email: CaseEmailSummary
  selected: boolean
  onSelect: () => void
  onDelete: () => void
}) {
  const hasWarnings = email.warning_count > 0
  return (
    <div
      onClick={onSelect}
      className={`group relative px-3 py-2.5 cursor-pointer border-l-2 transition-colors ${
        selected
          ? 'bg-accent-green/5 border-l-accent-green/40'
          : 'border-l-transparent hover:bg-white/[0.03]'
      }`}
    >
      <div className="flex items-start gap-2 pr-5">
        <Mail size={12} className={`mt-0.5 shrink-0 ${hasWarnings ? 'text-severity-critical' : 'text-accent-muted/40'}`} />
        <div className="flex-1 min-w-0">
          <p className="text-[11px] text-white/80 truncate leading-snug">{email.subject || '(no subject)'}</p>
          <p className="text-[10px] text-accent-muted/50 truncate mt-0.5">{email.from_addr}</p>
          <div className="flex items-center gap-2 mt-1">
            <span className="flex items-center gap-0.5 text-[9px] text-accent-muted/30">
              <Clock size={8} />{fmtRelative(email.uploaded_at)}
            </span>
            {hasWarnings && (
              <span className="text-[9px] font-bold text-severity-critical bg-severity-critical/10 border border-severity-critical/20 px-1 py-0.5 rounded">
                {email.warning_count} alert{email.warning_count > 1 ? 's' : ''}
              </span>
            )}
          </div>
        </div>
      </div>
      <button
        onClick={e => { e.stopPropagation(); onDelete() }}
        className="absolute right-2 top-2.5 opacity-0 group-hover:opacity-100 text-accent-muted/40 hover:text-severity-critical transition-all"
        title="Delete"
      >
        <Trash2 size={11} />
      </button>
    </div>
  )
}

// ── Main page ──────────────────────────────────────────────────────────────

export default function EmailAnalysis() {
  const { currentCase } = useCurrentCase()
  const caseId    = currentCase?.id
  const caseTitle = currentCase?.title
  const qc        = useQueryClient()

  // ── IOC dedup ──────────────────────────────────────────────────────────────
  const { data: existingIocs = [] } = useQuery({
    queryKey: ['iocs', caseId],
    queryFn:  () => iocsApi.list(caseId!),
    enabled:  !!caseId,
  })
  const [localAdded, setLocalAdded] = useState<Set<string>>(new Set())
  const addedKeys = useMemo(() => {
    const s = new Set(existingIocs.map(ioc => iocKey(ioc.type, ioc.value)))
    localAdded.forEach(k => s.add(k))
    return s
  }, [existingIocs, localAdded])
  const handleAdded = useCallback((type: string, value: string) => {
    setLocalAdded(prev => new Set([...prev, iocKey(type, value)]))
  }, [])

  // ── Stored emails (case-scoped) ────────────────────────────────────────────
  const { data: storedEmails = [] } = useQuery({
    queryKey: ['case-emails', caseId],
    queryFn:  () => emailAnalysisApi.list(caseId!),
    enabled:  !!caseId,
  })

  const [selectedEmailId, setSelectedEmailId] = useState<string | null>(null)

  const { data: selectedEmailDetail, isFetching: loadingStored } = useQuery({
    queryKey: ['case-email', caseId, selectedEmailId],
    queryFn:  () => emailAnalysisApi.get(caseId!, selectedEmailId!),
    enabled:  !!caseId && !!selectedEmailId,
  })

  const deleteEmail = useMutation({
    mutationFn: (emailId: string) => emailAnalysisApi.delete(caseId!, emailId),
    onSuccess: (_, emailId) => {
      qc.invalidateQueries({ queryKey: ['case-emails', caseId] })
      if (selectedEmailId === emailId) setSelectedEmailId(null)
    },
  })

  // ── Upload (persisted when case active, stateless otherwise) ──────────────
  const [loading,  setLoading]  = useState(false)
  const [error,    setError]    = useState<string | null>(null)
  const [dragging, setDragging] = useState(false)
  // stateless result (no case active)
  const [statelessResult, setStatelessResult] = useState<EmailAnalysisResult | null>(null)
  const fileRef = useRef<HTMLInputElement>(null)

  const processFile = useCallback(async (file: File) => {
    if (!file.name.endsWith('.eml') && file.type !== 'message/rfc822') {
      setError('Please provide a valid .eml file.')
      return
    }
    setError(null)
    setLoading(true)
    setStatelessResult(null)
    setLocalAdded(new Set())
    try {
      if (caseId) {
        // Persist to case
        const detail = await emailAnalysisApi.upload(caseId, file)
        qc.invalidateQueries({ queryKey: ['case-emails', caseId] })
        setSelectedEmailId(detail.id)
      } else {
        // Stateless fallback
        const data = await emailAnalysisApi.analyze(file)
        setStatelessResult(data)
      }
    } catch (e: unknown) {
      const msg = (e as { response?: { data?: { detail?: string } }, message?: string })
        ?.response?.data?.detail ?? (e as { message?: string })?.message ?? 'Analysis failed'
      setError(String(msg))
    } finally {
      setLoading(false)
    }
  }, [caseId, qc])

  const handleFile  = (e: React.ChangeEvent<HTMLInputElement>) => { const f = e.target.files?.[0]; if (f) processFile(f) }
  const handleDrop  = (e: React.DragEvent) => { e.preventDefault(); setDragging(false); const f = e.dataTransfer.files[0]; if (f) processFile(f) }

  // Active analysis result to display
  const activeResult: EmailAnalysisResult | null = caseId
    ? (selectedEmailDetail?.analysis ?? null)
    : statelessResult

  // ── Render ─────────────────────────────────────────────────────────────────

  const dropZone = (
    <div
      onClick={() => fileRef.current?.click()}
      onDrop={handleDrop}
      onDragOver={e => { e.preventDefault(); setDragging(true) }}
      onDragLeave={() => setDragging(false)}
      className={`flex flex-col items-center justify-center gap-3 rounded-xl border-2 border-dashed py-10 cursor-pointer transition-colors select-none
        ${dragging ? 'border-accent-green/60 bg-accent-green/5' : 'border-white/10 hover:border-white/20 hover:bg-white/[0.015]'}
        ${loading ? 'pointer-events-none opacity-60' : ''}
      `}
    >
      <input ref={fileRef} type="file" accept=".eml,message/rfc822" className="sr-only" onChange={handleFile} />
      {loading ? (
        <><Loader2 size={28} className="animate-spin text-accent-green/50" /><span className="text-sm text-accent-muted">Analysing…</span></>
      ) : (
        <>
          <Upload size={24} className="text-accent-muted/40" />
          <div className="text-center">
            <p className="text-sm text-white/70">Drop a <span className="font-mono text-accent-green">.eml</span> file here</p>
            <p className="text-xs text-accent-muted/50 mt-0.5">or click to browse</p>
          </div>
        </>
      )}
    </div>
  )

  // ── With active case: sidebar layout ──────────────────────────────────────
  if (caseId) {
    return (
      <div className="flex h-full overflow-hidden">
        {/* Left sidebar — email list */}
        <div className="w-64 shrink-0 border-r border-white/5 bg-bg-card flex flex-col overflow-hidden">
          <div className="px-3 py-3 border-b border-white/5 shrink-0">
            <p className="text-[10px] font-semibold uppercase tracking-widest text-accent-muted/50 flex items-center gap-1.5">
              <Mail size={10} /> Emails — {currentCase?.title}
            </p>
          </div>

          {/* Upload button */}
          <div className="px-3 py-2 border-b border-white/5 shrink-0">
            <button
              onClick={() => fileRef.current?.click()}
              disabled={loading}
              className="w-full flex items-center justify-center gap-1.5 text-[11px] py-1.5 rounded border border-dashed border-white/15 text-accent-muted hover:text-accent-green hover:border-accent-green/30 transition-colors disabled:opacity-40"
            >
              {loading ? <Loader2 size={11} className="animate-spin" /> : <Upload size={11} />}
              {loading ? 'Analysing…' : 'Upload .eml'}
            </button>
            <input ref={fileRef} type="file" accept=".eml,message/rfc822" className="sr-only" onChange={handleFile} />
          </div>

          {/* Email list */}
          <div className="flex-1 overflow-y-auto">
            {storedEmails.length === 0 && !loading && (
              <p className="text-[10px] text-accent-muted/30 text-center py-8 px-3">
                No emails yet.<br />Upload a .eml file to start.
              </p>
            )}
            {storedEmails.map(email => (
              <EmailSidebarRow
                key={email.id}
                email={email}
                selected={selectedEmailId === email.id}
                onSelect={() => setSelectedEmailId(email.id)}
                onDelete={() => deleteEmail.mutate(email.id)}
              />
            ))}
          </div>
        </div>

        {/* Main content */}
        <div className="flex-1 overflow-y-auto">
          {error && (
            <div className="m-4 flex items-center gap-2 text-sm text-severity-critical bg-severity-critical/10 border border-severity-critical/20 rounded-lg px-4 py-3">
              <AlertCircle size={14} />{error}
            </div>
          )}

          {!selectedEmailId && (
            <div className="p-6 space-y-4">
              <div className="flex items-center gap-2 text-[11px] text-accent-green/70 bg-accent-green/5 border border-accent-green/15 rounded-lg px-3 py-2">
                <CheckCircle2 size={12} />
                Emails uploaded here are saved to case <span className="font-semibold text-accent-green">{currentCase?.title}</span>
                {existingIocs.length > 0 && (
                  <span className="text-accent-muted/50 ml-1">— {existingIocs.length} IOC{existingIocs.length > 1 ? 's' : ''} already in case</span>
                )}
              </div>
              {/* Drop zone in empty state */}
              <div
                onDrop={handleDrop}
                onDragOver={e => { e.preventDefault(); setDragging(true) }}
                onDragLeave={() => setDragging(false)}
                className={`flex flex-col items-center justify-center gap-3 rounded-xl border-2 border-dashed py-20 transition-colors
                  ${dragging ? 'border-accent-green/60 bg-accent-green/5' : 'border-white/8'}
                `}
              >
                <Mail size={36} className="text-accent-muted/20" />
                <p className="text-sm text-accent-muted/40">Select an email from the sidebar, or drop a .eml file here</p>
              </div>
            </div>
          )}

          {selectedEmailId && loadingStored && (
            <div className="flex items-center justify-center py-20">
              <Loader2 size={24} className="animate-spin text-accent-green/40" />
            </div>
          )}

          {selectedEmailId && activeResult && (
            <div className="p-6">
              <EmailResultView
                result={activeResult}
                caseId={caseId}
                caseTitle={caseTitle}
                filename={selectedEmailDetail?.filename}
                addedKeys={addedKeys}
                onAdded={handleAdded}
              />
            </div>
          )}
        </div>
      </div>
    )
  }

  // ── Without active case: full-page stateless layout ────────────────────────
  return (
    <div className="p-6 max-w-6xl mx-auto space-y-6">
      <div>
        <h1 className="text-xl font-bold text-white flex items-center gap-2">
          <Mail size={18} className="text-accent-green" /> Email Analysis
        </h1>
        <p className="text-accent-muted text-sm mt-0.5">Upload a .eml file to parse headers, extract URLs and hash attachments.</p>
      </div>

      <div className="flex items-center gap-2 text-[11px] text-accent-muted/60 bg-white/[0.02] border border-white/8 rounded-lg px-3 py-2">
        <Info size={12} />
        No current case selected — emails won't be saved. Set a current case from the top bar to enable persistent storage.
      </div>

      {dropZone}

      {error && (
        <div className="flex items-center gap-2 text-sm text-severity-critical bg-severity-critical/10 border border-severity-critical/20 rounded-lg px-4 py-3">
          <AlertCircle size={14} />{error}
        </div>
      )}

      {statelessResult && (
        <EmailResultView
          result={statelessResult}
          caseId={undefined}
          caseTitle={undefined}
          addedKeys={addedKeys}
          onAdded={handleAdded}
        />
      )}
    </div>
  )
}
