import { useEffect, useRef, useState } from 'react'
import type { Agent, AgentEvent, AgentTask } from '../../types'
import { fmtDateTime } from '../../utils/dateUtils'
import { AlertTriangle, ClipboardCheck, ExternalLink, Lightbulb, Send, Square, Wrench } from '../../ui/icons'

interface Props {
  agent:     Agent
  events:    AgentEvent[]
  openTask:  AgentTask | undefined
  sending:   boolean
  onSend:    (content: string) => void
  onCancel:  (task: AgentTask) => void
  /** Incident Leader only: start the tasks it proposes without approval. */
  onAutoStart?: (on: boolean) => void
  /** Providers the agent may be moved to; the case's TLP still decides at each call. */
  providers?: string[]
  onProvider?: (provider: string) => void
}

const CHAT_KINDS = new Set<AgentEvent['kind']>([
  'message.user', 'message.agent', 'error', 'tool.call', 'step', 'proposal', 'finding', 'approval',
])

function text(event: AgentEvent, key = 'text'): string {
  const value = event.payload[key]
  return typeof value === 'string' ? value : ''
}

/**
 * The conversation with one agent. Agent text is rendered as plain text, never
 * as HTML or Markdown: it quotes artifact content, which is attacker-controlled.
 */
export default function AgentChat({ agent, events, openTask, sending, onSend, onCancel, onAutoStart,
                                    providers, onProvider }: Props) {
  const [draft, setDraft] = useState('')
  const bottom = useRef<HTMLDivElement>(null)

  const lines = events.filter(e => CHAT_KINDS.has(e.kind))

  useEffect(() => { bottom.current?.scrollIntoView({ block: 'end' }) }, [lines.length])

  const busy = openTask !== undefined
  const submit = () => {
    const content = draft.trim()
    if (!content || busy) return
    onSend(content)
    setDraft('')
  }

  return (
    <div className="flex flex-col h-full min-w-0">
      <div className="flex items-baseline gap-2 px-4 py-2 border-b border-hairline">
        <h2 className="text-title font-semibold text-fg truncate">{agent.name}</h2>
        {providers && onProvider && providers.length > 1 ? (
          <select className="input py-0 text-label font-mono" value={agent.provider}
                  title="Where this agent's model runs. A cloud provider is refused on TLP:RED and AMBER+STRICT cases."
                  onChange={e => onProvider(e.target.value)}>
            {providers.map(p => <option key={p} value={p}>{p}</option>)}
          </select>
        ) : (
          <span className="text-label font-mono text-fg-muted">{agent.provider}</span>
        )}
        <span className="text-label font-mono text-fg-muted">{agent.model}</span>
        {onAutoStart && (
          <label className="ml-auto flex items-center gap-2 text-label text-fg-secondary"
                 title="The tasks this leader proposes start at once, without waiting for your approval. Findings, indicators and report text still wait for you.">
            <input type="checkbox" checked={agent.auto_start}
                   onChange={e => onAutoStart(e.target.checked)} />
            Auto-start its tasks
          </label>
        )}
      </div>

      <div className="flex-1 overflow-auto px-4 py-3 space-y-3">
        {lines.length === 0 && (
          <p className="text-ui text-fg-muted">
            Ask about the case. The agent reads its ingested artifacts with read-only tools,
            and every step it takes appears in the trace.
          </p>
        )}
        {lines.map(event => {
          if (event.kind === 'tool.call') {
            return (
              <div key={event.id} className="flex items-center gap-2 text-label text-fg-muted">
                <Wrench size={12} />
                <span className="font-mono">{text(event, 'tool')}</span>
              </div>
            )
          }
          if (event.kind === 'step') {
            return (
              <div key={event.id} className="border-l-2 border-agent-thinking/40 pl-3 text-ui text-fg-secondary">
                <span className="text-label font-mono text-agent-thinking">{text(event, 'step')} done</span>
                <p className="whitespace-pre-wrap">{text(event, 'summary')}</p>
              </div>
            )
          }
          if (event.kind === 'proposal') {
            return (
              <div key={event.id} className="flex items-center gap-2 text-label text-agent-waiting">
                <ClipboardCheck size={12} />
                <span>{text(event, 'action')}: {text(event, 'summary')}</span>
              </div>
            )
          }
          if (event.kind === 'approval') {
            const comment = text(event, 'comment')
            return (
              <div key={event.id} className="flex items-center gap-2 text-label text-agent-waiting">
                <ExternalLink size={12} />
                <span>
                  {text(event, 'action') === 'requested' ? 'Waiting for your approval' : `${event.actor} ${text(event, 'action')}`}
                  : {text(event, 'summary')}{comment ? ` (${comment})` : ''}
                </span>
              </div>
            )
          }
          if (event.kind === 'finding') {
            const verdict = text(event, 'verdict')
            return (
              <div key={event.id} className="flex items-center gap-2 text-label text-agent-waiting">
                <Lightbulb size={12} />
                <span>
                  {event.actor} {text(event, 'action').replace('_', ' ')}: {text(event, 'summary')}
                  {verdict ? ` (${verdict})` : ''}
                </span>
              </div>
            )
          }
          if (event.kind === 'error') {
            return (
              <div key={event.id} className="flex items-start gap-2 text-ui text-agent-error">
                <AlertTriangle size={14} className="mt-1 shrink-0" />
                <span className="whitespace-pre-wrap">{text(event, 'message')}</span>
              </div>
            )
          }
          const mine = event.kind === 'message.user'
          return (
            <div key={event.id} className={`flex flex-col ${mine ? 'items-end' : 'items-start'}`}>
              <div className={`max-w-3xl px-3 py-2 border text-prose whitespace-pre-wrap break-words ${
                mine ? 'border-accent/30 bg-accent/5 text-fg' : 'border-hairline bg-panel text-fg'}`}>
                {text(event)}
              </div>
              <span className="text-label font-mono text-fg-muted mt-1">
                {event.actor} · {fmtDateTime(event.created_at)}
              </span>
            </div>
          )
        })}
        <div ref={bottom} />
      </div>

      <div className="border-t border-hairline p-3">
        <div className="flex items-end gap-2">
          <textarea
            className="input flex-1 resize-none font-sans"
            rows={2}
            placeholder={busy ? 'The agent is working…' : 'Ask the agent (Enter to send, Shift+Enter for a new line)'}
            value={draft}
            disabled={busy}
            onChange={e => setDraft(e.target.value)}
            onKeyDown={e => {
              if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); submit() }
            }}
          />
          {busy ? (
            <button className="btn-secondary flex items-center gap-1" onClick={() => onCancel(openTask)}>
              <Square size={14} /> Stop
            </button>
          ) : (
            <button className="btn-primary flex items-center gap-1" onClick={submit}
                    disabled={sending || !draft.trim()}>
              <Send size={14} /> Send
            </button>
          )}
        </div>
      </div>
    </div>
  )
}
