import type { Agent, LLMHealth } from '../../types'
import { Bot, Plus } from '../../ui/icons'
import { AGENT_STATUS, BUSY_STATES } from './agentStatus'

interface Props {
  agents:     Agent[]
  selectedId: string | null
  onSelect:   (id: string) => void
  onAdd:      () => void
  adding:     boolean
  health:     LLMHealth | undefined
}

/**
 * The team, one card per agent. S31 replaces this column with the org chart
 * once there is a hierarchy to draw.
 */
export default function AgentList({ agents, selectedId, onSelect, onAdd, adding, health }: Props) {
  const modelMissing = health?.reachable
    && !health.models.some(m => m.name === health.default_model)

  return (
    <div className="flex flex-col h-full">
      <div className="flex items-center justify-between px-3 py-2 border-b border-hairline">
        <span className="text-label font-mono uppercase tracking-wider text-fg-muted">Team</span>
        <button className="btn-ghost text-label flex items-center gap-1" onClick={onAdd} disabled={adding}>
          <Plus size={14} /> Agent
        </button>
      </div>

      <div className="flex-1 overflow-auto">
        {agents.map(agent => {
          const state = AGENT_STATUS[agent.status] ?? AGENT_STATUS.idle
          const selected = agent.id === selectedId
          return (
            <button
              key={agent.id}
              onClick={() => onSelect(agent.id)}
              className={`w-full text-left px-3 py-2 border-b border-hairline transition-colors ${
                selected ? 'bg-hover border-l-2 border-l-accent' : 'hover:bg-hover'}`}
            >
              <div className="flex items-center gap-2">
                <Bot size={16} className="text-fg-secondary shrink-0" />
                <span className="text-ui text-fg font-medium truncate">{agent.name}</span>
              </div>
              <div className="flex items-center gap-2 mt-1">
                <span className={`w-2 h-2 rounded-pill ${state.dot} ${
                  BUSY_STATES.has(agent.status) ? 'animate-pulse' : ''}`} />
                <span className={`text-label ${state.text}`}>{state.label}</span>
              </div>
              <div className="text-label font-mono text-fg-muted mt-1 truncate">
                {agent.provider} · {agent.model}
              </div>
            </button>
          )
        })}
      </div>

      <div className="px-3 py-2 border-t border-hairline text-label">
        {health === undefined && <span className="text-fg-muted">Checking the model provider…</span>}
        {health && !health.reachable && (
          <span className="text-agent-error">{health.detail || 'The model provider is unreachable'}</span>
        )}
        {health?.reachable && !modelMissing && (
          <span className="text-fg-muted">
            <span className="font-mono">{health.provider}</span> reachable, {health.models.length} model(s)
          </span>
        )}
        {modelMissing && (
          <span className="text-agent-waiting">
            Model <span className="font-mono">{health?.default_model}</span> is not pulled.
            Run <span className="font-mono">ollama pull {health?.default_model}</span> on the host.
          </span>
        )}
      </div>
    </div>
  )
}
