import { useState } from 'react'
import type { Agent, AgentRole, LLMHealth } from '../../types'
import { Bot, Plus, Users } from '../../ui/icons'
import { AGENT_STATUS, BUSY_STATES } from './agentStatus'

interface Props {
  agents:      Agent[]
  roles:       AgentRole[]
  selectedId:  string | null
  onSelect:    (id: string) => void
  onAdd:       (roleId: string) => void
  onStaffTeam: () => void
  adding:      boolean
  health:      LLMHealth | undefined
}

/**
 * The team as a hierarchy: agents whose role reports to another role sit under
 * the agents of that role. Roles with no superior on the case are roots.
 */
function ordered(agents: Agent[], roles: AgentRole[]): { agent: Agent; depth: number }[] {
  const reportsTo = Object.fromEntries(roles.map(r => [r.id, r.reports_to]))
  const present = new Set(agents.map(a => a.role))
  const isRoot = (a: Agent) => !reportsTo[a.role] || !present.has(reportsTo[a.role] as string)
  const out: { agent: Agent; depth: number }[] = []
  const visit = (agent: Agent, depth: number) => {
    out.push({ agent, depth })
    for (const child of agents.filter(a => !isRoot(a) && reportsTo[a.role] === agent.role)) {
      if (!out.some(o => o.agent.id === child.id)) visit(child, depth + 1)
    }
  }
  agents.filter(isRoot).forEach(a => visit(a, 0))
  return out
}

/** Left padding per hierarchy level, from the spacing scale. */
const INDENT = ['pl-3', 'pl-8', 'pl-12']

function AgentRow({ agent, depth, selected, onSelect }: {
  agent: Agent; depth: number; selected: boolean; onSelect: () => void
}) {
  const state = AGENT_STATUS[agent.status] ?? AGENT_STATUS.idle
  return (
    <button
      onClick={onSelect}
      className={`w-full text-left pr-3 py-2 border-b border-hairline transition-colors ${
        INDENT[Math.min(depth, INDENT.length - 1)]} ${
        selected ? 'bg-hover border-l-2 border-l-accent' : 'hover:bg-hover'}`}
    >
      <div className="flex items-center gap-2">
        <Bot size={16} className="text-fg-secondary shrink-0" />
        <span className="text-ui text-fg font-medium truncate">{agent.name}</span>
      </div>
      <div className="flex items-center gap-2 mt-1">
        <span className={`w-2 h-2 rounded-pill ${state.dot} ${BUSY_STATES.has(agent.status) ? 'animate-pulse' : ''}`} />
        <span className={`text-label ${state.text}`}>{state.label}</span>
      </div>
      <div className="text-label font-mono text-fg-muted mt-1 truncate">{agent.role} · {agent.model}</div>
    </button>
  )
}

export default function AgentList({ agents, roles, selectedId, onSelect, onAdd, onStaffTeam,
                                    adding, health }: Props) {
  const [role, setRole] = useState('assistant')
  const modelMissing = health?.reachable && !health.models.some(m => m.name === health.default_model)

  return (
    <div className="flex flex-col h-full">
      <div className="px-3 py-2 border-b border-hairline space-y-2">
        <div className="flex items-center justify-between">
          <span className="text-label font-mono uppercase tracking-wider text-fg-muted">Team</span>
          <button className="btn-ghost text-label flex items-center gap-1" onClick={onStaffTeam} disabled={adding}
                  title="The team for this kind of incident, chosen from the case's tags and description">
            <Users size={14} /> Staff team
          </button>
        </div>
        <div className="flex items-center gap-1">
          <select className="input flex-1 min-w-0" value={role} onChange={e => setRole(e.target.value)}>
            {roles.map(r => <option key={r.id} value={r.id}>{r.name}</option>)}
          </select>
          <button className="btn-secondary text-label flex items-center gap-1" onClick={() => onAdd(role)}
                  disabled={adding}>
            <Plus size={14} /> Add
          </button>
        </div>
      </div>

      <div className="flex-1 overflow-auto">
        {ordered(agents, roles).map(({ agent, depth }) => (
          <AgentRow key={agent.id} agent={agent} depth={depth} selected={agent.id === selectedId}
                    onSelect={() => onSelect(agent.id)} />
        ))}
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
