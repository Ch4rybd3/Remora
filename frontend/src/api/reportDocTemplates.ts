import api from './client'

/** One supported {{tag}}, as the backend registry describes it. */
export interface ReportTag {
  name:        string
  /** "text" is substituted inline; "block" replaces its whole paragraph. */
  kind:        'text' | 'block'
  group:       string
  group_label: string
  description: string
}

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

  /**
   * The tag vocabulary, served from the backend registry.
   *
   * Names *and* descriptions come over the wire. The page used to hold its own
   * copy of both, which is how it ended up documenting seven tags in one
   * language and six in another while the exporter supported a different set
   * again.
   */
  availableTags: async (): Promise<ReportTag[]> => {
    const res = await api.get<ReportTag[]>('/report-doc-templates/tags')
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
