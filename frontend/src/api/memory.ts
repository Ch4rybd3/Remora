import api from './client'

export interface MemoryDump {
  id:          string
  case_id:     string
  filename:    string
  os_type:     string    // "windows" | "linux"
  file_size:   number | null
  status:      string    // uploaded | analyzing | done | error
  error_msg:   string | null
  uploaded_at: string
}

export interface MemoryPluginResult {
  id:           number
  dump_id:      string
  plugin_name:  string
  plugin_args:  Record<string, unknown> | null
  status:       string   // pending | running | done | error
  output:       string | null
  error:        string | null
  started_at:   string | null
  completed_at: string | null
  is_custom:    boolean
}

export const memoryApi = {
  upload: (caseId: string, formData: FormData): Promise<MemoryDump> =>
    api.post<MemoryDump>(`/memory/${caseId}/upload`, formData, {
      headers: { 'Content-Type': 'multipart/form-data' },
    }).then(r => r.data),

  listDumps: (caseId: string): Promise<MemoryDump[]> =>
    api.get<MemoryDump[]>(`/memory/${caseId}/dumps`).then(r => r.data),

  getDump: (caseId: string, dumpId: string): Promise<MemoryDump> =>
    api.get<MemoryDump>(`/memory/${caseId}/dumps/${dumpId}`).then(r => r.data),

  deleteDump: (caseId: string, dumpId: string): Promise<void> =>
    api.delete(`/memory/${caseId}/dumps/${dumpId}`).then(() => undefined),

  listPlugins: (caseId: string, dumpId: string): Promise<MemoryPluginResult[]> =>
    api.get<MemoryPluginResult[]>(`/memory/${caseId}/dumps/${dumpId}/plugins`).then(r => r.data),

  runPlugin: (
    caseId: string,
    dumpId: string,
    plugin_name: string,
    plugin_args?: Record<string, unknown>,
  ): Promise<MemoryPluginResult> =>
    api.post<MemoryPluginResult>(`/memory/${caseId}/dumps/${dumpId}/run`, {
      plugin_name,
      plugin_args: plugin_args ?? null,
    }).then(r => r.data),

  rerunPlugin: (caseId: string, dumpId: string, pluginId: number): Promise<MemoryPluginResult> =>
    api.post<MemoryPluginResult>(
      `/memory/${caseId}/dumps/${dumpId}/plugins/${pluginId}/rerun`, {}
    ).then(r => r.data),
}
