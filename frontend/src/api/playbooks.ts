import api from './client'

export interface PlaybookNode {
  id: string
  type: 'start' | 'step' | 'decision' | 'end' | 'remediation' | 'frame' | 'playbook_ref'
  position: { x: number; y: number }
  data: {
    label: string
    description?: string
    linked_playbook_id?: string    // UUID of the linked playbook (if it exists)
    linked_playbook_name?: string  // display name (for future/not-yet-created playbooks)
  }
}

export interface PlaybookEdge {
  id: string
  source: string
  target: string
  sourceHandle?: string | null
  targetHandle?: string | null
  label?: string
  type?: string
  animated?: boolean
  /**
   * Free-form edge payload. Remora stores the link's authored shape here:
   *   `shape`     — 'curve' | 'step' | 'straight'
   *   `waypoints` — bend points in flow coordinates, so a link can be routed
   *                 around nodes instead of cutting through them.
   */
  data?: {
    shape?: 'curve' | 'step' | 'straight'
    waypoints?: { x: number; y: number }[]
    [key: string]: unknown
  }
}

export interface Playbook {
  id: string
  name: string
  description: string
  nodes: PlaybookNode[]
  edges: PlaybookEdge[]
  layout_dir: string
  created_at: string
  updated_at: string
}

/**
 * Owner of a playbook step. `user` points at a Remora account; `external` is
 * free text for a service desk, a client contact or any third party without
 * an account here.
 */
export interface StepAssignee {
  kind:     'user' | 'external'
  user_id:  string | null
  label:    string
  color:    string
}

export interface StepState {
  done: boolean
  comment: string
  notes: string
  done_at: string | null
  assignee?: StepAssignee | null
}

export interface CasePlaybook {
  id: string
  case_id: string
  playbook_id: string
  playbook: Playbook
  step_states: Record<string, StepState>
  added_at: string
}

export const playbooksApi = {
  list: () => api.get<Playbook[]>('/playbooks').then(r => r.data),
  get: (id: string) => api.get<Playbook>(`/playbooks/${id}`).then(r => r.data),
  create: (data: { name: string; description?: string; nodes?: PlaybookNode[]; edges?: PlaybookEdge[]; layout_dir?: string }) =>
    api.post<Playbook>('/playbooks', data).then(r => r.data),
  update: (id: string, data: Partial<Pick<Playbook, 'name' | 'description' | 'nodes' | 'edges' | 'layout_dir'>>) =>
    api.put<Playbook>(`/playbooks/${id}`, data).then(r => r.data),
  delete: (id: string) => api.delete(`/playbooks/${id}`),

  listCasePlaybooks: (caseId: string) =>
    api.get<CasePlaybook[]>(`/cases/${caseId}/playbooks`).then(r => r.data),
  attachPlaybook: (caseId: string, playbookId: string) =>
    api.post<CasePlaybook>(`/cases/${caseId}/playbooks`, { playbook_id: playbookId }).then(r => r.data),
  detachPlaybook: (caseId: string, cpId: string) =>
    api.delete(`/cases/${caseId}/playbooks/${cpId}`),
  updateStep: (caseId: string, cpId: string, nodeId: string, done: boolean, comment: string, notes: string = '') =>
    api.patch<CasePlaybook>(`/cases/${caseId}/playbooks/${cpId}/steps/${nodeId}`, { done, comment, notes }).then(r => r.data),
  /** Pass null to clear the assignment. */
  assignStep: (caseId: string, cpId: string, nodeId: string, assignee: StepAssignee | null) =>
    api.patch<CasePlaybook>(`/cases/${caseId}/playbooks/${cpId}/steps/${nodeId}/assignee`, { assignee })
      .then(r => r.data),
}
