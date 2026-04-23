import api from './client'
import type { Evidence } from '../types'

export const evidencesApi = {
  list: (caseId: string) =>
    api.get<Evidence[]>(`/cases/${caseId}/evidences/`).then(r => r.data),
  upload: (caseId: string, formData: FormData) =>
    api.post<Evidence>(`/cases/${caseId}/evidences/`, formData, {
      headers: { 'Content-Type': 'multipart/form-data' },
    }).then(r => r.data),
  update: (caseId: string, id: string, data: Partial<Evidence>) =>
    api.patch<Evidence>(`/cases/${caseId}/evidences/${id}`, data).then(r => r.data),
  delete: (caseId: string, id: string) => api.delete(`/cases/${caseId}/evidences/${id}`),
  downloadUrl: (caseId: string, id: string) =>
    `/api/v1/cases/${caseId}/evidences/${id}/download`,
}
