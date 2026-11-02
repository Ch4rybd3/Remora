import api from './client'
import type { Agent, AgentEvent, AgentProposal, AgentProposalState, AgentRole, AgentTask, LLMHealth } from '../types'

export const agentsApi = {
  list: (caseId: string) =>
    api.get<Agent[]>(`/cases/${caseId}/agents/`).then(r => r.data),
  create: (caseId: string, data: { name?: string; role?: string; model?: string } = {}) =>
    api.post<Agent>(`/cases/${caseId}/agents/`, data).then(r => r.data),
  update: (caseId: string, agentId: string, data: { name?: string; model?: string }) =>
    api.patch<Agent>(`/cases/${caseId}/agents/${agentId}`, data).then(r => r.data),
  send: (caseId: string, agentId: string, content: string) =>
    api.post<AgentTask>(`/cases/${caseId}/agents/${agentId}/messages`, { content }).then(r => r.data),
  cancel: (caseId: string, agentId: string, taskId: string) =>
    api.post<AgentTask>(`/cases/${caseId}/agents/${agentId}/tasks/${taskId}/cancel`).then(r => r.data),
  tasks: (caseId: string, agentId?: string) =>
    api.get<AgentTask[]>(`/cases/${caseId}/agents/tasks`, { params: { agent_id: agentId } }).then(r => r.data),
  events: (caseId: string, afterSeq = 0) =>
    api.get<AgentEvent[]>(`/cases/${caseId}/agents/events`, { params: { after_seq: afterSeq } }).then(r => r.data),
  verify: (caseId: string) =>
    api.get<{ ok: boolean; events: number; broken_at_seq: number | null }>(
      `/cases/${caseId}/agents/events/verify`).then(r => r.data),
  health: () => api.get<LLMHealth>('/agents/llm/health').then(r => r.data),
  roles: () => api.get<AgentRole[]>('/agents/roles').then(r => r.data),
  staffTeam: (caseId: string) =>
    api.post<Agent[]>(`/cases/${caseId}/agents/team`).then(r => r.data),
  proposals: (caseId: string, state?: AgentProposalState) =>
    api.get<AgentProposal[]>(`/cases/${caseId}/agents/proposals`, { params: { state } }).then(r => r.data),
  accept: (caseId: string, proposalId: string, payload?: Record<string, unknown>, comment?: string) =>
    api.post<AgentProposal>(`/cases/${caseId}/agents/proposals/${proposalId}/accept`,
      { payload: payload ?? null, comment: comment ?? null }).then(r => r.data),
  reject: (caseId: string, proposalId: string, comment?: string) =>
    api.post<AgentProposal>(`/cases/${caseId}/agents/proposals/${proposalId}/reject`,
      { comment: comment ?? null }).then(r => r.data),
}

export const featuresApi = {
  /** Optional modules. A role that cannot read this sees none of them. */
  get: () =>
    api.get<{ charybdis: boolean }>('/features')
      .then(r => r.data)
      .catch(() => ({ charybdis: false })),
}
