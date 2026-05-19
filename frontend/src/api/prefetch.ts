import api from './client'

export interface PrefetchFile {
  id:          string
  case_id:     string
  filename:    string
  status:      'pending' | 'parsing' | 'ready' | 'error'
  entry_count: number | null
  error_msg:   string | null
  uploaded_at: string
  parsed_at:   string | null
  added_to_evidence:      boolean
  parse_progress:         number
  parse_duration_seconds: number | null
}

export interface PrefetchEntry {
  row_num:         number
  source_filename: string | null
  executable_name: string | null
  hash:            string | null
  size:            number | null
  version:         string | null
  run_count:       number | null
  last_run:        string | null
  prev_run_0:      string | null
  prev_run_1:      string | null
  prev_run_2:      string | null
  prev_run_3:      string | null
  prev_run_4:      string | null
  prev_run_5:      string | null
  prev_run_6:      string | null
  volume0_name:    string | null
  volume0_serial:  string | null
  volume1_name:    string | null
  directories:     string | null
  files_loaded:    string | null
}

/** A PrefetchEntry pinned to the right-panel selection, enriched with file metadata. */
export interface PinnedPrefetchEntry extends PrefetchEntry {
  _key:      string   // `${fileId}:${row_num}`
  _fileId:   string
  _filename: string
}

export interface PrefetchEntriesPage {
  total:     number
  page:      number
  page_size: number
  pages:     number
  items:     PrefetchEntry[]
}

export interface PrefetchSummary {
  total_entries:   number
  total_runs:      number
  oldest_last_run: string | null
  newest_last_run: string | null
  top_executables: Array<{ executable_name: string; run_count: number | null; last_run: string | null }>
  versions:        Array<{ version: string; count: number }>
}

export interface PrefetchEntryFilters {
  page?:      number
  page_size?: number
  search?:    string
  version?:   string
  time_from?: string
  time_to?:   string
  sort_by?:   string
  sort_dir?:  string
}

export const prefetchApi = {
  upload: (caseId: string, file: File) => {
    const fd = new FormData()
    fd.append('file', file)
    return api.post<PrefetchFile>(`/prefetch/${caseId}/upload`, fd, {
      headers: { 'Content-Type': 'multipart/form-data' },
    }).then(r => r.data)
  },

  listFiles: (caseId: string) =>
    api.get<PrefetchFile[]>(`/prefetch/${caseId}/files`).then(r => r.data),

  deleteFile: (caseId: string, fileId: string) =>
    api.delete(`/prefetch/${caseId}/files/${fileId}`),

  summary: (caseId: string, fileId: string) =>
    api.get<PrefetchSummary>(`/prefetch/${caseId}/files/${fileId}/summary`).then(r => r.data),

  entries: (caseId: string, fileId: string, filters: PrefetchEntryFilters = {}) =>
    api.get<PrefetchEntriesPage>(`/prefetch/${caseId}/files/${fileId}/entries`, { params: filters })
       .then(r => r.data),

  reparse: (caseId: string, fileId: string) =>
    api.post<PrefetchFile>(`/prefetch/${caseId}/files/${fileId}/reparse`).then(r => r.data),

  addEvidence: (caseId: string, fileId: string) =>
    api.post<PrefetchFile>(`/prefetch/${caseId}/files/${fileId}/add-evidence`).then(r => r.data),
}
