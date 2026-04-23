import api from './client'

export interface AuthUser {
  id: string
  username: string
  email: string | null
  role: 'admin' | 'owner' | 'analyst'
  is_active: boolean
  created_at: string
  last_login: string | null
}

export interface TokenResponse {
  access_token: string
  token_type: string
  user: AuthUser
}

export const authApi = {
  login: (username: string, password: string) =>
    api.post<TokenResponse>('/auth/login', { username, password }).then(r => r.data),
  me: () => api.get<AuthUser>('/auth/me').then(r => r.data),
}

export const usersApi = {
  list: () => api.get<AuthUser[]>('/users/').then(r => r.data),
  create: (data: { username: string; email?: string; password: string; role: string }) =>
    api.post<AuthUser>('/users/', data).then(r => r.data),
  update: (id: string, data: { role?: string; is_active?: boolean }) =>
    api.patch<AuthUser>(`/users/${id}`, data).then(r => r.data),
  changePassword: (id: string, new_password: string) =>
    api.post<AuthUser>(`/users/${id}/password`, { new_password }).then(r => r.data),
  delete: (id: string) => api.delete(`/users/${id}`),
}
