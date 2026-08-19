import api from './client'

export interface DropzoneFile {
  name:      string
  size:      number
  /** Parser label from ez_detection, null when the file type isn't recognised */
  detected:  string | null
  supported: boolean
  /** False while the file is still being written — ingest waits for it */
  stable:    boolean
  mtime:     number
}

export interface CaseDropzone {
  path:            string
  folder_name:     string
  auto_ingest:     boolean
  stable_seconds:  number
  pending:         DropzoneFile[]
  processed_count: number
}

export interface DropzoneStatus {
  root:           string
  inbox_dir:      string
  auto_ingest:    boolean
  poll_seconds:   number
  stable_seconds: number
  supported_exts: string[]
  inbox:          DropzoneFile[]
}

export interface ScanResult {
  ingested:      number
  skipped:       string[]
  collection_id: string | null
}

export const dropzoneApi = {
  status: () => api.get<DropzoneStatus>('/dropzone/status').then(r => r.data),

  forCase: (caseId: string) =>
    api.get<CaseDropzone>(`/cases/${caseId}/dropzone`).then(r => r.data),

  /** `includeUnstable` bypasses the quiescence delay for a finished copy. */
  scan: (caseId: string, includeUnstable = false) =>
    api.post<ScanResult>(
      `/cases/${caseId}/dropzone/scan?include_unstable=${includeUnstable}`,
    ).then(r => r.data),

  /** Empty `files` assigns everything currently in the inbox. */
  assignInbox: (caseId: string, files: string[] = []) =>
    api.post<{ ingested: number; collection_id: string }>(
      '/dropzone/inbox/assign', { case_id: caseId, files },
    ).then(r => r.data),

  deleteInboxFile: (filename: string) =>
    api.delete(`/dropzone/inbox/${encodeURIComponent(filename)}`),
}
