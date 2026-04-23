import {
  createContext, useContext, useState, useEffect, useCallback,
  type ReactNode,
} from 'react'
import api from '../api/client'
import { authApi, type AuthUser } from '../api/auth'

interface AuthState {
  user: AuthUser | null
  token: string | null
  loading: boolean
}

interface AuthContextValue extends AuthState {
  login: (username: string, password: string) => Promise<void>
  logout: () => void
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

  const login = useCallback(async (username: string, password: string) => {
    const { access_token, user } = await authApi.login(username, password)
    localStorage.setItem(TOKEN_KEY, access_token)
    api.defaults.headers.common['Authorization'] = `Bearer ${access_token}`
    setState({ user, token: access_token, loading: false })
  }, [])

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
        if (err.response?.status === 401) logout()
        return Promise.reject(err)
      }
    )
    return () => api.interceptors.response.eject(id)
  }, [logout])

  const isAdmin = state.user?.role === 'admin'
  const isOwnerOrAdmin = state.user?.role === 'admin' || state.user?.role === 'owner'

  return (
    <AuthContext.Provider value={{ ...state, login, logout, isAdmin, isOwnerOrAdmin }}>
      {children}
    </AuthContext.Provider>
  )
}

export function useAuth() {
  const ctx = useContext(AuthContext)
  if (!ctx) throw new Error('useAuth must be used inside AuthProvider')
  return ctx
}
