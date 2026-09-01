import api from './client'

/**
 * Registry Explorer.
 *
 * The hives listed here are ingest records, not a table of their own — the
 * same rows the ingest queue shows. Nothing is uploaded from this page: a hive
 * arrives through the drop folder like every other artifact.
 */

export interface RegistryHive {
  id: string
  name: string
  size_bytes: number
  sha256: string | null
  collection_id: string | null
  state: string
  preserved: boolean
  /** False once the file behind the record is gone — a deleted collection. */
  available: boolean
  created_at: string | null
}

export interface RegistryHiveInfo extends RegistryHive {
  /** The path Windows knew the hive by, from its header. */
  internal_name: string
  version: number
  /** Collected mid-write. Read as it stands; its newest values may be missing. */
  dirty: boolean
  in_transaction: boolean
  root_name: string
  subkey_count: number
  value_count: number
  /** What this browser does not do, said on the hive rather than in a manual. */
  limitations: string[]
}

export interface RegistryKey {
  name: string
  path: string
  subkey_count: number
  value_count: number
  last_written: string | null
}

export interface RegistryValue {
  name: string
  type: string
  size: number
  preview: string
  truncated: boolean
}

export interface RegistryValueDetail {
  name: string
  type: string
  size: number
  text: string
  hex: string
  truncated: boolean
}

export interface RegistrySearchHit {
  key_path: string
  value_name: string | null
  matched: 'key' | 'value_name' | 'value_data'
  preview: string
}

export interface RegistrySearchResult {
  query: string
  /** The walk stopped on its budget. A partial answer, and it says so. */
  exhausted: boolean
  scanned: number
  hits: RegistrySearchHit[]
}

const base = (caseId: string) => `/cases/${caseId}/registry/hives`

export const registryApi = {
  async hives(caseId: string): Promise<RegistryHive[]> {
    return (await api.get(base(caseId))).data
  },

  async info(caseId: string, hiveId: string): Promise<RegistryHiveInfo> {
    return (await api.get(`${base(caseId)}/${hiveId}`)).data
  },

  async keys(caseId: string, hiveId: string, path: string): Promise<RegistryKey[]> {
    const res = await api.get(`${base(caseId)}/${hiveId}/keys`, { params: { path } })
    return res.data.keys
  },

  async values(caseId: string, hiveId: string, path: string): Promise<RegistryValue[]> {
    const res = await api.get(`${base(caseId)}/${hiveId}/values`, { params: { path } })
    return res.data.values
  },

  async value(caseId: string, hiveId: string, path: string, name: string): Promise<RegistryValueDetail> {
    const res = await api.get(`${base(caseId)}/${hiveId}/value`, { params: { path, name } })
    return res.data
  },

  async search(
    caseId: string, hiveId: string, q: string,
    options: { values?: boolean; data?: boolean } = {},
  ): Promise<RegistrySearchResult> {
    const res = await api.get(`${base(caseId)}/${hiveId}/search`, {
      params: { q, values: options.values ?? true, data: options.data ?? true },
    })
    return res.data
  },
}
