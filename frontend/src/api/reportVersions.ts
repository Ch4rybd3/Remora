import api from './client'

export interface ReportVersionMeta {
  id:         number
  version:    number
  line_count: number
  created_by: string | null
  created_at: string
}

export interface ReportVersionFull extends ReportVersionMeta {
  content: string
}

export const reportVersionsApi = {
  list: (caseId: string): Promise<ReportVersionMeta[]> =>
    api.get<ReportVersionMeta[]>(`/cases/${caseId}/report/versions`).then(r => r.data),

  get: (caseId: string, versionId: number): Promise<ReportVersionFull> =>
    api.get<ReportVersionFull>(`/cases/${caseId}/report/versions/${versionId}`).then(r => r.data),

  save: (caseId: string, content: string): Promise<ReportVersionMeta> =>
    api.post<ReportVersionMeta>(`/cases/${caseId}/report/save`, { content }).then(r => r.data),
}
