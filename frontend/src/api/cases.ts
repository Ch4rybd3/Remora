import api from './client'
import type { Case, CaseSummary } from '../types'

export const casesApi = {
  list: () => api.get<CaseSummary[]>('/cases/').then(r => r.data),
  get: (id: string) => api.get<Case>(`/cases/${id}`).then(r => r.data),
  create: (data: Partial<Case>) => api.post<Case>('/cases/', data).then(r => r.data),
  update: (id: string, data: Partial<Case>) =>
    api.patch<Case>(`/cases/${id}`, data).then(r => r.data),
  delete: (id: string) => api.delete(`/cases/${id}`),
  generateReport: (id: string) =>
    api.get<{ analysis: string; remediation: string; conclusion: string }>(
      `/cases/${id}/report/generate`
    ).then(r => r.data),
}
