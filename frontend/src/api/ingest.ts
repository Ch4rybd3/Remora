/**
 * The ingest queue.
 *
 * What the pipeline has seen for a case and what it decided, plus the two
 * actions the recoverable states call for. This is the view that makes
 * "what has been ingested here?" answerable - the question fourteen
 * independent upload endpoints could not answer between them.
 */
const BASE = '/api/v1'

export type IngestState =
  | 'discovered' | 'hashed' | 'duplicate' | 'identified' | 'unidentified'
  | 'routed' | 'parsed' | 'indexed'
  /** Stored, and a module opens it as it stands. A registry hive. Terminal. */
  | 'browsable'
  | 'failed' | 'unsupported'

export interface IngestedFile {
  id:                string
  original_name:     string
  size_bytes:        number
  origin:            'dropzone' | 'upload' | 'archive' | 'connector' | 'legacy'
  origin_detail:     string | null
  sha256:            string | null
  magic_type:        string | null
  detected_kind:     string | null
  detection_source:  'magic' | 'extension' | 'folder_hint' | 'content' | 'forced' | null
  source_timezone:   string | null
  state:             IngestState
  error:             string | null
  routed_to:         string | null
  parent_id:         string | null
  collection_id:     string | null
  /** The analyst can act on this one: force a type, or retry it. */
  recoverable:       boolean
  evidence_id:       string | null
  /** Preserved in the chain of custody, so the collection expiry no longer applies. */
  preserved:         boolean
  destination_pages: string[]
  created_at:        string | null
}

export interface IngestKind {
  kind:        string
  destination: string | null
  parser:      string | null
  /** False when the type is recognised but its parser has not shipped. */
  available:   boolean
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

export const ingestApi = {
  list(caseId: string, state?: IngestState) {
    const query = state ? `?state=${encodeURIComponent(state)}` : ''
    return fetch(`${BASE}/cases/${caseId}/ingest${query}`, { headers: authHeaders() })
      .then(r => unwrap<{ files: IngestedFile[]; summary: Record<string, number> }>(r))
  },

  kinds() {
    return fetch(`${BASE}/ingest/kinds`, { headers: authHeaders() })
      .then(r => unwrap<{ kinds: IngestKind[] }>(r))
  },

  /** Override the detected type. Outranks every other detection source. */
  forceKind(caseId: string, fileId: string, kind: string) {
    return fetch(`${BASE}/cases/${caseId}/ingest/${fileId}/force-kind`, {
      method:  'POST',
      headers: { ...authHeaders(), 'Content-Type': 'application/json' },
      body:    JSON.stringify({ kind }),
    }).then(r => unwrap<IngestedFile>(r))
  },

  /**
   * Tell the pipeline which OS a raw memory image came from, and parse it.
   *
   * Only raw dumps need this. A Windows crash dump and a LiME image say which
   * OS they are in their header, and are parsed without asking.
   */
  setMemoryOs(caseId: string, fileId: string, osType: 'windows' | 'linux') {
    return fetch(`${BASE}/cases/${caseId}/ingest/${fileId}/memory-os`, {
      method:  'POST',
      headers: { ...authHeaders(), 'Content-Type': 'application/json' },
      body:    JSON.stringify({ os_type: osType }),
    }).then(r => unwrap<IngestedFile>(r))
  },

  retry(caseId: string, fileId: string) {
    return fetch(`${BASE}/cases/${caseId}/ingest/${fileId}/retry`, {
      method: 'POST', headers: authHeaders(),
    }).then(r => unwrap<IngestedFile>(r))
  },

  /** Where to copy files by hand, for the analyst not going through the browser. */
  dropPath(caseId: string) {
    return fetch(`${BASE}/cases/${caseId}/ingest/drop-path`, { headers: authHeaders() })
      .then(r => unwrap<{ container_path: string; folder_name: string }>(r))
  },
}
