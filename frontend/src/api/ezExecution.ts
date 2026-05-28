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

// ── Shimcache ──────────────────────────────────────────────────────────────

export interface ShimcacheEntry {
  id: number
  control_set: number | null
  cache_position: number | null
  path: string | null
  last_modified: string | null
  executed: string | null
  duplicate: boolean | null
  source_hive: string | null
}

export const shimcacheApi = {
  list(caseId: string, params: Record<string, string | number> = {}) {
    const q = new URLSearchParams(params as any).toString()
    return get(`${BASE}/cases/${caseId}/execution/shimcache${q ? '?' + q : ''}`) as Promise<{
      total: number
      items: ShimcacheEntry[]
    }>
  },
}

// ── Amcache ───────────────────────────────────────────────────────────────

export interface AmcacheFileEntry {
  id: number
  entry_type: string | null
  application_name: string | null
  program_id: string | null
  file_key_last_write: string | null
  sha1: string | null
  is_os_component: boolean | null
  full_path: string | null
  name: string | null
  file_extension: string | null
  link_date: string | null
  product_name: string | null
  size: number | null
  version: string | null
  is_pe_file: boolean | null
  language: string | null
  description: string | null
}

export interface AmcacheProgramEntry {
  id: number
  program_id: string | null
  key_last_write: string | null
  name: string | null
  version: string | null
  publisher: string | null
  install_date: string | null
  root_dir_path: string | null
  uninstall_string: string | null
  source: string | null
}

export const amcacheApi = {
  listFiles(caseId: string, params: Record<string, string | number> = {}) {
    const q = new URLSearchParams(params as any).toString()
    return get(`${BASE}/cases/${caseId}/execution/amcache/files${q ? '?' + q : ''}`) as Promise<{
      total: number
      items: AmcacheFileEntry[]
    }>
  },
  listPrograms(caseId: string, params: Record<string, string | number> = {}) {
    const q = new URLSearchParams(params as any).toString()
    return get(`${BASE}/cases/${caseId}/execution/amcache/programs${q ? '?' + q : ''}`) as Promise<{
      total: number
      items: AmcacheProgramEntry[]
    }>
  },
}
