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

  /**
   * The graph as a PNG, rendered server-side by the same code the DOCX report
   * uses — so the download and the report image are the same picture.
   */
  png: (caseId: string): Promise<Blob> =>
    api.get(`/cases/${caseId}/attack-graph/png`, { responseType: 'blob' }).then(r => r.data),

  /**
   * Store a PNG of the canvas so the report embeds what the analyst arranged
   * rather than a server-side redrawing of it.
   */
  saveSnapshot: (caseId: string, png: Blob): Promise<void> =>
    api.put(`/cases/${caseId}/attack-graph/snapshot`, png, {
      headers: { 'Content-Type': 'image/png' },
    }).then(() => undefined),
}
