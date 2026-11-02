import { describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen } from '@testing-library/react'
import AgentChat from '../AgentChat'
import { AGENT_STATUS } from '../agentStatus'
import type { Agent, AgentEvent, AgentStatus, AgentTask } from '../../../types'

const agent: Agent = {
  id: 'a1', case_id: 'c1', role: 'assistant', name: 'Case assistant', provider: 'ollama',
  model: 'qwen3:8b', status: 'idle', launched_by: 'admin',
  created_at: '2026-11-02T10:00:00Z', updated_at: '2026-11-02T10:00:00Z',
}

function event(seq: number, kind: AgentEvent['kind'], payload: Record<string, unknown>): AgentEvent {
  return {
    id: `e${seq}`, case_id: 'c1', agent_id: 'a1', task_id: 't1', seq, kind, payload,
    actor: kind === 'message.user' ? 'admin' : 'Case assistant', hash: 'h',
    created_at: '2026-11-02T10:00:00Z',
  }
}

describe('AgentChat', () => {
  it('renders agent text as text, never as markup', () => {
    render(<AgentChat agent={agent} openTask={undefined} sending={false}
                      onSend={vi.fn()} onCancel={vi.fn()}
                      events={[event(1, 'message.agent', { text: '<img src=x onerror=alert(1)>' })]} />)
    expect(screen.getByText('<img src=x onerror=alert(1)>')).toBeInTheDocument()
    expect(document.querySelector('img')).toBeNull()
  })

  it('shows tool calls and errors inline with the conversation', () => {
    render(<AgentChat agent={agent} openTask={undefined} sending={false}
                      onSend={vi.fn()} onCancel={vi.fn()}
                      events={[
                        event(1, 'message.user', { text: 'What is here?' }),
                        event(2, 'tool.call', { tool: 'case_overview', arguments: {} }),
                        event(3, 'error', { message: 'Ollama is unreachable', reason: 'provider' }),
                      ]} />)
    expect(screen.getByText('What is here?')).toBeInTheDocument()
    expect(screen.getByText('case_overview')).toBeInTheDocument()
    expect(screen.getByText('Ollama is unreachable')).toBeInTheDocument()
  })

  it('sends on Enter and offers Stop while a task is open', () => {
    const onSend = vi.fn()
    const onCancel = vi.fn()
    const { rerender } = render(
      <AgentChat agent={agent} events={[]} openTask={undefined} sending={false}
                 onSend={onSend} onCancel={onCancel} />)
    const box = screen.getByRole('textbox')
    fireEvent.change(box, { target: { value: 'Any logons?' } })
    fireEvent.keyDown(box, { key: 'Enter' })
    expect(onSend).toHaveBeenCalledWith('Any logons?')

    const task = { id: 't1', agent_id: 'a1', status: 'running' } as AgentTask
    rerender(<AgentChat agent={agent} events={[]} openTask={task} sending={false}
                        onSend={onSend} onCancel={onCancel} />)
    fireEvent.click(screen.getByRole('button', { name: /stop/i }))
    expect(onCancel).toHaveBeenCalledWith(task)
  })
})

describe('AGENT_STATUS', () => {
  it('describes every state the backend can report', () => {
    const states: AgentStatus[] = ['idle', 'thinking', 'tool', 'waiting', 'blocked', 'error']
    expect(Object.keys(AGENT_STATUS).sort()).toEqual([...states].sort())
    for (const state of states) expect(AGENT_STATUS[state].dot).toMatch(/^bg-agent-/)
  })
})
