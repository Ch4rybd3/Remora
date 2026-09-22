import api from './client'

export interface DiskImageStatus {
  available:       boolean
  /** Paths as seen inside the container. */
  roots:           string[]
  configured:      boolean
  supported_exts:  string[]
  max_read_bytes:  number
  /**
   * Host-side path of the image directory — the one an analyst must target
   * when copying files in. Empty when not configured.
   */
  host_path:       string
}

/** A candidate found on the volume that this case has not registered yet. */
export interface DiskImageFile {
  path:     string
  name:     string
  root:     string
  rel_path: string
  size:     number
  modified: string
  format:   string
}

/**
 * An image this case has claimed.
 *
 * Registering copies nothing - the bytes stay on the mounted volume. The row
 * records that this case works on this acquisition, which is what makes the
 * image browsable and what puts it in the chain of custody.
 */
export interface RegisteredImage {
  id:            string
  case_id:       string
  path:          string
  name:          string
  size:          number
  format:        string
  registered_at: string | null
  registered_by: string | null
  /**
   * Whether the file is reachable right now.
   *
   * Resolved per request rather than stored: a volume can be unmounted between
   * two calls, and the registration deliberately outlives that - remounting
   * makes the image usable again without re-registering it.
   */
  available:     boolean
}

export interface Partition {
  number:    number
  offset:    number
  size:      number
  type:      string | null
  fs_type:   string | null
  label:     string | null
  /** False for unallocated space or an unsupported filesystem. */
  browsable: boolean
}

export interface DirEntry {
  name:   string
  path:   string
  is_dir: boolean
  size:   number | null
  mtime:  string | null
  atime:  string | null
  ctime:  string | null
  btime:  string | null
  /** Set when this entry could not be read — a damaged record, typically. */
  error:  string | null
}

export interface FilePreview {
  file:   string
  offset: number
  length: number
  total:  number
  /** Hex-encoded: a forensic preview must not mangle non-text bytes. */
  hex:    string
}

export interface FileHashes {
  size:   number
  md5:    string
  sha256: string
}

export interface ExtractResult {
  filename:  string
  dest_path: string
  size:      number
  md5:       string
  sha256:    string
  message:   string
}

export const diskImagesApi = {
  status: () => api.get<DiskImageStatus>('/disk-images/status').then(r => r.data),

  /** Images registered on this case. */
  list: (caseId: string) =>
    api.get<{ images: RegisteredImage[] }>(`/cases/${caseId}/disk-images`)
      .then(r => r.data.images),

  /** Images on the volume this case has not claimed yet. */
  available: (caseId: string) =>
    api.get<{ images: DiskImageFile[] }>(`/cases/${caseId}/disk-images/available`)
      .then(r => r.data.images),

  register: (caseId: string, path: string) =>
    api.post<RegisteredImage>(`/cases/${caseId}/disk-images`, { path })
      .then(r => r.data),

  /** Drops the case's claim. The file on the volume is untouched. */
  unregister: (caseId: string, imageId: string) =>
    api.delete(`/cases/${caseId}/disk-images/${imageId}`).then(() => undefined),

  partitions: (caseId: string, imageId: string) =>
    api.get<{ partitions: Partition[] }>(`/cases/${caseId}/disk-images/${imageId}/partitions`)
      .then(r => r.data.partitions),

  listDir: (caseId: string, imageId: string, partition: number, dir: string) =>
    api.get<{ entries: DirEntry[] }>(`/cases/${caseId}/disk-images/${imageId}/list`,
      { params: { partition, dir } }).then(r => r.data.entries),

  preview: (caseId: string, imageId: string, partition: number, file: string,
            offset = 0, length = 4096) =>
    api.get<FilePreview>(`/cases/${caseId}/disk-images/${imageId}/preview`,
      { params: { partition, file, offset, length } }).then(r => r.data),

  hash: (caseId: string, imageId: string, partition: number, file: string) =>
    api.get<FileHashes>(`/cases/${caseId}/disk-images/${imageId}/hash`,
      { params: { partition, file } }).then(r => r.data),

  /** Carve a file into the case drop folder, where ingestion picks it up. */
  extract: (caseId: string, imageId: string, partition: number, file: string) =>
    api.post<ExtractResult>(`/cases/${caseId}/disk-images/${imageId}/extract`,
      { partition, file }).then(r => r.data),

  downloadUrl: (caseId: string, imageId: string, partition: number, file: string) =>
    `/api/v1/cases/${caseId}/disk-images/${imageId}/download?${new URLSearchParams({
      partition: String(partition), file,
    })}`,
}
