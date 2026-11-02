import { beforeEach, describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { MemoryRouter } from 'react-router-dom'
import type { ReactNode } from 'react'
import FindingsBoard, { observationLink } from '../FindingsBoard'
import type { Agent, AgentFinding } from '../../../types'

const api = vi.hoisted(() => ({
  findings: vi.fn(),
  validateFinding: vi.fn(),
  rejectFinding: vi.fn(),
}))
vi.mock('../../../api/agents', () => ({ agentsApi: api }))

const agent: Agent = {
  id: 'a1', case_id: 'c1', role: 'analyst-windows', name: 'Windows host analyst', provider: 'ollama',
  model: 'qwen3:8b', status: 'idle', launched_by: 'admin',
  created_at: '2026-11-04T10:00:00Z', updated_at: '2026-11-04T10:00:00Z',
}

const observation = {
  id: 'o1', case_id: 'c1', agent_id: 'a1', task_id: 't1', artifact_id: 'art1',
  artifact_name: 'Security.csv', artifact_label: 'Event logs', locator: 'EventRecordId = 4512',
  row: { EventRecordId: '4512', LogonType: '10', IpAddress: '10.1.2.3' },
  note: 'RDP logon from 10.1.2.3', available: true, created_at: '2026-11-04T10:00:00Z',
}

const finding: AgentFinding = {
  id: 'f1', case_id: 'c1', agent_id: 'a1', task_id: 't1', ref: 1,
  title: 'RDP logon on DC01 from 10.1.2.3', statement: 'An interactive RDP logon came from 10.1.2.3.',
  severity: 'high', confidence: 'high', confidence_reason: 'LogonType 10',
  attack_ids: ['T1021.001'], observations: [observation], state: 'proposed',
  review_task_id: 'r1', review_verdict: 'unsupported',
  review_comment: 'The cited row does not name the host; DC01 is assumed.',
  review_alternatives: 'Any collected host', reviewed_by: 'Reviewer',
  decided_by: null, decided_at: null, decision_comment: null, created_at: '2026-11-04T10:00:00Z',
}

function wrap(children: ReactNode) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return <QueryClientProvider client={qc}><MemoryRouter>{children}</MemoryRouter></QueryClientProvider>
}

describe('FindingsBoard', () => {
  beforeEach(() => {
    api.findings.mockResolvedValue([finding])
    api.validateFinding.mockResolvedValue({ ...finding, state: 'validated' })
    api.rejectFinding.mockResolvedValue({ ...finding, state: 'rejected' })
  })

  it('shows the claim, its cited row and the reviewer verdict', async () => {
    render(wrap(<FindingsBoard caseId="c1" agents={[agent]} />))
    expect(await screen.findByText('RDP logon on DC01 from 10.1.2.3')).toBeInTheDocument()
    expect(screen.getByText('EventRecordId = 4512')).toBeInTheDocument()
    expect(screen.getByText(/Reviewer \(Reviewer\): unsupported/)).toBeInTheDocument()
    expect(screen.getByText(/DC01 is assumed/)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /open row/i })).toBeInTheDocument()
  })

  it('sends the comment back with a rejection', async () => {
    render(wrap(<FindingsBoard caseId="c1" agents={[agent]} />))
    await screen.findByText('RDP logon on DC01 from 10.1.2.3')
    fireEvent.change(screen.getByPlaceholderText(/comment for the agent/i),
                     { target: { value: 'Agree with the reviewer' } })
    fireEvent.click(screen.getByRole('button', { name: /reject/i }))
    await waitFor(() => expect(api.rejectFinding).toHaveBeenCalledWith('c1', 'f1', 'Agree with the reviewer'))
  })

  it('links a citation to the Explorer by observation', () => {
    expect(observationLink(observation)).toBe('/artifacts/explorer?observation=o1')
  })
})
