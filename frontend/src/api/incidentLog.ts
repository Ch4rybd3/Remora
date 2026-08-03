import api from './client'
import type { IncidentLogEntry } from '../types'

export const incidentLogApi = {
  list: (caseId: string) =>
    api.get<IncidentLogEntry[]>(`/cases/${caseId}/incident-log/`).then(r => r.data),
  create: (caseId: string, data: Partial<IncidentLogEntry>) =>
    api.post<IncidentLogEntry>(`/cases/${caseId}/incident-log/`, data).then(r => r.data),
  update: (caseId: string, id: string, data: Partial<IncidentLogEntry>) =>
    api.patch<IncidentLogEntry>(`/cases/${caseId}/incident-log/${id}`, data).then(r => r.data),
  delete: (caseId: string, id: string) => api.delete(`/cases/${caseId}/incident-log/${id}`),
  exportMarkdown: (caseId: string) =>
    api.get<Blob>(`/cases/${caseId}/incident-log/export`, { responseType: 'blob' }).then(r => r.data),
}
