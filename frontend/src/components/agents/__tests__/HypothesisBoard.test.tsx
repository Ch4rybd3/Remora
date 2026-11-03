import { beforeEach, describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import type { ReactNode } from 'react'
import HypothesisBoard from '../HypothesisBoard'
import TaskBoard from '../TaskBoard'
import type { Agent, AgentFinding, AgentHypothesis, AgentTask } from '../../../types'

const api = vi.hoisted(() => ({
  hypotheses: vi.fn(), findings: vi.fn(), createHypothesis: vi.fn(), updateHypothesis: vi.fn(),
  linkHypothesis: vi.fn(), unlinkHypothesis: vi.fn(),
}))
vi.mock('../../../api/agents', () => ({ agentsApi: api }))

const finding = { id: 'f1', ref: 1, title: 'RDP logon from 10.1.2.3', state: 'validated' } as AgentFinding
const h1: AgentHypothesis = {
  id: 'h1', ref: 1, statement: 'An outsider used svc_backup over RDP.', state: 'open',
  created_by: 'Incident Leader', decided_by: null, created_at: '2026-11-08T10:00:00Z',
  links: [{ finding_id: 'f1', finding_ref: 1, stance: 'for', note: 'Unknown host', set_by: 'Incident Leader' }],
}
const h2: AgentHypothesis = { ...h1, id: 'h2', ref: 2, statement: 'Maintenance by an administrator.', links: [] }

function wrap(children: ReactNode) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return <QueryClientProvider client={qc}>{children}</QueryClientProvider>
}

describe('HypothesisBoard', () => {
  beforeEach(() => {
    api.hypotheses.mockResolvedValue([h1, h2])
    api.findings.mockResolvedValue([finding])
    api.linkHypothesis.mockResolvedValue(h2)
    api.unlinkHypothesis.mockResolvedValue(h1)
  })

  it('shows each hypothesis against each finding, and counts what is against it', async () => {
    render(wrap(<HypothesisBoard caseId="c1" />))
    expect(await screen.findByText('An outsider used svc_backup over RDP.')).toBeInTheDocument()
    expect(screen.getByText('F1')).toBeInTheDocument()
    expect(screen.getByText('+')).toBeInTheDocument()
  })

  it('walks a cell through for, against, neutral, then clears it', async () => {
    render(wrap(<HypothesisBoard caseId="c1" />))
    await screen.findByText('Maintenance by an administrator.')
    fireEvent.click(screen.getByText('?'))
    await waitFor(() => expect(api.linkHypothesis).toHaveBeenCalledWith('c1', 'h2', 'f1', 'for'))
    fireEvent.click(screen.getByText('+'))
    await waitFor(() => expect(api.linkHypothesis).toHaveBeenCalledWith('c1', 'h1', 'f1', 'against'))
  })
})

describe('TaskBoard controls', () => {
  const agent = { id: 'a1', name: 'Windows host analyst' } as Agent
  const task = (status: AgentTask['status']) => ({
    id: `t-${status}`, agent_id: 'a1', objective: `objective ${status}`, status, max_steps: 30,
    steps_used: 3, tokens_in: 0, tokens_out: 0, cost_usd: 0, error: null, kind: 'assigned',
    process_id: 'analyst-investigation', current_step: 'execute', parent_task_id: null, depends_on: [],
    report: null, created_at: '2026-11-08T10:00:00Z', started_at: null, finished_at: null,
  }) as AgentTask

  it('pauses a running task and resumes a paused one with instructions', () => {
    const onPause = vi.fn()
    const onResume = vi.fn()
    render(<TaskBoard agents={[agent]} tasks={[task('running'), task('paused')]}
                      onPause={onPause} onResume={onResume} />)
    expect(screen.getByText('paused at execute')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: /pause/i }))
    expect(onPause).toHaveBeenCalledWith(expect.objectContaining({ id: 't-running' }))
    fireEvent.change(screen.getByPlaceholderText(/instructions for the agent/i),
                     { target: { value: 'Only svc_backup' } })
    fireEvent.click(screen.getByRole('button', { name: /resume/i }))
    expect(onResume).toHaveBeenCalledWith(expect.objectContaining({ id: 't-paused' }), 'Only svc_backup')
  })
})
