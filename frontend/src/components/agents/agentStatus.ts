import type { AgentStatus } from '../../types'

/** Label and colour classes per agent state. Colours come from the agent tokens. */
export const AGENT_STATUS: Record<AgentStatus, { label: string; dot: string; text: string }> = {
  idle:     { label: 'Idle',          dot: 'bg-agent-idle',     text: 'text-agent-idle' },
  thinking: { label: 'Thinking',      dot: 'bg-agent-thinking', text: 'text-agent-thinking' },
  tool:     { label: 'Running a tool', dot: 'bg-agent-tool',    text: 'text-agent-tool' },
  waiting:  { label: 'Waiting on you', dot: 'bg-agent-waiting', text: 'text-agent-waiting' },
  blocked:  { label: 'Blocked',       dot: 'bg-agent-blocked',  text: 'text-agent-blocked' },
  error:    { label: 'Error',         dot: 'bg-agent-error',    text: 'text-agent-error' },
}

export const BUSY_STATES = new Set<AgentStatus>(['thinking', 'tool'])
