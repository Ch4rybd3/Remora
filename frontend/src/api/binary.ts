import api from './client'

export interface BinaryFile {
  id:                string
  case_id:           string
  filename:          string
  sha256_hash:       string | null
  file_size:         number | null
  binary_type:       string | null
  status:            'pending' | 'analysing' | 'ready' | 'error'
  error_msg:         string | null
  uploaded_at:       string
  analysed_at:       string | null
  added_to_evidence: boolean
}

export interface SectionInfo {
  name:            string
  virtual_address: number
  virtual_size:    number
  raw_size:        number
  entropy:         number
  characteristics: string | null
}

export interface ImportLib {
  library:   string
  functions: string[]
}

export interface StringEntry {
  offset:   number
  value:    string
  encoding: 'ascii' | 'utf-16'
}

export interface DisassemblyLine {
  address:   number
  bytes_hex: string
  mnemonic:  string
  op_str:    string
}

export interface BinaryAnalysis {
  binary_type:     string
  architecture:    string | null
  entrypoint:      number | null
  image_base:      number | null
  overall_entropy: number
  sections:        SectionInfo[]
  imports:         ImportLib[]
  exports:         string[]
  strings:         StringEntry[]
  disassembly:     DisassemblyLine[]
}

export const binaryApi = {
  upload: (caseId: string, file: File, password: string) => {
    const fd = new FormData()
    fd.append('file', file)
    fd.append('password', password)
    return api.post<BinaryFile>(`/binary/${caseId}/upload`, fd, {
      headers: { 'Content-Type': 'multipart/form-data' },
    }).then(r => r.data)
  },

  listFiles: (caseId: string) =>
    api.get<BinaryFile[]>(`/binary/${caseId}/files`).then(r => r.data),

  getFile: (caseId: string, fileId: string) =>
    api.get<BinaryFile>(`/binary/${caseId}/files/${fileId}`).then(r => r.data),

  deleteFile: (caseId: string, fileId: string) =>
    api.delete(`/binary/${caseId}/files/${fileId}`),

  getAnalysis: (caseId: string, fileId: string) =>
    api.get<BinaryAnalysis>(`/binary/${caseId}/files/${fileId}/analysis`).then(r => r.data),

  reanalyse: (caseId: string, fileId: string, password: string) => {
    const fd = new FormData()
    fd.append('password', password)
    return api.post<BinaryFile>(`/binary/${caseId}/files/${fileId}/reanalyse`, fd, {
      headers: { 'Content-Type': 'multipart/form-data' },
    }).then(r => r.data)
  },

  addEvidence: (caseId: string, fileId: string) =>
    api.post<BinaryFile>(`/binary/${caseId}/files/${fileId}/add-evidence`).then(r => r.data),
}
