import { useState } from 'react'
import { useMutation } from '@tanstack/react-query'
import { agentsApi } from '../../api/agents'
import type { AgentEvent, AgentEventKind } from '../../types'
import { fmtTimeOnly } from '../../utils/dateUtils'
import { ChevronDown, ChevronRight, Download, ShieldCheck } from '../../ui/icons'

const KIND_LABEL: Record<AgentEventKind, string> = {
  'message.user':  'analyst',
  'message.agent': 'answer',
  'thought':       'thought',
  'tool.call':     'tool call',
  'tool.result':   'tool result',
  'status':        'status',
  'error':         'error',
  'step':          'step',
  'task':          'task',
  'proposal':      'proposal',
  'finding':       'finding',
  'hypothesis':    'hypothesis',
  'approval':      'approval',
}

const KIND_TONE: Partial<Record<AgentEventKind, string>> = {
  'tool.call':   'text-agent-tool',
  'tool.result': 'text-agent-tool',
  'thought':     'text-fg-muted',
  'error':       'text-agent-error',
  'step':        'text-agent-thinking',
  'proposal':    'text-agent-waiting',
  'finding':     'text-agent-waiting',
  'hypothesis':  'text-agent-waiting',
  'approval':    'text-agent-waiting',
}

function summary(event: AgentEvent): string {
  const p = event.payload
  switch (event.kind) {
    case 'tool.call':   return `${String(p.tool)}(${JSON.stringify(p.arguments ?? {})})`
    case 'tool.result': return p.ok ? `${String(p.tool)} ok` : `${String(p.tool)}: ${String(p.error)}`
    case 'status':      return String(p.status)
    case 'error':       return String(p.message)
    case 'step':        return `${String(p.step)} -> ${String(p.next)}`
    case 'task':        return `${String(p.action)} ${String(p.task_kind)}: ${String(p.objective ?? '')}`
    case 'proposal':    return `${String(p.action)} ${String(p.summary ?? '')}`
    case 'approval':    return `${String(p.action)} ${String(p.summary ?? '')}`
    case 'hypothesis':  return `${String(p.action)} ${String(p.summary ?? '')}`
    case 'finding':     return `${String(p.action)} ${String(p.summary ?? '')}${p.verdict ? ` (${String(p.verdict)})` : ''}`
    default:            return String(p.text ?? '')
  }
}

function TraceRow({ event }: { event: AgentEvent }) {
  const [open, setOpen] = useState(false)
  const expandable = event.kind !== 'status'
  return (
    <div className="border-b border-hairline px-3 py-2">
      <button
        className="w-full flex items-start gap-2 text-left"
        onClick={() => expandable && setOpen(o => !o)}
      >
        <span className="w-4 shrink-0 text-fg-muted mt-1">
          {expandable && (open ? <ChevronDown size={12} /> : <ChevronRight size={12} />)}
        </span>
        <span className="text-label font-mono text-fg-muted shrink-0 w-8">{event.seq}</span>
        <span className="text-label font-mono text-fg-muted shrink-0">{fmtTimeOnly(event.created_at)}</span>
        <span className={`text-label font-mono uppercase shrink-0 ${KIND_TONE[event.kind] ?? 'text-fg-secondary'}`}>
          {KIND_LABEL[event.kind] ?? event.kind}
        </span>
        <span className="text-label text-fg-secondary truncate">{summary(event)}</span>
      </button>
      {open && (
        <pre className="mt-2 ml-6 p-2 bg-canvas border border-hairline text-label font-mono text-fg-secondary overflow-auto max-h-80 whitespace-pre-wrap break-all">
          {JSON.stringify(event.payload, null, 2)}
        </pre>
      )}
    </div>
  )
}

/** Every step the agents took, in order, with the hash-chain check. */
export default function AgentTracePanel({ caseId, events, connected }: {
  caseId: string; events: AgentEvent[]; connected: boolean
}) {
  const verify = useMutation({ mutationFn: () => agentsApi.verify(caseId) })
  // A file the chain can be checked from away from Remora: each line carries
  // its own hash and its predecessor's.
  const exportTrace = useMutation({
    mutationFn: () => agentsApi.exportTrace(caseId),
    onSuccess: blob => {
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = `agent-trace-${caseId.slice(0, 8)}.jsonl`
      a.click()
      URL.revokeObjectURL(url)
    },
  })

  return (
    <div className="flex flex-col h-full min-w-0">
      <div className="flex items-center gap-2 px-3 py-2 border-b border-hairline">
        <span className="text-label font-mono uppercase tracking-wider text-fg-muted">Trace</span>
        <span className={`w-2 h-2 rounded-pill ${connected ? 'bg-agent-thinking' : 'bg-agent-idle'}`}
              title={connected ? 'Live' : 'Reconnecting'} />
        <button className="btn-ghost text-label ml-auto flex items-center gap-1"
                title="Download the trace as JSON lines, with its hash chain"
                onClick={() => exportTrace.mutate()} disabled={exportTrace.isPending}>
          <Download size={14} /> Export
        </button>
        <button className="btn-ghost text-label flex items-center gap-1"
                onClick={() => verify.mutate()} disabled={verify.isPending}>
          <ShieldCheck size={14} /> Verify
        </button>
      </div>
      {verify.data && (
        <div className={`px-3 py-2 border-b border-hairline text-label ${
          verify.data.ok ? 'text-agent-thinking' : 'text-agent-error'}`}>
          {verify.data.ok
            ? `Chain intact over ${verify.data.events} event(s)`
            : `Chain broken at event ${verify.data.broken_at_seq}`}
        </div>
      )}
      <div className="flex-1 overflow-auto">
        {events.length === 0 && <p className="px-3 py-3 text-label text-fg-muted">No events yet.</p>}
        {events.map(event => <TraceRow key={event.id} event={event} />)}
      </div>
    </div>
  )
}
