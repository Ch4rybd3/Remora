import api from './client'

export interface VaultEntry {
  id:          number
  name:        string
  description: string
  tags:        string
  file_name:   string
  file_size:   number
  mime_type:   string
  created_at:  string
  created_by:  string | null
}

export interface VaultPatch {
  name?:        string
  description?: string
  tags?:        string
}

export const vaultApi = {
  list: () =>
    api.get<VaultEntry[]>('/vaults/').then(r => r.data),

  upload: (payload: { name: string; description: string; tags: string; file: File }) => {
    const fd = new FormData()
    fd.append('name', payload.name)
    fd.append('description', payload.description)
    fd.append('tags', payload.tags)
    fd.append('file', payload.file)
    return api.post<VaultEntry>('/vaults/upload', fd, {
      headers: { 'Content-Type': 'multipart/form-data' },
    }).then(r => r.data)
  },

  update: (id: number, patch: VaultPatch) =>
    api.patch<VaultEntry>(`/vaults/${id}`, patch).then(r => r.data),

  downloadUrl: (id: number) => `/api/v1/vaults/${id}/download`,
  viewUrl:     (id: number) => `/api/v1/vaults/${id}/view`,

  delete: (id: number) => api.delete(`/vaults/${id}`),
}
