import api from './client'

export interface AttackGraphData {
  case_id:    string
  nodes:      Record<string, unknown>[]
  edges:      Record<string, unknown>[]
  updated_at: string
}

export const attackGraphApi = {
  get: (caseId: string): Promise<AttackGraphData> =>
    api.get<AttackGraphData>(`/cases/${caseId}/attack-graph`).then(r => r.data),

  save: (caseId: string, nodes: unknown[], edges: unknown[]): Promise<AttackGraphData> =>
    api.put<AttackGraphData>(`/cases/${caseId}/attack-graph`, { nodes, edges }).then(r => r.data),
}
