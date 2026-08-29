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

/**
 * A finished login, or one waiting on its second factor.
 *
 * One shape rather than two: when `mfa_required` is set there is no session
 * yet, and `mfa_token` is what the code check is presented with. It authorises
 * nothing else - the backend refuses it anywhere but `/auth/mfa/verify`.
 */
export interface TokenResponse {
  access_token: string | null
  token_type: string
  user: AuthUser | null
  mfa_required: boolean
  mfa_token: string | null
}

export interface MfaStatus {
  enabled:              boolean
  enrolled_at:          string | null
  recovery_codes_left:  number
  recovery_codes_total: number
}

export interface MfaEnrolment {
  /** Inline SVG, rendered server-side so no QR library ships to the browser. */
  qr_svg:           string
  provisioning_uri: string
  /** Returned once and never again - they are stored hashed. */
  recovery_codes:   string[]
}

export const authApi = {
  login: (username: string, password: string) =>
    api.post<TokenResponse>('/auth/login', { username, password }).then(r => r.data),
  me: () => api.get<AuthUser>('/auth/me').then(r => r.data),

  mfaVerify: (mfa_token: string, code: string) =>
    api.post<TokenResponse>('/auth/mfa/verify', { mfa_token, code }).then(r => r.data),
  mfaStatus: () => api.get<MfaStatus>('/auth/mfa/status').then(r => r.data),
  mfaSetup: () => api.post<MfaEnrolment>('/auth/mfa/setup').then(r => r.data),
  mfaConfirm: (code: string) =>
    api.post('/auth/mfa/confirm', { code }).then(r => r.data),
  mfaDisable: (password: string, code: string) =>
    api.post('/auth/mfa/disable', { password, code }).then(r => r.data),
  mfaNewRecoveryCodes: (password: string, code: string) =>
    api.post<{ recovery_codes: string[] }>('/auth/mfa/recovery-codes', { password, code })
      .then(r => r.data),
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
