import api from './client'

export interface CustomRole {
  id: string
  name: string
  description: string | null
  color: string | null
  can_write: boolean
  can_read_artifacts: boolean
  can_change_own_password: boolean
  created_at: string
  updated_at: string
}

export interface CustomRoleCreate {
  name: string
  description?: string
  color?: string
  can_write: boolean
  can_read_artifacts: boolean
  can_change_own_password: boolean
}

export interface CustomRoleUpdate {
  name?: string
  description?: string
  color?: string
  can_write?: boolean
  can_read_artifacts?: boolean
  can_change_own_password?: boolean
}

export const customRolesApi = {
  list: () => api.get<CustomRole[]>('/custom-roles/').then(r => r.data),
  get: (id: string) => api.get<CustomRole>(`/custom-roles/${id}`).then(r => r.data),
  create: (data: CustomRoleCreate) =>
    api.post<CustomRole>('/custom-roles/', data).then(r => r.data),
  update: (id: string, data: CustomRoleUpdate) =>
    api.patch<CustomRole>(`/custom-roles/${id}`, data).then(r => r.data),
  delete: (id: string) => api.delete(`/custom-roles/${id}`),
}
