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

export interface DiskImageFile {
  path:     string
  name:     string
  root:     string
  rel_path: string
  size:     number
  modified: string
  format:   string
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

  list: () => api.get<{ images: DiskImageFile[] }>('/disk-images').then(r => r.data.images),

  partitions: (path: string) =>
    api.get<{ partitions: Partition[] }>('/disk-images/partitions', { params: { path } })
      .then(r => r.data.partitions),

  listDir: (path: string, partition: number, dir: string) =>
    api.get<{ entries: DirEntry[] }>('/disk-images/list',
      { params: { path, partition, dir } }).then(r => r.data.entries),

  preview: (path: string, partition: number, file: string, offset = 0, length = 4096) =>
    api.get<FilePreview>('/disk-images/preview',
      { params: { path, partition, file, offset, length } }).then(r => r.data),

  hash: (path: string, partition: number, file: string) =>
    api.get<FileHashes>('/disk-images/hash',
      { params: { path, partition, file } }).then(r => r.data),

  /** Carve a file into the case drop folder, where ingestion picks it up. */
  extract: (caseId: string, path: string, partition: number, file: string) =>
    api.post<ExtractResult>(`/cases/${caseId}/disk-images/extract`,
      { path, partition, file }).then(r => r.data),

  downloadUrl: (path: string, partition: number, file: string) =>
    `/api/v1/disk-images/download?${new URLSearchParams({
      path, partition: String(partition), file,
    })}`,
}
