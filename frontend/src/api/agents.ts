import api from './client'
import type {
  Agent, AgentAttention, AgentEvent, AgentHypothesis, BenchCase, BenchRun, HypothesisStance, AgentProvider, AgentProviderWrite, CaseUsage, RoleModel, AgentFinding, AgentFindingState, AgentObservation, AgentProposal,
  AgentProposalState, AgentRole, AgentTask, LLMHealth,
} from '../types'

export const agentsApi = {
  list: (caseId: string) =>
    api.get<Agent[]>(`/cases/${caseId}/agents/`).then(r => r.data),
  create: (caseId: string, data: { name?: string; role?: string; model?: string } = {}) =>
    api.post<Agent>(`/cases/${caseId}/agents/`, data).then(r => r.data),
  update: (caseId: string, agentId: string,
           data: { name?: string; model?: string; provider?: string; auto_start?: boolean }) =>
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
  /** The whole trace as JSON lines, with each event's hash and its predecessor's. */
  exportTrace: (caseId: string) =>
    api.get<Blob>(`/cases/${caseId}/agents/events/export`, { responseType: 'blob' }).then(r => r.data),
  health: (provider = 'ollama') =>
    api.get<LLMHealth>('/agents/llm/health', { params: { provider } }).then(r => r.data),
  providers: () => api.get<AgentProvider[]>('/agents/providers').then(r => r.data),
  createProvider: (data: AgentProviderWrite) =>
    api.post<AgentProvider>('/agents/providers', data).then(r => r.data),
  updateProvider: (id: string, data: AgentProviderWrite) =>
    api.patch<AgentProvider>(`/agents/providers/${id}`, data).then(r => r.data),
  deleteProvider: (id: string) => api.delete(`/agents/providers/${id}`),
  roleModels: () => api.get<RoleModel[]>('/agents/role-models').then(r => r.data),
  setRoleModel: (role: string, provider: string, model: string) =>
    api.put<RoleModel>(`/agents/role-models/${role}`, { provider, model }).then(r => r.data),
  clearRoleModel: (role: string) => api.delete(`/agents/role-models/${role}`),
  usage: (caseId: string) => api.get<CaseUsage>(`/cases/${caseId}/agents/usage`).then(r => r.data),
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
  findings: (caseId: string, state?: AgentFindingState) =>
    api.get<AgentFinding[]>(`/cases/${caseId}/agents/findings`, { params: { state } }).then(r => r.data),
  validateFinding: (caseId: string, findingId: string, comment?: string) =>
    api.post<AgentFinding>(`/cases/${caseId}/agents/findings/${findingId}/validate`,
      { comment: comment ?? null }).then(r => r.data),
  rejectFinding: (caseId: string, findingId: string, comment?: string) =>
    api.post<AgentFinding>(`/cases/${caseId}/agents/findings/${findingId}/reject`,
      { comment: comment ?? null }).then(r => r.data),
  attention: (caseId: string) =>
    api.get<AgentAttention>(`/cases/${caseId}/agents/attention`).then(r => r.data),
  /** A question about one object, to the case assistant. The answer arrives in the Team tab. */
  ask: (caseId: string, data: { question: string; about: string; context: Record<string, unknown> }) =>
    api.post<{ agent_id: string; agent_name: string; task_id: string }>(
      `/cases/${caseId}/agents/ask`, data).then(r => r.data),
  /** The RQL a question in words would run on one table. Checked, never run. */
  rqlDraft: (caseId: string, artifactId: string, question: string) =>
    api.post<{ rql: string; explanation: string }>(`/cases/${caseId}/agents/rql-draft`,
      { artifact_id: artifactId, question }).then(r => r.data),
  pause: (caseId: string, agentId: string, taskId: string) =>
    api.post<AgentTask>(`/cases/${caseId}/agents/${agentId}/tasks/${taskId}/pause`).then(r => r.data),
  /** Hand a paused task back; `note` is read by the agent before its next step. */
  resume: (caseId: string, agentId: string, taskId: string, note = '') =>
    api.post<AgentTask>(`/cases/${caseId}/agents/${agentId}/tasks/${taskId}/resume`, { note }).then(r => r.data),
  hypotheses: (caseId: string) =>
    api.get<AgentHypothesis[]>(`/cases/${caseId}/agents/hypotheses`).then(r => r.data),
  createHypothesis: (caseId: string, statement: string) =>
    api.post<AgentHypothesis>(`/cases/${caseId}/agents/hypotheses`, { statement }).then(r => r.data),
  updateHypothesis: (caseId: string, id: string, data: { statement?: string; state?: AgentHypothesis['state'] }) =>
    api.patch<AgentHypothesis>(`/cases/${caseId}/agents/hypotheses/${id}`, data).then(r => r.data),
  linkHypothesis: (caseId: string, id: string, findingId: string, stance: HypothesisStance, note = '') =>
    api.put<AgentHypothesis>(`/cases/${caseId}/agents/hypotheses/${id}/links/${findingId}`, { stance, note })
      .then(r => r.data),
  unlinkHypothesis: (caseId: string, id: string, findingId: string) =>
    api.delete<AgentHypothesis>(`/cases/${caseId}/agents/hypotheses/${id}/links/${findingId}`).then(r => r.data),
  benches: () => api.get<BenchCase[]>('/agents/bench').then(r => r.data),
  benchRuns: () => api.get<BenchRun[]>('/agents/bench/runs').then(r => r.data),
  startBenchRun: (benchId: string, provider: string, model: string) =>
    api.post<BenchRun>('/agents/bench/runs', { bench_id: benchId, provider, model }).then(r => r.data),
  observation: (caseId: string, observationId: string) =>
    api.get<AgentObservation>(`/cases/${caseId}/agents/observations/${observationId}`).then(r => r.data),
}

export const featuresApi = {
  /** Optional modules. A role that cannot read this sees none of them. */
  get: () =>
    api.get<{ charybdis: boolean }>('/features')
      .then(r => r.data)
      .catch(() => ({ charybdis: false })),
}
