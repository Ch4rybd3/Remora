import api from './client'
import type { Client, ClientSummary, ClientDocTemplate, ClientDocument } from '../types'

export const clientsApi = {
  list: () => api.get<ClientSummary[]>('/clients/').then(r => r.data),
  get: (id: string) => api.get<Client>(`/clients/${id}`).then(r => r.data),
  create: (data: Partial<Client>) => api.post<Client>('/clients/', data).then(r => r.data),
  update: (id: string, data: Partial<Client>) => api.patch<Client>(`/clients/${id}`, data).then(r => r.data),
  delete: (id: string) => api.delete(`/clients/${id}`),

  listDocTemplates: () => api.get<ClientDocTemplate[]>('/clients/doc-templates').then(r => r.data),
  createDocTemplate: (data: Partial<ClientDocTemplate>) =>
    api.post<ClientDocTemplate>('/clients/doc-templates', data).then(r => r.data),
  updateDocTemplate: (id: string, data: Partial<ClientDocTemplate>) =>
    api.patch<ClientDocTemplate>(`/clients/doc-templates/${id}`, data).then(r => r.data),
  deleteDocTemplate: (id: string) => api.delete(`/clients/doc-templates/${id}`),

  listDocuments: (clientId: string) =>
    api.get<ClientDocument[]>(`/clients/${clientId}/documents`).then(r => r.data),
  uploadDocument: (clientId: string, params: { file: File; slot?: string | null; name?: string; description?: string }) => {
    const fd = new FormData()
    fd.append('file', params.file)
    if (params.slot) fd.append('slot', params.slot)
    if (params.name) fd.append('name', params.name)
    if (params.description) fd.append('description', params.description)
    return api.post<ClientDocument>(`/clients/${clientId}/documents/upload`, fd, {
      headers: { 'Content-Type': 'multipart/form-data' },
    }).then(r => r.data)
  },
  updateDocument: (clientId: string, docId: string, data: Partial<ClientDocument>) =>
    api.patch<ClientDocument>(`/clients/${clientId}/documents/${docId}`, data).then(r => r.data),
  deleteDocument: (clientId: string, docId: string) =>
    api.delete(`/clients/${clientId}/documents/${docId}`),

  documentContent: (clientId: string, docId: string) =>
    api.get<Blob>(`/clients/${clientId}/documents/${docId}/content`, { responseType: 'blob' }).then(r => r.data),
}
