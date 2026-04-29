import api from './client'

export interface RegistryFile {
  id:            string
  case_id:       string
  filename:      string
  hive_type:     string
  status:        'pending' | 'parsing' | 'ready' | 'error'
  entry_count:   number | null
  error_msg:     string | null
  uploaded_at:   string
  parsed_at:     string | null
  added_to_evidence:      boolean
  parse_progress:         number
  parse_duration_seconds: number | null
  columns:                string[]   // decoded from columns_json by server
}

export interface RegistryEntry {
  row_num:    number
  timestamp:  string | null
  hive_path:  string | null
  hive_type:  string | null
  key_path:   string | null
  value_name: string | null
  value_type: string | null
  value_data: string | null
  deleted:    string | null
  raw_data:   Record<string, string>
}

export interface PinnedRegistryEntry extends RegistryEntry {
  _key:        string   // `${fileId}:reg:${row_num}`
  _fileId:     string
  _filename:   string
  _sourceType: 'registry'
}

export interface RegistryEntriesPage {
  total:     number
  page:      number
  page_size: number
  pages:     number
  items:     RegistryEntry[]
}

export interface RegistrySummary {
  total_entries:    number
  hive_type:        string
  oldest_timestamp: string | null
  newest_timestamp: string | null
  top_hive_types:   Array<{ hive_type: string; count: number }>
  top_value_types:  Array<{ value_type: string; count: number }>
  top_categories:   Array<{ category: string; count: number }>
}

export interface RegistryEntryFilters {
  page?:       number
  page_size?:  number
  search?:     string
  hive_type?:  string
  value_type?: string
  deleted?:    string
  time_from?:  string
  time_to?:    string
  sort_dir?:   string
}

export const registryApi = {
  upload: (caseId: string, file: File) => {
    const fd = new FormData()
    fd.append('file', file)
    return api.post<RegistryFile>(`/registry/${caseId}/upload`, fd, {
      headers: { 'Content-Type': 'multipart/form-data' },
    }).then(r => r.data)
  },

  listFiles: (caseId: string) =>
    api.get<RegistryFile[]>(`/registry/${caseId}/files`).then(r => r.data),

  deleteFile: (caseId: string, fileId: string) =>
    api.delete(`/registry/${caseId}/files/${fileId}`),

  summary: (caseId: string, fileId: string) =>
    api.get<RegistrySummary>(`/registry/${caseId}/files/${fileId}/summary`).then(r => r.data),

  entries: (caseId: string, fileId: string, filters: RegistryEntryFilters = {}) =>
    api.get<RegistryEntriesPage>(`/registry/${caseId}/files/${fileId}/entries`, { params: filters })
       .then(r => r.data),

  reparse: (caseId: string, fileId: string) =>
    api.post<RegistryFile>(`/registry/${caseId}/files/${fileId}/reparse`).then(r => r.data),

  addEvidence: (caseId: string, fileId: string) =>
    api.post<RegistryFile>(`/registry/${caseId}/files/${fileId}/add-evidence`).then(r => r.data),
}
