import api from './client'
import type { Template, TTPDefinition } from '../types'

export const templatesApi = {
  list: () => api.get<Template[]>('/templates/').then(r => r.data),
  get: (id: string) => api.get<Template>(`/templates/${id}`).then(r => r.data),
  getRaw: (id: string) =>
    api.get<{ raw_yaml: string }>(`/templates/${id}/raw`).then(r => r.data.raw_yaml),
  update: (id: string, raw_yaml: string) =>
    api.put<Template>(`/templates/${id}`, { raw_yaml }).then(r => r.data),
  create: (raw_yaml: string) =>
    api.post<Template>('/templates/', { raw_yaml }).then(r => r.data),
  delete: (id: string) => api.delete(`/templates/${id}`),
  /** Replace the ttp_definitions list in a template YAML. */
  updateTTPs: (id: string, ttps: TTPDefinition[]) =>
    api.put<Template>(`/templates/${id}/ttps`, { ttps }).then(r => r.data),
}
