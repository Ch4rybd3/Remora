import api from './client'

export interface UsnFile {
  id:                     string
  case_id:                string
  filename:               string
  status:                 'pending' | 'parsing' | 'ready' | 'error'
  entry_count:            number | null
  error_msg:              string | null
  uploaded_at:            string
  parsed_at:              string | null
  added_to_evidence:      boolean
  parse_progress:         number
  parse_duration_seconds: number | null
}

export interface UsnEntry {
  entry_offset:     number | null
  usn:              number | null
  filename:         string | null
  extension:        string | null
  is_directory:     boolean
  update_timestamp: string | null
  reason:           string | null
  full_path:        string | null
  file_ref:         string | null
  parent_ref:       string | null
}

export interface UsnEntriesPage {
  total:     number
  page:      number
  page_size: number
  pages:     number
  items:     UsnEntry[]
}

export interface UsnSummary {
  total_entries:    number
  oldest_timestamp: string | null
  newest_timestamp: string | null
  top_reasons:      Array<{ reason: string; count: number }>
  top_extensions:   Array<{ ext: string; count: number }>
}

export interface UsnEntryFilters {
  page?:      number
  page_size?: number
  search?:    string
  reason?:    string
  extension?: string
  time_from?: string
  time_to?:   string
  sort_dir?:  string
}

export const usnApi = {
  upload: (caseId: string, file: File) => {
    const fd = new FormData()
    fd.append('file', file)
    return api.post<UsnFile>(`/usn/${caseId}/upload`, fd, {
      headers: { 'Content-Type': 'multipart/form-data' },
    }).then(r => r.data)
  },

  listFiles: (caseId: string) =>
    api.get<UsnFile[]>(`/usn/${caseId}/files`).then(r => r.data),

  deleteFile: (caseId: string, fileId: string) =>
    api.delete(`/usn/${caseId}/files/${fileId}`),

  summary: (caseId: string, fileId: string) =>
    api.get<UsnSummary>(`/usn/${caseId}/files/${fileId}/summary`).then(r => r.data),

  entries: (caseId: string, fileId: string, filters: UsnEntryFilters = {}) =>
    api.get<UsnEntriesPage>(`/usn/${caseId}/files/${fileId}/entries`, { params: filters })
       .then(r => r.data),

  reparse: (caseId: string, fileId: string) =>
    api.post<UsnFile>(`/usn/${caseId}/files/${fileId}/reparse`).then(r => r.data),

  addEvidence: (caseId: string, fileId: string) =>
    api.post<UsnFile>(`/usn/${caseId}/files/${fileId}/add-evidence`).then(r => r.data),
}
