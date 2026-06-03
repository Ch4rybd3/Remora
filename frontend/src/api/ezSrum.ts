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

export interface SrumAppUsageEntry {
  id: number
  timestamp: string | null
  exe_info: string | null
  exe_description: string | null
  user_name: string | null
  sid: string | null
  bg_bytes_read: number | null
  bg_bytes_written: number | null
  fg_bytes_read: number | null
  fg_bytes_written: number | null
  face_time: string | null
}

export interface SrumNetworkEntry {
  id: number
  timestamp: string | null
  exe_info: string | null
  exe_description: string | null
  user_name: string | null
  sid: string | null
  bytes_received: number | null
  bytes_sent: number | null
  profile_name: string | null
  interface_type: string | null
}

export const srumApi = {
  listAppUsage: (caseId: string, p: Record<string, string | number> = {}) =>
    get(`${BASE}/cases/${caseId}/srum/app-usage${qs(p)}`) as Promise<{ total: number; items: SrumAppUsageEntry[] }>,

  listNetwork: (caseId: string, p: Record<string, string | number> = {}) =>
    get(`${BASE}/cases/${caseId}/srum/network${qs(p)}`) as Promise<{ total: number; items: SrumNetworkEntry[] }>,
}
