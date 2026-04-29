import api from './client'

export interface MftFile {
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

export interface MftEntry {
  entry_number:        number
  parent_entry_number: number | null
  parent_path:         string | null
  filename:            string | null
  extension:           string | null
  file_size:           number | null

  is_in_use:   boolean
  is_deleted:  boolean
  is_directory: boolean

  si_created:     string | null
  si_modified:    string | null
  si_accessed:    string | null
  si_mft_changed: string | null

  fn_created:     string | null
  fn_modified:    string | null
  fn_accessed:    string | null
  fn_mft_changed: string | null

  has_ts_anomaly: boolean
}

/** MFT entry enriched with source file metadata for the selection panel. */
export interface PinnedMftEntry extends MftEntry {
  _key:        string   // `${fileId}:mft:${entry_number}`
  _fileId:     string
  _filename:   string
  _sourceType: 'mft'
}

export interface EntriesPage {
  total:     number
  page:      number
  page_size: number
  pages:     number
  items:     MftEntry[]
}

export interface MftSummary {
  total_entries:      number
  deleted_count:      number
  directory_count:    number
  file_count:         number
  oldest_si_modified: string | null
  newest_si_modified: string | null
  top_extensions:     Array<{ ext: string; count: number }>
}

export interface EntryFilters {
  page?:       number
  page_size?:  number
  search?:     string
  flags?:      string
  extension?:  string
  time_field?: string
  time_from?:  string
  time_to?:    string
  sort_by?:    string
  sort_dir?:   string
}

export const mftApi = {
  upload: (caseId: string, file: File) => {
    const fd = new FormData()
    fd.append('file', file)
    return api.post<MftFile>(`/mft/${caseId}/upload`, fd, {
      headers: { 'Content-Type': 'multipart/form-data' },
    }).then(r => r.data)
  },

  listFiles: (caseId: string) =>
    api.get<MftFile[]>(`/mft/${caseId}/files`).then(r => r.data),

  deleteFile: (caseId: string, fileId: string) =>
    api.delete(`/mft/${caseId}/files/${fileId}`),

  summary: (caseId: string, fileId: string) =>
    api.get<MftSummary>(`/mft/${caseId}/files/${fileId}/summary`).then(r => r.data),

  entries: (caseId: string, fileId: string, filters: EntryFilters = {}) =>
    api.get<EntriesPage>(`/mft/${caseId}/files/${fileId}/entries`, { params: filters })
       .then(r => r.data),

  reparse: (caseId: string, fileId: string) =>
    api.post<MftFile>(`/mft/${caseId}/files/${fileId}/reparse`).then(r => r.data),

  addEvidence: (caseId: string, fileId: string) =>
    api.post<MftFile>(`/mft/${caseId}/files/${fileId}/add-evidence`).then(r => r.data),
}
