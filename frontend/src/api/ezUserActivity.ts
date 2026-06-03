const BASE = '/api/v1'

async function authHeaders(): Promise<Record<string, string>> {
  const token = localStorage.getItem('remora_token')
  return token ? { Authorization: `Bearer ${token}` } : {}
}

async function get(url: string) {
  const res = await fetch(url, { headers: await authHeaders(), credentials: 'include' })
  if (!res.ok) throw new Error(await res.text())
  return res.json()
}

function qs(params: Record<string, string | number>) {
  const p = new URLSearchParams(params as any).toString()
  return p ? '?' + p : ''
}

export interface LnkEntry {
  id: number
  source_file: string | null
  source_created: string | null
  source_modified: string | null
  target_created: string | null
  target_modified: string | null
  target_accessed: string | null
  file_size: number | null
  local_path: string | null
  network_path: string | null
  target_path: string | null
  arguments: string | null
  machine_id: string | null
  mac_address: string | null
  drive_type: string | null
  volume_label: string | null
  relative_path: string | null
}

export interface JumpListEntry {
  id: number
  jl_type: string | null
  app_id: string | null
  app_description: string | null
  mru: number | null
  entry_number: number | null
  creation_time: string | null
  last_modified: string | null
  hostname: string | null
  mac_address: string | null
  path: string | null
  interaction_count: number | null
  local_path: string | null
  target_path: string | null
  file_size: number | null
  pin_status: string | null
  arguments: string | null
}

export interface ShellbagEntry {
  id: number
  bag_path: string | null
  slot: number | null
  mru_position: number | null
  absolute_path: string | null
  shell_type: string | null
  created_on: string | null
  modified_on: string | null
  accessed_on: string | null
  last_write_time: string | null
  first_interacted: string | null
  last_interacted: string | null
  has_explored: boolean | null
  hive_source: string | null
}

export interface RecycleBinEntry {
  id: number
  source_name: string | null
  file_type: string | null
  file_name: string | null
  file_size: number | null
  deleted_on: string | null
  sid: string | null
}

export interface WindowsTimelineEntry {
  id: number
  activity_type: string | null
  executable: string | null
  display_text: string | null
  content_info: string | null
  start_time: string | null
  end_time: string | null
  duration: string | null
  last_modified: string | null
  platform: string | null
}

export const lnkApi = {
  list: (caseId: string, p: Record<string, string | number> = {}) =>
    get(`${BASE}/cases/${caseId}/user-activity/lnk${qs(p)}`) as Promise<{ total: number; items: LnkEntry[] }>,
}

export const jumpListApi = {
  list: (caseId: string, p: Record<string, string | number> = {}) =>
    get(`${BASE}/cases/${caseId}/user-activity/jumplists${qs(p)}`) as Promise<{ total: number; items: JumpListEntry[] }>,
}

export const shellbagApi = {
  list: (caseId: string, p: Record<string, string | number> = {}) =>
    get(`${BASE}/cases/${caseId}/user-activity/shellbags${qs(p)}`) as Promise<{ total: number; items: ShellbagEntry[] }>,
}

export const recycleBinApi = {
  list: (caseId: string, p: Record<string, string | number> = {}) =>
    get(`${BASE}/cases/${caseId}/user-activity/recycle-bin${qs(p)}`) as Promise<{ total: number; items: RecycleBinEntry[] }>,
}

export const windowsTimelineApi = {
  list: (caseId: string, p: Record<string, string | number> = {}) =>
    get(`${BASE}/cases/${caseId}/user-activity/windows-timeline${qs(p)}`) as Promise<{ total: number; items: WindowsTimelineEntry[] }>,
}
