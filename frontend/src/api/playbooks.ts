import api from './client'

export interface PlaybookNode {
  id: string
  type: 'start' | 'step' | 'decision' | 'end' | 'remediation' | 'frame'
  position: { x: number; y: number }
  data: { label: string; description?: string }
}

export interface PlaybookEdge {
  id: string
  source: string
  target: string
  label?: string
  type?: string
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

export interface StepState {
  done: boolean
  comment: string
  notes: string
  done_at: string | null
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
}
