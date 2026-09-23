import api from './client'

export interface EvtxFile {
  id:                string
  case_id:           string
  filename:          string
  status:            'pending' | 'parsing' | 'ready' | 'error'
  event_count:       number | null
  error_msg:         string | null
  uploaded_at:       string
  parsed_at:         string | null
  added_to_evidence: boolean
}

export const evtxApi = {
  upload: (caseId: string, file: File) => {
    const fd = new FormData()
    fd.append('file', file)
    return api.post<EvtxFile>(`/evtx/${caseId}/upload`, fd, {
      headers: { 'Content-Type': 'multipart/form-data' },
    }).then(r => r.data)
  },

  listFiles: (caseId: string) =>
    api.get<EvtxFile[]>(`/evtx/${caseId}/files`).then(r => r.data),

  deleteFile: (caseId: string, fileId: string) =>
    api.delete(`/evtx/${caseId}/files/${fileId}`),

  addEvidence: (caseId: string, fileId: string) =>
    api.post<EvtxFile>(`/evtx/${caseId}/files/${fileId}/add-evidence`).then(r => r.data),
}
