import api from './client'
import type { TimelineEvent } from '../types'

export const timelineApi = {
  list: (caseId: string) =>
    api.get<TimelineEvent[]>(`/cases/${caseId}/timeline/`).then(r => r.data),
  create: (caseId: string, data: Partial<TimelineEvent>) =>
    api.post<TimelineEvent>(`/cases/${caseId}/timeline/`, data).then(r => r.data),
  update: (caseId: string, id: string, data: Partial<TimelineEvent>) =>
    api.patch<TimelineEvent>(`/cases/${caseId}/timeline/${id}`, data).then(r => r.data),
  delete: (caseId: string, id: string) => api.delete(`/cases/${caseId}/timeline/${id}`),
}
