/**
 * Chain of custody.
 *
 * One endpoint for every page that lists artifacts. A page does not build its
 * own promotion request: it names what kind of thing it is showing and the
 * backend resolves the rest, so "preserve this" means the same thing in the
 * Collection tab, the Artifact Explorer, and whatever page comes next.
 */
const BASE = '/api/v1'

/** Kinds registered in `backend/app/services/custody.py`. */
export type CustodySourceKind = 'ingested_file' | 'artifact'

export interface CustodyItem {
  id:                string
  name:              string
  description:       string
  evidence_type:     string | null
  original_filename: string
  file_size:         number
  md5_hash:          string
  sha256_hash:       string
  collected_by:      string
  collected_at:      string | null
  tags:              string
  chain_of_custody:  string
  /** Stored inside a password-protected archive because it was flagged an IOC. */
  contained:         boolean
  /** Shown next to the download so nobody has to be told it out of band. */
  archive_password:  string | null
  created_at:        string | null
}

export interface CustodySummary {
  preserved: number
  contained: number
}

function authHeaders(): Record<string, string> {
  const token = localStorage.getItem('remora_token')
  return token ? { Authorization: `Bearer ${token}` } : {}
}

async function unwrap<T>(response: Response): Promise<T> {
  if (!response.ok) {
    const body = await response.json().catch(() => null)
    throw new Error(body?.detail ?? `Request failed (${response.status})`)
  }
  return response.status === 204 ? (undefined as T) : response.json()
}

export const custodyApi = {
  list(caseId: string): Promise<{ items: CustodyItem[]; summary: CustodySummary }> {
    return fetch(`${BASE}/cases/${caseId}/custody`, { headers: authHeaders() }).then(r => unwrap<{ items: CustodyItem[]; summary: CustodySummary }>(r))
  },

  /**
   * Preserve an artifact as evidence.
   *
   * `asIoc` wraps the preserved copy in a password-protected archive. Use it
   * for anything that could execute: it is what stops a double-click after a
   * download, and stops endpoint protection quarantining a sample out of the
   * evidence store.
   */
  promote(
    caseId: string,
    kind: CustodySourceKind,
    sourceId: string,
    options: { asIoc?: boolean; name?: string; description?: string; tags?: string } = {},
  ): Promise<CustodyItem> {
    return fetch(`${BASE}/cases/${caseId}/custody`, {
      method:  'POST',
      headers: { ...authHeaders(), 'Content-Type': 'application/json' },
      body:    JSON.stringify({
        kind, source_id: sourceId, as_ioc: options.asIoc ?? false,
        name: options.name, description: options.description, tags: options.tags,
      }),
    }).then(r => unwrap<CustodyItem>(r))
  },

  /** Remove an item and delete its preserved copy. The reason is mandatory. */
  withdraw(caseId: string, evidenceId: string, reason: string): Promise<void> {
    return fetch(`${BASE}/cases/${caseId}/custody/${evidenceId}`, {
      method:  'DELETE',
      headers: { ...authHeaders(), 'Content-Type': 'application/json' },
      body:    JSON.stringify({ reason }),
    }).then(r => unwrap<void>(r))
  },

  sourceKinds(): Promise<{ kinds: CustodySourceKind[] }> {
    return fetch(`${BASE}/custody/source-kinds`, { headers: authHeaders() })
      .then(r => unwrap<{ kinds: CustodySourceKind[] }>(r))
  },
}
