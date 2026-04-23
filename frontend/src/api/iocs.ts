import api from './client'
import type { IOC } from '../types'

export const iocsApi = {
  list: (caseId: string) => api.get<IOC[]>(`/cases/${caseId}/iocs/`).then(r => r.data),
  create: (caseId: string, data: Partial<IOC>) =>
    api.post<IOC>(`/cases/${caseId}/iocs/`, data).then(r => r.data),
  update: (caseId: string, id: string, data: Partial<IOC>) =>
    api.patch<IOC>(`/cases/${caseId}/iocs/${id}`, data).then(r => r.data),
  delete: (caseId: string, id: string) => api.delete(`/cases/${caseId}/iocs/${id}`),
}
