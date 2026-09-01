const BASE = '/api/v1'

export interface ImportedFile {
  id: string
  filename: string
  file_size: number
  category: string | null
  category_label: string | null
  destination_page: string | null
  destination_label: string | null
  status: 'pending' | 'imported' | 'error' | 'unsupported'
  row_count: number
  error_message: string | null
  imported_at: string | null
  added_to_evidence: boolean
  /** Set once preserved in the chain of custody, which suspends `expires_at`. */
  evidence_id: string | null
  expires_at: string | null
  csv_artifact_id: string | null
  source_timezone: string | null
}

export interface GroupSummary {
  label: string
  destination_page: string | null
  files: string[]
  imported: number
  error: number
  unsupported: number
  total_rows: number
}

/** What deleting a collection would remove, per module. */
export interface DeletionPlan {
  /** Tables in the Artifact Explorer. */
  tables: number
  /** Files in the Logs module, with their events. */
  event_logs: number
  emails: number
  memory_dumps: number
  /** Rows in the collection's own ingest list. */
  files: number
  /** Kept: preserved in the chain of custody. */
  preserved: number
  bytes_on_disk: number
  preserved_names: string[]
}

export interface ImportedCollection {
  id: string
  case_id: string
  session_id: string | null
  filename: string
  file_size: number
  uploaded_at: string
  status: 'pending' | 'processing' | 'done' | 'error'
  total_files: number
  processed_files: number
  error_message: string | null
  files: ImportedFile[]
  groups?: GroupSummary[]
}

async function authHeaders(): Promise<Record<string, string>> {
  const token = localStorage.getItem('remora_token')
  return token ? { Authorization: `Bearer ${token}` } : {}
}

export const collectionImportApi = {
  async upload(caseId: string, files: File | File[], sessionId?: string): Promise<ImportedCollection> {
    const headers = await authHeaders()
    const form = new FormData()
    const fileList = Array.isArray(files) ? files : [files]
    for (const f of fileList) {
      // Use webkitRelativePath when available (folder uploads) so the backend
      // can detect the artifact type from the full relative path context.
      const relativePath = (f as any).webkitRelativePath as string | undefined
      const nameToSend = relativePath && relativePath.length > 0 ? relativePath : f.name
      form.append('files', f, nameToSend)
    }
    const url = sessionId
      ? `${BASE}/cases/${caseId}/collection-imports?session_id=${encodeURIComponent(sessionId)}`
      : `${BASE}/cases/${caseId}/collection-imports`
    const res = await fetch(url, {
      method: 'POST',
      headers,
      body: form,
      credentials: 'include',
    })
    if (!res.ok) throw new Error(await res.text())
    return res.json()
  },

  async list(caseId: string): Promise<ImportedCollection[]> {
    const headers = await authHeaders()
    const res = await fetch(`${BASE}/cases/${caseId}/collection-imports`, {
      headers,
      credentials: 'include',
    })
    if (!res.ok) throw new Error(await res.text())
    return res.json()
  },

  async get(caseId: string, collectionId: string): Promise<ImportedCollection> {
    const headers = await authHeaders()
    const res = await fetch(`${BASE}/cases/${caseId}/collection-imports/${collectionId}`, {
      headers,
      credentials: 'include',
    })
    if (!res.ok) throw new Error(await res.text())
    return res.json()
  },

  /**
   * What deleting this collection would remove, per module.
   *
   * Read-only, and asked for before the confirmation is shown. Deletion now
   * reaches into the Artifact Explorer, the Logs module and the others the
   * import fed; a confirmation that does not say what it takes is not one.
   */
  async deletionPlan(caseId: string, collectionId: string): Promise<DeletionPlan> {
    const headers = await authHeaders()
    const res = await fetch(
      `${BASE}/cases/${caseId}/collection-imports/${collectionId}/deletion-plan`,
      { headers, credentials: 'include' },
    )
    if (!res.ok) throw new Error(await res.text())
    return res.json()
  },

  async delete(caseId: string, collectionId: string): Promise<void> {
    const headers = await authHeaders()
    const res = await fetch(`${BASE}/cases/${caseId}/collection-imports/${collectionId}`, {
      method: 'DELETE',
      headers,
      credentials: 'include',
    })
    // Deletion is not reversible, so a failure has to surface. It used to be
    // discarded, and a refused delete looked exactly like a successful one
    // until the list refreshed with the collection still in it.
    if (!res.ok) throw new Error(await res.text())
  },

  async markEvidence(caseId: string, fileId: string, added: boolean, evidenceId?: string): Promise<ImportedFile> {
    const headers = await authHeaders()
    const res = await fetch(`${BASE}/cases/${caseId}/collection-imports/files/${fileId}/evidence`, {
      method: 'PATCH',
      headers: { ...headers, 'Content-Type': 'application/json' },
      credentials: 'include',
      body: JSON.stringify({ added, evidence_id: evidenceId }),
    })
    if (!res.ok) throw new Error(await res.text())
    return res.json()
  },

  async setFileTimezone(caseId: string, fileId: string, timezone: string | null): Promise<ImportedFile> {
    const headers = await authHeaders()
    const res = await fetch(`${BASE}/cases/${caseId}/collection-imports/files/${fileId}/timezone`, {
      method: 'PATCH',
      headers: { ...headers, 'Content-Type': 'application/json' },
      credentials: 'include',
      body: JSON.stringify({ timezone }),
    })
    if (!res.ok) throw new Error(await res.text())
    return res.json()
  },
}
