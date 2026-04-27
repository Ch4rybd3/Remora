import api from './client'

export interface BrowserFile {
  id:            string
  case_id:       string
  filename:      string
  artifact_type: string
  status:        'pending' | 'parsing' | 'ready' | 'error'
  entry_count:   number | null
  error_msg:     string | null
  uploaded_at:   string
  parsed_at:     string | null
  added_to_evidence:      boolean
  parse_progress:         number
  parse_duration_seconds: number | null
  /** Original CSV column names — populated after parse completes. */
  columns:       string[]
}

export interface BrowserEntry {
  row_num:        number
  artifact_type:  string
  event_timestamp: string | null
  url:            string | null
  title:          string | null
  browser:        string | null
  profile:        string | null
  username:       string | null
  /** Every original CSV column → value (empty values omitted). */
  raw_data:       Record<string, string>
}

/** A BrowserEntry pinned to the right-panel selection, enriched with file metadata. */
export interface PinnedBrowserEntry extends BrowserEntry {
  _key:      string   // `${fileId}:${row_num}`
  _fileId:   string
  _filename: string
}

export interface BrowserEntriesPage {
  total:     number
  page:      number
  page_size: number
  pages:     number
  items:     BrowserEntry[]
}

export interface BrowserSummary {
  total_entries:    number
  artifact_type:    string
  oldest_timestamp: string | null
  newest_timestamp: string | null
  top_browsers:     Array<{ browser: string; count: number }>
  top_domains:      Array<{ domain:  string; count: number }>
}

export interface BrowserEntryFilters {
  page?:          number
  page_size?:     number
  search?:        string
  browser?:       string
  artifact_type?: string
  time_from?:     string
  time_to?:       string
  sort_dir?:      string
}

export const browserApi = {
  upload: (caseId: string, file: File) => {
    const fd = new FormData()
    fd.append('file', file)
    return api.post<BrowserFile>(`/browser/${caseId}/upload`, fd, {
      headers: { 'Content-Type': 'multipart/form-data' },
    }).then(r => r.data)
  },

  listFiles: (caseId: string) =>
    api.get<BrowserFile[]>(`/browser/${caseId}/files`).then(r => r.data),

  deleteFile: (caseId: string, fileId: string) =>
    api.delete(`/browser/${caseId}/files/${fileId}`),

  summary: (caseId: string, fileId: string) =>
    api.get<BrowserSummary>(`/browser/${caseId}/files/${fileId}/summary`).then(r => r.data),

  entries: (caseId: string, fileId: string, filters: BrowserEntryFilters = {}) =>
    api.get<BrowserEntriesPage>(`/browser/${caseId}/files/${fileId}/entries`, { params: filters })
       .then(r => r.data),

  reparse: (caseId: string, fileId: string) =>
    api.post<BrowserFile>(`/browser/${caseId}/files/${fileId}/reparse`).then(r => r.data),

  addEvidence: (caseId: string, fileId: string) =>
    api.post<BrowserFile>(`/browser/${caseId}/files/${fileId}/add-evidence`).then(r => r.data),
}
