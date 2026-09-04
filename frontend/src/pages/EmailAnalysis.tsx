import { useRef, useState, useCallback, useMemo } from 'react'
import { PageShell } from '../ui/PageShell'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import {
  Upload, Mail, Link2, Paperclip, ChevronDown, ChevronRight,
  CheckCircle2, AlertCircle, Copy, Plus, Loader2, Info, FileText,
  ShieldAlert, ShieldX, AlertTriangle, Trash2, Clock,
} from '../ui/icons'
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
    bar:   'border-severity-high/30 bg-severity-high/8',
    icon:  'text-severity-high',
    badge: 'bg-severity-high/15 text-severity-high border-severity-high/30',
  },
  medium: {
    bar:   'border-severity-medium/30 bg-severity-medium/8',
    icon:  'text-severity-medium',
    badge: 'bg-severity-medium/15 text-severity-medium border-severity-medium/30',
  },
  info: {
    bar:   'border-severity-low/30 bg-severity-low/8',
    icon:  'text-severity-low',
    badge: 'bg-severity-low/15 text-severity-low border-severity-low/30',
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
    <span className={`text-label font-bold uppercase tracking-wider px-1.5 py-0.5 rounded-control border ${s.badge}`}>
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
      <p className="text-label font-semibold tracking-widest uppercase text-fg-secondary/50">
        Security Alerts ({warnings.length})
      </p>
      {sorted.map((w, i) => {
        const s    = WARNING_STYLES[w.level]
        const Icon = WARNING_ICONS[w.level]
        return (
          <div key={i} className={`flex items-start gap-3 border px-4 py-3 ${s.bar}`}>
            <Icon size={15} className={`shrink-0 mt-0.5 ${s.icon}`} />
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2 mb-0.5">
                <span className="text-ui font-semibold text-fg">{w.title}</span>
                <WarningBadge level={w.level} />
              </div>
              <p className="text-label text-fg/60 leading-relaxed">{w.detail}</p>
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
        className="inline-flex items-center gap-1 text-label text-fg-secondary/30 cursor-not-allowed select-none"
      >
        <Plus size={10} /> {label ?? 'IOC'}
      </span>
    )
  }

  if (alreadyAdded) {
    return (
      <span className="inline-flex items-center gap-1 text-label text-accent/70">
        <CheckCircle2 size={10} /> {label ? `${label} added` : 'Added'}
      </span>
    )
  }

  if (state === 'err') {
    return (
      <span className="inline-flex items-center gap-1 text-label text-severity-critical cursor-pointer" onClick={() => setState('idle')}>
        <AlertCircle size={10} /> Retry
      </span>
    )
  }

  return (
    <button
      onClick={handleAdd}
      disabled={state === 'loading'}
      title={`Add to case "${caseTitle}" as ${type} IOC`}
      className="inline-flex items-center gap-1 text-label px-1.5 py-0.5 rounded-control text-accent/70 border border-accent/20 hover:bg-accent/10
                 hover:text-accent hover:border-accent/40 transition-colors disabled:opacity-50"
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
    <div className="group bg-panel border border-hairline px-3 py-2.5 min-w-0">
      <div className="flex items-center justify-between mb-0.5">
        <p className="text-label font-semibold tracking-widest uppercase text-fg-secondary/50">{label}</p>
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
      <p className="text-label text-fg/80 truncate font-mono" title={value}>{value || '—'}</p>
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
    <div className="border-b border-hairline last:border-0">
      <div className="flex items-start gap-3 px-3 py-2 group hover:bg-white/[0.02] transition-colors">
        <span className="text-label font-mono text-accent/80 w-44 shrink-0 truncate pt-0.5">{h.name}</span>
        <span className="flex-1 text-label text-fg/70 font-mono break-all leading-relaxed">{h.value}</span>
        <div className="flex items-center gap-2 shrink-0 opacity-0 group-hover:opacity-100 transition-opacity">
          <button onClick={() => copyToClipboard(h.value)} title="Copy value" className="text-fg-secondary/50 hover:text-fg transition-colors">
            <Copy size={11} />
          </button>
          {h.description && (
            <button onClick={() => setOpen(o => !o)} title="Show description" className="text-fg-secondary/50 hover:text-accent transition-colors">
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
          <p className="text-label text-fg-secondary/70 italic leading-relaxed bg-white/[0.02] rounded-control px-2 py-1.5 border border-hairline">
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
    <div className=" border border-hairline bg-panel overflow-hidden">
      <button
        onClick={() => setOpen(o => !o)}
        className="w-full flex items-center gap-3 px-4 py-3 hover:bg-white/[0.02] transition-colors text-left"
      >
        <Icon size={14} className="text-accent shrink-0" />
        <span className="text-ui font-medium text-fg flex-1">{title}</span>
        {count > 0 && <span className="text-label font-mono text-fg-secondary/50 mr-2">{count}</span>}
        {open ? <ChevronDown size={13} className="text-fg-secondary/50" /> : <ChevronRight size={13} className="text-fg-secondary/50" />}
      </button>
      {open && <div className="border-t border-hairline">{children}</div>}
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
        <Paperclip size={13} className="text-fg-secondary/40 mt-0.5 shrink-0" />
        <div className="flex-1 min-w-0 space-y-1">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="text-ui font-medium text-fg/90 truncate">{att.filename}</span>
            <span className="text-label text-fg-secondary/50 font-mono">{att.content_type}</span>
            <span className="text-label text-fg-secondary/50">{formatBytes(att.size)}</span>
          </div>
          <div className="flex items-center gap-2">
            <span className="text-label font-mono text-fg/40 break-all">{att.sha256}</span>
            <div className="flex items-center gap-2 shrink-0 opacity-0 group-hover:opacity-100 transition-opacity">
              <button onClick={() => copyToClipboard(att.sha256)} title="Copy SHA256" className="text-fg-secondary/50 hover:text-fg transition-colors">
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
    <div className=" border border-hairline bg-panel overflow-hidden">
      <div className="flex items-center gap-2 px-3 py-2">
        <button onClick={() => setOpen(o => !o)} className="flex items-center gap-2 flex-1 min-w-0 text-left">
          <ChevronRight size={11} className={`text-fg-secondary/40 transition-transform ${open ? 'rotate-90' : ''}`} />
          <Clock size={12} className="text-accent shrink-0" />
          <span className="text-label font-semibold text-fg">Add to the timeline</span>
          <span className="text-label text-fg-secondary/40 truncate">
            {dateUnparsable
              ? 'email date unreadable - please correct'
              : `dated ${new Date(result.date).toLocaleString()}`}
          </span>
        </button>
        {sent && (
          <span className="flex items-center gap-1 text-label text-accent/70 shrink-0">
            <CheckCircle2 size={10} /> sent
          </span>
        )}
        {!open && !sent && (
          <button
            onClick={() => send.mutate()}
            disabled={send.isPending}
            className="flex items-center gap-1 text-label px-2 py-1 rounded-control border border-accent/30 text-accent bg-accent/5 hover:bg-accent/10 transition-colors disabled:opacity-40 shrink-0"
          >
            {send.isPending ? <Loader2 size={10} className="animate-spin" /> : <Plus size={10} />}
            Send
          </button>
        )}
      </div>

      {open && (
        <div className="px-3 pb-3 pt-1 border-t border-hairline space-y-2">
          {dateUnparsable && (
            <p className="flex items-center gap-1.5 text-label text-severity-medium/80">
              <AlertTriangle size={10} />
              The Date header could not be parsed ({result.date || 'empty'}) - the timestamp was
              set to now; correct it below.
            </p>
          )}
          <div>
            <label className="text-label uppercase tracking-widest text-fg-secondary/40">Horodatage</label>
            <input
              type="datetime-local"
              value={ts}
              onChange={e => setTs(e.target.value)}
              className="w-full mt-0.5 bg-black/30 border border-hairline rounded-control px-2 py-1 text-label font-mono text-fg/90 focus:border-accent/40 focus:outline-none"
            />
          </div>
          <div>
            <label className="text-label uppercase tracking-widest text-fg-secondary/40">Title</label>
            <input
              value={title}
              onChange={e => setTitle(e.target.value)}
              className="w-full mt-0.5 bg-black/30 border border-hairline rounded-control px-2 py-1 text-label text-fg/90 focus:border-accent/40 focus:outline-none"
            />
          </div>
          <div>
            <label className="text-label uppercase tracking-widest text-fg-secondary/40">Description</label>
            <textarea
              value={desc}
              onChange={e => setDesc(e.target.value)}
              rows={7}
              className="w-full mt-0.5 bg-black/30 border border-hairline rounded-control px-2 py-1 text-label font-mono text-fg-secondary resize-y focus:border-accent/40 focus:outline-none"
            />
          </div>
          <div className="flex items-center justify-between">
            <button
              onClick={() => {
                setTs(emailDateToLocalInput(result.date))
                setTitle(buildEmailTitle(result))
                setDesc(buildEmailDescription(result))
              }}
              className="text-label text-fg-secondary/40 hover:text-accent transition-colors"
            >
              Reset
            </button>
            <button
              onClick={() => send.mutate()}
              disabled={send.isPending}
              className="flex items-center gap-1 text-label px-2.5 py-1 rounded-control border border-accent/30 text-accent bg-accent/5 hover:bg-accent/10 transition-colors disabled:opacity-40"
            >
              {send.isPending ? <Loader2 size={10} className="animate-spin" /> : <Plus size={10} />}
              Send to the timeline
            </button>
          </div>
          <p className="text-label text-fg-secondary/30">
            The full email (all headers, attachments, URLs, alerts) is attached to the
            event and can be expanded from a chevron in the timeline.
          </p>
          {send.isError && (
            <p className="text-label text-severity-critical">
              {(send.error as Error)?.message ?? 'Échec de l\'envoi'}
            </p>
          )}
        </div>
      )}
    </div>
  )
}

// ── Message view — the email as the recipient saw it ───────────────────────

/**
 * Renders the HTML body inside a sandboxed frame.
 *
 * Seeing what the victim saw is worth a lot when triaging a phishing email, and
 * reading the source is not the same thing. But this is attacker-authored HTML,
 * so it renders under two locks:
 *
 *   sandbox=""  — no scripts, no forms, no popups, no same-origin access.
 *   a CSP that allows inline styles and data: images and nothing else, which
 *   is what stops the remote image that is really a tracking pixel from
 *   telling the sender the mail was opened, from your analyst's IP.
 *
 * Off by default. Turning it on is a decision, so it is one the analyst makes.
 */
function HtmlPreview({ html }: { html: string }) {
  const doc = `<!doctype html><html><head><meta charset="utf-8">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src data:; style-src 'unsafe-inline'; font-src data:">
<style>
  body { margin:0; padding:16px; background:#fff; color:#111;
         font-family: -apple-system, system-ui, sans-serif; font-size:14px; line-height:1.5; }
  img { max-width:100%; }
  a { color:#0b57d0; }
</style></head><body>${html}</body></html>`

  return (
    <iframe
      sandbox=""
      srcDoc={doc}
      title="Rendered message body"
      className="w-full h-[28rem] border-0 bg-white"
    />
  )
}

function MessageTab({ result }: { result: EmailAnalysisResult }) {
  const [view, setView] = useState<'plain' | 'source' | 'render'>(
    result.body_plain ? 'plain' : 'source',
  )
  const senderName = extractSenderName(result.from_addr)
  const senderMail = extractEmailAddress(result.from_addr)
  const initial    = (senderName || senderMail || '?').trim().charAt(0).toUpperCase()

  return (
    <div className="max-w-[80ch]">
      {/* The envelope, laid out the way a mail client lays it out — so an
          analyst reads it the way the recipient did, not as a field dump. */}
      <div className="border border-hairline bg-panel">
        <div className="px-5 pt-5 pb-4">
          <h2 className="text-title font-semibold text-fg break-words">
            {result.subject || <span className="text-fg-muted italic">(no subject)</span>}
          </h2>
        </div>

        <div className="flex items-start gap-3 px-5 pb-4 border-b border-hairline">
          <span className="w-9 h-9 shrink-0 rounded-pill bg-accent/10 border border-accent/20
                           flex items-center justify-center text-accent font-semibold">
            {initial}
          </span>
          <div className="min-w-0 flex-1">
            <p className="text-ui text-fg truncate">
              {senderName ?? senderMail}
              {senderName && (
                <span className="text-fg-muted font-mono text-label ml-1.5">&lt;{senderMail}&gt;</span>
              )}
            </p>
            <p className="text-label text-fg-muted truncate">to {result.to_addr || '—'}</p>
          </div>
          <p className="text-label font-mono text-fg-muted shrink-0">{result.date || '—'}</p>
        </div>

        <div className="flex items-center gap-1 px-4 py-1.5 border-b border-hairline">
          {result.body_plain && (
            <button onClick={() => setView('plain')} className={view === 'plain' ? 'btn-primary' : 'btn-ghost'}>
              Plain text
            </button>
          )}
          {result.body_html && (
            <>
              <button onClick={() => setView('source')} className={view === 'source' ? 'btn-primary' : 'btn-ghost'}>
                HTML source
              </button>
              <button onClick={() => setView('render')} className={view === 'render' ? 'btn-primary' : 'btn-ghost'}>
                Render
              </button>
            </>
          )}
        </div>

        {view === 'render' && result.body_html ? (
          <>
            <p className="flex items-start gap-1.5 px-4 py-2 text-label text-severity-medium border-b border-hairline">
              <AlertTriangle size={11} className="mt-0.5 shrink-0" />
              Rendered with scripts disabled and remote loading blocked, so a tracking pixel
              cannot report that this mail was opened. Layout may differ from what the
              recipient saw.
            </p>
            <HtmlPreview html={result.body_html} />
          </>
        ) : (
          <pre className="px-5 py-4 text-prose font-sans text-fg whitespace-pre-wrap break-words
                          max-h-[28rem] overflow-y-auto">
            {view === 'plain' ? result.body_plain : result.body_html}
          </pre>
        )}

        {!result.body_plain && !result.body_html && (
          <p className="px-5 py-8 text-center text-ui text-fg-muted">This message has no body.</p>
        )}
      </div>
    </div>
  )
}

// ── EmailResultView — shared analysis display ──────────────────────────────

type EmailTab = 'overview' | 'message' | 'links' | 'headers'

const EMAIL_TABS: { id: EmailTab; label: string; icon: React.ElementType }[] = [
  { id: 'overview', label: 'Overview',    icon: Info      },
  { id: 'message',  label: 'Message',     icon: Mail      },
  { id: 'links',    label: 'Links & files', icon: Link2   },
  { id: 'headers',  label: 'Headers',     icon: FileText  },
]

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
  const [tab, setTab] = useState<EmailTab>('overview')
  const iocProps = { caseId, caseTitle, addedKeys, onAdded }

  const fromEmail   = extractEmailAddress(result.from_addr)
  const replyEmail  = result.reply_to    ? extractEmailAddress(result.reply_to)    : ''
  const returnEmail = result.return_path ? extractEmailAddress(result.return_path) : ''
  const replyMismatch  = !!(replyEmail  && replyEmail  !== fromEmail)
  const returnMismatch = !!(returnEmail && returnEmail.split('@')[1] !== fromEmail.split('@')[1])

  const urlsAndFiles = result.urls.length + result.attachments.length

  const summary = (
    <>
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
        <SummaryCard
          label="From" value={result.from_addr}
          iocActions={[
            { type: 'email', value: fromEmail, label: 'Email' },
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

      {(result.reply_to || result.return_path) && (
        <div className="grid grid-cols-2 gap-3">
          {result.reply_to && (
            <div className={`border px-3 py-2.5 min-w-0 ${replyMismatch ? 'border-severity-critical/30 bg-severity-critical/5' : 'border-hairline bg-panel'}`}>
              <div className="flex items-center gap-1.5 mb-0.5">
                <p className="text-label font-mono uppercase tracking-label text-fg-muted">Reply-To</p>
                {replyMismatch && (
                  <span className="flex items-center gap-0.5 text-label font-semibold text-severity-critical bg-severity-critical/10 border border-severity-critical/30 px-1.5 py-0.5 rounded-control">
                    <AlertTriangle size={8} /> MISMATCH
                  </span>
                )}
              </div>
              <p className={`text-label font-mono truncate ${replyMismatch ? 'text-severity-critical' : 'text-fg-secondary'}`} title={result.reply_to}>
                {result.reply_to || '—'}
              </p>
            </div>
          )}
          {result.return_path && (
            <div className={`border px-3 py-2.5 min-w-0 ${returnMismatch ? 'border-severity-high/30 bg-severity-high/5' : 'border-hairline bg-panel'}`}>
              <div className="flex items-center gap-1.5 mb-0.5">
                <p className="text-label font-mono uppercase tracking-label text-fg-muted">Return-Path</p>
                {returnMismatch && (
                  <span className="flex items-center gap-0.5 text-label font-semibold text-severity-high bg-severity-high/10 border border-severity-high/30 px-1.5 py-0.5 rounded-control">
                    <AlertTriangle size={8} /> DOMAIN MISMATCH
                  </span>
                )}
              </div>
              <p className={`text-label font-mono truncate ${returnMismatch ? 'text-severity-high' : 'text-fg-secondary'}`} title={result.return_path}>
                {result.return_path || '—'}
              </p>
            </div>
          )}
        </div>
      )}

      <SummaryCard
        label="Subject" value={result.subject}
        iocActions={[{ type: 'email_subject', value: result.subject, description: `Email subject: ${result.subject}` }]}
        {...iocProps}
      />
    </>
  )

  const links = (
    <>
      <Section icon={Link2} title="Extracted URLs" count={result.urls.length}>
        {result.urls.length === 0
          ? <p className="px-4 py-3 text-ui text-fg-muted italic">No URLs found.</p>
          : (
            <div className="divide-y divide-hairline">
              {result.urls.map((url, i) => (
                <div key={i} className="flex items-center gap-3 px-3 py-2 group hover:bg-hover transition-colors">
                  <span className="flex-1 text-label font-mono text-severity-low break-all">{url}</span>
                  <div className="flex items-center gap-2 shrink-0 opacity-0 group-hover:opacity-100 transition-opacity">
                    <button onClick={() => copyToClipboard(url)} title="Copy URL" className="text-fg-muted hover:text-fg transition-colors"><Copy size={11} /></button>
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
          ? <p className="px-4 py-3 text-ui text-fg-muted italic">No attachments found.</p>
          : (
            <div className="divide-y divide-hairline">
              {result.attachments.map((att, i) => <AttachmentRow key={i} att={att} {...iocProps} />)}
            </div>
          )
        }
      </Section>
    </>
  )

  const headers = (
    <>
      <Section icon={Mail} title="Key Headers" count={result.key_headers.length}>
        {result.key_headers.length === 0
          ? <p className="px-4 py-3 text-ui text-fg-muted italic">No key headers found.</p>
          : result.key_headers.map((h, i) => <HeaderRow key={i} h={h} {...iocProps} />)
        }
      </Section>

      <Section icon={ChevronDown} title="All Headers" count={result.all_headers.length} defaultOpen={false}>
        {result.all_headers.map((h, i) => <HeaderRow key={i} h={h} {...iocProps} />)}
      </Section>
    </>
  )

  const COUNTS: Record<EmailTab, number | null> = {
    overview: null,
    message:  null,
    links:    urlsAndFiles,
    headers:  result.all_headers.length,
  }

  return (
    <div className="space-y-4">
      {/* Timeline export — only meaningful with a case to send to */}
      {caseId && <SendEmailToTimeline result={result} caseId={caseId} filename={filename} />}

      {/* Warnings sit above the tabs on purpose: a DKIM failure is not a
          detail belonging to one view of the message. */}
      <WarningsSection warnings={result.warnings} />

      <div className="flex items-center gap-1 border-b border-hairline">
        {EMAIL_TABS.map(({ id, label, icon: Icon }) => (
          <button
            key={id}
            onClick={() => setTab(id)}
            className={`flex items-center gap-1.5 px-3 py-2 text-ui transition-colors ${
              tab === id ? 'tab-active' : 'tab-inactive'
            }`}
          >
            <Icon size={11} />
            {label}
            {COUNTS[id] !== null && (
              <span className="text-label font-mono text-fg-muted">{COUNTS[id]}</span>
            )}
          </button>
        ))}
      </div>

      {tab === 'overview' && (
        <div className="space-y-4">
          {summary}
          {headers}
          {links}
        </div>
      )}
      {tab === 'message' && <MessageTab result={result} />}
      {tab === 'links'   && <div className="space-y-4">{links}</div>}
      {tab === 'headers' && <div className="space-y-4">{headers}</div>}
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
      className={`group relative px-3 py-2.5 cursor-pointer border-l-2 transition-colors ${ selected
          ? 'bg-accent/5 border-l-accent/40'
          : 'border-l-transparent hover:bg-white/[0.03]'
      }`}
    >
      <div className="flex items-start gap-2 pr-5">
        <Mail size={12} className={`mt-0.5 shrink-0 ${hasWarnings ? 'text-severity-critical' : 'text-fg-secondary/40'}`} />
        <div className="flex-1 min-w-0">
          <p className="text-label text-fg/80 truncate leading-snug">{email.subject || '(no subject)'}</p>
          <p className="text-label text-fg-secondary/50 truncate mt-0.5">{email.from_addr}</p>
          <div className="flex items-center gap-2 mt-1">
            <span className="flex items-center gap-0.5 text-label text-fg-secondary/30">
              <Clock size={8} />{fmtRelative(email.uploaded_at)}
            </span>
            {hasWarnings && (
              <span className="text-label font-bold text-severity-critical bg-severity-critical/10 border border-severity-critical/20 px-1 py-0.5 rounded-control">
                {email.warning_count} alert{email.warning_count > 1 ? 's' : ''}
              </span>
            )}
          </div>
        </div>
      </div>
      <button
        onClick={e => { e.stopPropagation(); onDelete() }}
        className="absolute right-2 top-2.5 opacity-0 group-hover:opacity-100 text-fg-secondary/40 hover:text-severity-critical transition-all"
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
      className={`flex flex-col items-center justify-center gap-3 border-2 border-dashed py-10 cursor-pointer transition-colors select-none
        ${dragging ? 'border-accent/60 bg-accent/5' : 'border-hairline hover:border-strong hover:bg-white/[0.015]'}
        ${loading ? 'pointer-events-none opacity-60' : ''}
      `}
    >
      <input ref={fileRef} type="file" accept=".eml,message/rfc822" className="sr-only" onChange={handleFile} />
      {loading ? (
        <><Loader2 size={28} className="animate-spin text-accent/50" /><span className="text-ui text-fg-secondary">Analysing…</span></>
      ) : (
        <>
          <Upload size={24} className="text-fg-secondary/40" />
          <div className="text-center">
            <p className="text-ui text-fg/70">Drop a <span className="font-mono text-accent">.eml</span> file here</p>
            <p className="text-label text-fg-secondary/50 mt-0.5">or click to browse</p>
          </div>
        </>
      )}
    </div>
  )

  // ── With active case: sidebar layout ──────────────────────────────────────
  if (caseId) {
    return (
      <PageShell
        route="/artifacts/email"
        title="Email Analysis"
        subtitle={currentCase?.title}
        meta={`${storedEmails.length} email${storedEmails.length > 1 ? 's' : ''}`}
        fullHeight
        asideLeft={(
          <aside className="w-64 shrink-0 border-r border-hairline bg-panel flex flex-col min-h-0 overflow-hidden">
          {/* Upload button */}
          <div className="px-3 py-2 border-b border-hairline shrink-0">
            <button
              onClick={() => fileRef.current?.click()}
              disabled={loading}
              className="w-full flex items-center justify-center gap-1.5 text-label py-1.5 rounded-control border border-dashed border-hairline text-fg-secondary hover:text-accent hover:border-accent/30 transition-colors disabled:opacity-40"
            >
              {loading ? <Loader2 size={11} className="animate-spin" /> : <Upload size={11} />}
              {loading ? 'Analysing…' : 'Upload .eml'}
            </button>
            <input ref={fileRef} type="file" accept=".eml,message/rfc822" className="sr-only" onChange={handleFile} />
          </div>

          {/* Email list */}
          <div className="flex-1 overflow-y-auto">
            {storedEmails.length === 0 && !loading && (
              <p className="text-label text-fg-secondary/30 text-center py-8 px-3">
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
          </aside>
        )}
      >
        <div className="h-full overflow-y-auto">
          {error && (
            <div className="m-4 flex items-center gap-2 text-ui text-severity-critical bg-severity-critical/10 border border-severity-critical/20 px-4 py-3">
              <AlertCircle size={14} />{error}
            </div>
          )}

          {!selectedEmailId && (
            <div className="p-6 space-y-4">
              <div className="flex items-center gap-2 text-label text-accent/70 bg-accent/5 border border-accent/15 px-3 py-2">
                <CheckCircle2 size={12} />
                Emails uploaded here are saved to case <span className="font-semibold text-accent">{currentCase?.title}</span>
                {existingIocs.length > 0 && (
                  <span className="text-fg-secondary/50 ml-1">— {existingIocs.length} IOC{existingIocs.length > 1 ? 's' : ''} already in case</span>
                )}
              </div>
              {/* Drop zone in empty state */}
              <div
                onDrop={handleDrop}
                onDragOver={e => { e.preventDefault(); setDragging(true) }}
                onDragLeave={() => setDragging(false)}
                className={`flex flex-col items-center justify-center gap-3 border-2 border-dashed py-20 transition-colors
                  ${dragging ? 'border-accent/60 bg-accent/5' : 'border-hairline'}
                `}
              >
                <Mail size={36} className="text-fg-secondary/20" />
                <p className="text-ui text-fg-secondary/40">Select an email from the sidebar, or drop a .eml file here</p>
              </div>
            </div>
          )}

          {selectedEmailId && loadingStored && (
            <div className="flex items-center justify-center py-20">
              <Loader2 size={24} className="animate-spin text-accent/40" />
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
      </PageShell>
    )
  }

  // ── Without active case: full-page stateless layout ────────────────────────
  return (
    <PageShell
      route="/artifacts/email"
      title="Email Analysis"
      subtitle="Parse headers, extract URLs and hash attachments"
    >
      <div className="max-w-6xl mx-auto space-y-6">

      <div className="flex items-center gap-2 text-label text-fg-secondary/60 bg-white/[0.02] border border-hairline px-3 py-2">
        <Info size={12} />
        No current case selected — emails won't be saved. Set a current case from the top bar to enable persistent storage.
      </div>

      {dropZone}

      {error && (
        <div className="flex items-center gap-2 text-ui text-severity-critical bg-severity-critical/10 border border-severity-critical/20 px-4 py-3">
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
    </PageShell>
  )
}
