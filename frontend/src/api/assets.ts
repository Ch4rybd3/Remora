import api from './client'
import type { Asset } from '../types'

export const assetsApi = {
  list: (caseId: string) => api.get<Asset[]>(`/cases/${caseId}/assets/`).then(r => r.data),
  create: (caseId: string, data: Partial<Asset>) =>
    api.post<Asset>(`/cases/${caseId}/assets/`, data).then(r => r.data),
  update: (caseId: string, id: string, data: Partial<Asset>) =>
    api.patch<Asset>(`/cases/${caseId}/assets/${id}`, data).then(r => r.data),
  delete: (caseId: string, id: string) => api.delete(`/cases/${caseId}/assets/${id}`),
}
