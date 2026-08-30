import {
  createContext, useContext, useState, useEffect, useCallback,
  type ReactNode,
} from 'react'
import api from '../api/client'
import { authApi, type AuthUser } from '../api/auth'
import { can as roleCan, type Permission } from '../auth/roles'

interface AuthState {
  user: AuthUser | null
  token: string | null
  loading: boolean
}

/** What a password step produced: a session, or a pending second factor. */
export interface LoginOutcome {
  mfaRequired: boolean
  mfaToken:    string | null
}

interface AuthContextValue extends AuthState {
  login: (username: string, password: string) => Promise<LoginOutcome>
  /** Finish a login that stopped at the second factor. */
  completeMfa: (mfaToken: string, code: string) => Promise<void>
  logout: () => void
  /** Mirrors the backend permission table. The backend is what enforces it. */
  can: (permission: Permission) => boolean
  isAdmin: boolean
  isOwnerOrAdmin: boolean
}

const AuthContext = createContext<AuthContextValue | null>(null)

const TOKEN_KEY = 'remora_token'

export function AuthProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<AuthState>({
    user: null,
    token: localStorage.getItem(TOKEN_KEY),
    loading: true,
  })

  // Validate stored token on mount
  useEffect(() => {
    const stored = localStorage.getItem(TOKEN_KEY)
    if (!stored) { setState(s => ({ ...s, loading: false })); return }
    api.defaults.headers.common['Authorization'] = `Bearer ${stored}`
    authApi.me()
      .then(user => setState({ user, token: stored, loading: false }))
      .catch(() => {
        localStorage.removeItem(TOKEN_KEY)
        delete api.defaults.headers.common['Authorization']
        setState({ user: null, token: null, loading: false })
      })
  }, [])

  const adopt = useCallback((token: string, user: AuthUser) => {
    localStorage.setItem(TOKEN_KEY, token)
    api.defaults.headers.common['Authorization'] = `Bearer ${token}`
    setState({ user, token, loading: false })
  }, [])

  const login = useCallback(async (username: string, password: string): Promise<LoginOutcome> => {
    const response = await authApi.login(username, password)

    // No session is stored when a second factor is pending. The intermediate
    // token is held by the login screen and never written to localStorage:
    // it is not a session, and storing it beside one invites treating it as one.
    if (response.mfa_required) {
      return { mfaRequired: true, mfaToken: response.mfa_token }
    }

    adopt(response.access_token!, response.user!)
    return { mfaRequired: false, mfaToken: null }
  }, [adopt])

  const completeMfa = useCallback(async (mfaToken: string, code: string) => {
    const response = await authApi.mfaVerify(mfaToken, code)
    adopt(response.access_token!, response.user!)
  }, [adopt])

  const logout = useCallback(() => {
    localStorage.removeItem(TOKEN_KEY)
    delete api.defaults.headers.common['Authorization']
    setState({ user: null, token: null, loading: false })
  }, [])

  // Intercept 401 globally → logout
  useEffect(() => {
    const id = api.interceptors.response.use(
      r => r,
      err => {
        // A 401 from the login screen is a wrong password or a wrong code, not
        // an expired session. Logging out on it would clear state that is not
        // there yet and hide the error the user needs to read.
        const url: string = err.config?.url ?? ''
        const isLoginStep = url.startsWith('/auth/login') || url.startsWith('/auth/mfa/verify')
        if (err.response?.status === 401 && !isLoginStep) logout()
        return Promise.reject(err)
      }
    )
    return () => api.interceptors.response.eject(id)
  }, [logout])

  const can = useCallback(
    (permission: Permission) => roleCan(state.user?.role, permission),
    [state.user?.role],
  )

  // owner is a superset of admin — both get full admin access
  const isAdmin = state.user?.role === 'admin' || state.user?.role === 'owner'
  const isOwnerOrAdmin = isAdmin

  return (
    <AuthContext.Provider value={{ ...state, login, completeMfa, logout, can, isAdmin, isOwnerOrAdmin }}>
      {children}
    </AuthContext.Provider>
  )
}

export function useAuth() {
  const ctx = useContext(AuthContext)
  if (!ctx) throw new Error('useAuth must be used inside AuthProvider')
  return ctx
}
