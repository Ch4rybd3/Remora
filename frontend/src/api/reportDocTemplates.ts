import api from './client'

export interface ReportDocTemplate {
  id:            number
  name:          string
  description:   string
  format:        'docx' | 'markdown'
  file_size:     number
  tags_detected: string[]
  created_at:    string
  created_by:    string | null
}

export const reportDocTemplatesApi = {
  list: async (): Promise<ReportDocTemplate[]> => {
    const res = await api.get('/report-doc-templates/')
    return res.data
  },

  availableTags: async (): Promise<string[]> => {
    const res = await api.get('/report-doc-templates/tags')
    return res.data
  },

  upload: async (params: {
    name:        string
    description: string
    file:        File
  }): Promise<ReportDocTemplate> => {
    const fd = new FormData()
    fd.append('name', params.name)
    fd.append('description', params.description)
    fd.append('file', params.file)
    const res = await api.post('/report-doc-templates/upload', fd, {
      headers: { 'Content-Type': 'multipart/form-data' },
    })
    return res.data
  },

  delete: async (id: number): Promise<void> => {
    await api.delete(`/report-doc-templates/${id}`)
  },

  generate: async (templateId: number, caseId: string): Promise<Blob> => {
    const res = await api.post(
      `/report-doc-templates/${templateId}/generate/${caseId}`,
      {},
      { responseType: 'blob' },
    )
    return res.data
  },
}
