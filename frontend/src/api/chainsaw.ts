import api from './client'

export interface ChainsawScan {
  id:          string
  file_id:     string
  case_id:     string
  status:      'pending' | 'scanning' | 'ready' | 'error'
  alert_count: number | null
  error_msg:   string | null
  scanned_at:  string | null
  created_at:  string
}

export interface ChainsawAlert {
  id:           string
  scan_id:      string
  file_id:      string
  case_id:      string
  rule_name:    string
  level:        string | null   // critical | high | medium | low | informational
  sigma_status: string | null
  group_name:   string | null
  tags:         string | null
  authors:      string | null
  timestamp:    string | null
  event_id:     number | null
  channel:      string | null
  computer:     string | null
  provider:     string | null
  event_data:   Record<string, string> | null
  added_to_timeline: boolean
}

/** Alert enriched with source filename — stored in the pinned selection. */
export interface PinnedChainsawAlert extends ChainsawAlert {
  _filename: string
}

export interface AlertsPage {
  total:     number
  page:      number
  page_size: number
  pages:     number
  items:     ChainsawAlert[]
}

export interface ChainsawSelection {
  alert_ids: string[]
  sent_ids:  string[]
}

export interface AlertFilters {
  file_id?:   string
  levels?:    string   // comma-separated
  search?:    string
  sort_dir?:  'asc' | 'desc'
  page?:      number
  page_size?: number
}

export interface RuleInfo {
  filename: string
  title: string
  group: string
  level: string
  status: string
  description: string
  authors: string
  kind: string
  path: string
}

export interface SigmaStatus {
  installed: boolean
  rule_count: number
  sigma_dir: string
}

export const chainsawRulesApi = {
  listBuiltin: (): Promise<RuleInfo[]> =>
    api.get('/chainsaw/rules/builtin').then(r => r.data),

  listCustom: (): Promise<RuleInfo[]> =>
    api.get('/chainsaw/rules/custom').then(r => r.data),

  uploadCustom: (files: File[]): Promise<{ saved: string[] }> => {
    const fd = new FormData()
    files.forEach(f => fd.append('files', f))
    return api.post('/chainsaw/rules/custom/upload', fd).then(r => r.data)
  },

  deleteCustom: (filename: string): Promise<{ deleted: string }> =>
    api.delete(`/chainsaw/rules/custom/${encodeURIComponent(filename)}`).then(r => r.data),

  sigmaStatus: (): Promise<SigmaStatus> =>
    api.get('/chainsaw/rules/sigma/status').then(r => r.data),

  sigmaDownload: (): Promise<{ status: string; message: string }> =>
    api.post('/chainsaw/rules/sigma/download').then(r => r.data),
}

export const chainsawApi = {
  startScan: (caseId: string, fileId: string): Promise<ChainsawScan> =>
    api.post<ChainsawScan>(`/chainsaw/${caseId}/files/${fileId}/scan`).then(r => r.data),

  listScans: (caseId: string): Promise<ChainsawScan[]> =>
    api.get<ChainsawScan[]>(`/chainsaw/${caseId}/scans`).then(r => r.data),

  deleteScan: (caseId: string, scanId: string): Promise<void> =>
    api.delete(`/chainsaw/${caseId}/scans/${scanId}`).then(() => undefined),

  listAlerts: (caseId: string, filters: AlertFilters = {}): Promise<AlertsPage> =>
    api.get<AlertsPage>(`/chainsaw/${caseId}/alerts`, { params: filters }).then(r => r.data),

  sendToTimeline: (caseId: string, alertId: string): Promise<ChainsawAlert> =>
    api.post<ChainsawAlert>(`/chainsaw/${caseId}/alerts/${alertId}/timeline`).then(r => r.data),

  getSelection: (caseId: string): Promise<ChainsawSelection> =>
    api.get<ChainsawSelection>(`/chainsaw/${caseId}/selection`).then(r => r.data),

  saveSelection: (caseId: string, alert_ids: string[], sent_ids: string[]): Promise<ChainsawSelection> =>
    api.put<ChainsawSelection>(`/chainsaw/${caseId}/selection`, { alert_ids, sent_ids }).then(r => r.data),
}
