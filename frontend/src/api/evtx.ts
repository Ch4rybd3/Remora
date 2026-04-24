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

export interface EvtxEvent {
  id:           number
  file_id:      string
  record_id:    number | null
  time_created: string | null
  event_id:     number | null
  level:        number | null
  level_name:   string | null
  channel:      string | null
  provider:     string | null
  computer:     string | null
  user_id:      string | null
  event_data:   Record<string, string> | null
}

export interface EventsPage {
  total:     number
  page:      number
  page_size: number
  pages:     number
  items:     EvtxEvent[]
}

export interface ChannelStat {
  channel:     string
  event_count: number
}

export interface FileSummary {
  channels:  ChannelStat[]
  levels:    Record<string, number>
  event_ids: number[]
}

export interface EventFilters {
  page?:          number
  page_size?:     number
  search?:        string
  channels?:      string    // comma-separated
  levels?:        string    // comma-separated
  event_ids?:     string    // comma-separated
  time_from?:     string
  time_to?:       string
  sort_dir?:      'asc' | 'desc'
  col_filters?:   string    // JSON: Record<colKey, {mode, value}>
  field_filters?: string    // JSON: Array<{key, mode, value}> — EventData field filters
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

  summary: (caseId: string, fileId: string) =>
    api.get<FileSummary>(`/evtx/${caseId}/files/${fileId}/summary`).then(r => r.data),

  events: (caseId: string, fileId: string, filters: EventFilters = {}) =>
    api.get<EventsPage>(`/evtx/${caseId}/files/${fileId}/events`, {
      params: filters,
    }).then(r => r.data),

  addEvidence: (caseId: string, fileId: string) =>
    api.post<EvtxFile>(`/evtx/${caseId}/files/${fileId}/add-evidence`).then(r => r.data),

  reparse: (caseId: string, fileId: string) =>
    api.post<EvtxFile>(`/evtx/${caseId}/files/${fileId}/reparse`).then(r => r.data),
}
