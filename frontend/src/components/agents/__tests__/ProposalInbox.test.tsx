import { beforeEach, describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import type { ReactNode } from 'react'
import ProposalInbox from '../ProposalInbox'
import TaskBoard from '../TaskBoard'
import type { Agent, AgentProposal, AgentTask } from '../../../types'

const api = vi.hoisted(() => ({
  proposals: vi.fn(),
  accept: vi.fn(),
  reject: vi.fn(),
}))
vi.mock('../../../api/agents', () => ({ agentsApi: api }))

const agent: Agent = {
  id: 'a1', case_id: 'c1', role: 'analyst-windows', name: 'Windows host analyst', provider: 'ollama',
  model: 'qwen3:8b', status: 'idle', launched_by: 'admin', auto_start: false,
  created_at: '2026-11-03T10:00:00Z', updated_at: '2026-11-03T10:00:00Z',
}

const proposal: AgentProposal = {
  id: 'p1', case_id: 'c1', agent_id: 'a1', task_id: 't1', kind: 'ioc',
  payload: { type: 'ip', value: '10.1.2.3', description: 'RDP source', confidence: 'high' },
  rationale: 'Source of the RDP logon',
  evidence: ['Security.evtx EventRecordId 4512, 2024-03-02 10:14:07Z'],
  state: 'proposed', decided_by: null, decided_at: null, decision_comment: null, result_id: null,
  created_at: '2026-11-03T10:00:00Z',
}

function wrap(children: ReactNode) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return <QueryClientProvider client={qc}>{children}</QueryClientProvider>
}

describe('ProposalInbox', () => {
  beforeEach(() => {
    api.proposals.mockResolvedValue([proposal])
    api.accept.mockResolvedValue({ ...proposal, state: 'accepted' })
    api.reject.mockResolvedValue({ ...proposal, state: 'rejected' })
  })

  it('shows what is proposed, why, and on which evidence', async () => {
    render(wrap(<ProposalInbox caseId="c1" agents={[agent]} />))
    expect(await screen.findByText('ip · 10.1.2.3')).toBeInTheDocument()
    expect(screen.getByText(/Source of the RDP logon/)).toBeInTheDocument()
    expect(screen.getByText('Security.evtx EventRecordId 4512, 2024-03-02 10:14:07Z')).toBeInTheDocument()
  })

  it('accepts with only the fields the analyst changed', async () => {
    render(wrap(<ProposalInbox caseId="c1" agents={[agent]} />))
    await screen.findByText('ip · 10.1.2.3')
    fireEvent.click(screen.getByRole('button', { name: /edit/i }))
    const fields = screen.getAllByRole('textbox')
    fireEvent.change(fields.find(f => (f as HTMLTextAreaElement).value === 'RDP source')!,
                     { target: { value: 'RDP source, confirmed' } })
    fireEvent.click(screen.getByRole('button', { name: /accept/i }))
    await waitFor(() => expect(api.accept).toHaveBeenCalledWith(
      'c1', 'p1', { description: 'RDP source, confirmed' }, ''))
  })

  it('sends the comment back with a rejection', async () => {
    render(wrap(<ProposalInbox caseId="c1" agents={[agent]} />))
    await screen.findByText('ip · 10.1.2.3')
    fireEvent.change(screen.getByPlaceholderText(/comment for the agent/i),
                     { target: { value: 'Internal scanner' } })
    fireEvent.click(screen.getByRole('button', { name: /reject/i }))
    await waitFor(() => expect(api.reject).toHaveBeenCalledWith('c1', 'p1', 'Internal scanner'))
  })
})

describe('TaskBoard', () => {
  it('puts each task in the column of its state', () => {
    const task = (id: string, status: AgentTask['status']): AgentTask => ({
      id, agent_id: 'a1', objective: `objective ${id}`, status, max_steps: 30, steps_used: 3,
      tokens_in: 0, tokens_out: 0, error: null, kind: 'assigned', process_id: 'analyst-investigation',
      current_step: 'execute', parent_task_id: null, depends_on: [], report: null,
      created_at: '2026-11-03T10:00:00Z', started_at: null, finished_at: null,
    })
    render(<TaskBoard agents={[agent]}
                      tasks={[task('t1', 'pending'), task('t2', 'running'), task('t3', 'cancelled')]} />)
    expect(screen.getByText('objective t1')).toBeInTheDocument()
    expect(screen.getByText('execute')).toBeInTheDocument()
    expect(screen.getByText('Stopped').parentElement?.parentElement?.textContent).toContain('objective t3')
  })
})
