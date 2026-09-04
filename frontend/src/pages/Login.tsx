import { useState, type FormEvent } from 'react'
import { useNavigate, useLocation } from 'react-router-dom'
import { useAuth } from '../context/AuthContext'
import { AlertCircle, Eye, EyeOff } from '../ui/icons'

export default function Login() {
  const { login, completeMfa } = useAuth()
  const navigate = useNavigate()
  const location = useLocation()
  const from = (location.state as any)?.from?.pathname ?? '/'

  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [showPw, setShowPw] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)

  // The token issued between the password and the second factor. Held here and
  // never written to storage: it is not a session, and keeping it beside one
  // invites treating it as one.
  const [mfaToken, setMfaToken] = useState<string | null>(null)
  const [code, setCode] = useState('')

  const submit = async (e: FormEvent) => {
    e.preventDefault()
    setError(null)
    setLoading(true)
    try {
      const outcome = await login(username, password)
      if (outcome.mfaRequired) {
        setMfaToken(outcome.mfaToken)
        setCode('')
        return
      }
      navigate(from, { replace: true })
    } catch (err: any) {
      setError(err.response?.data?.detail ?? 'Could not sign in')
    } finally {
      setLoading(false)
    }
  }

  const submitCode = async (e: FormEvent) => {
    e.preventDefault()
    setError(null)
    setLoading(true)
    try {
      await completeMfa(mfaToken!, code)
      navigate(from, { replace: true })
    } catch (err: any) {
      setError(err.response?.data?.detail ?? 'Could not verify that code')
      setCode('')
    } finally {
      setLoading(false)
    }
  }

  const restart = () => {
    setMfaToken(null)
    setCode('')
    setPassword('')
    setError(null)
  }

  return (
    <div className="min-h-screen bg-canvas flex items-center justify-center px-4">
      {/* Background grid */}
      <div
        className="absolute inset-0 opacity-[0.03]"
        style={{
          backgroundImage: 'linear-gradient(#2DD4BF 1px, transparent 1px), linear-gradient(90deg, #2DD4BF 1px, transparent 1px)',
          backgroundSize: '48px 48px',
        }}
      />

      <div className="relative w-full max-w-sm">
        {/* Logo */}
        <div className="flex flex-col items-center mb-10">
          <img
            src="/logo.png"
            alt="Remora"
            className="h-16 w-auto object-contain mb-4"
            style={{ filter: 'drop-shadow(0 0 12px rgba(45,212,191,0.35))' }}
            onError={e => { (e.target as HTMLImageElement).style.display = 'none' }}
          />
          <h1 className="text-title font-bold text-accent font-mono tracking-tight">REMORA</h1>
          <p className="text-fg-secondary text-ui mt-1">DFIR Case Management</p>
        </div>

        {/* Card */}
        <div className="card p-8 border-hairline">
          <h2 className="text-fg font-semibold text-ui uppercase tracking-wide mb-6">
            {mfaToken ? 'Two-factor authentication' : 'Sign in'}
          </h2>

          {error && (
            <div className="flex items-center gap-2 bg-severity-critical/10 border border-severity-critical/20 px-4 py-3 mb-5">
              <AlertCircle size={14} className="text-severity-critical shrink-0" />
              <p className="text-label text-severity-critical">{error}</p>
            </div>
          )}

          {mfaToken ? (
            <form onSubmit={submitCode} className="space-y-4">
              <p className="text-label text-fg-secondary">
                Enter the six-digit code from your authenticator app, or one of your
                recovery codes.
              </p>

              <div>
                <label className="label">Code</label>
                <input
                  className="input font-mono tracking-[0.3em] text-center"
                  // `one-time-code` lets a phone offer the code from its SMS or
                  // authenticator, and stops a password manager filling it.
                  autoComplete="one-time-code"
                  inputMode="text"
                  autoFocus
                  placeholder="000000"
                  value={code}
                  onChange={e => setCode(e.target.value)}
                  required
                />
              </div>

              <button
                type="submit"
                disabled={loading || !code.trim()}
                className="btn-primary w-full mt-2 py-2.5 text-ui"
              >
                {loading ? 'Verifying…' : 'Verify'}
              </button>

              <button
                type="button"
                onClick={restart}
                className="w-full text-label text-fg-secondary hover:text-fg transition-colors"
              >
                Start over
              </button>
            </form>
          ) : (
            <form onSubmit={submit} className="space-y-4">
              <div>
                <label className="label">Username</label>
                <input
                  className="input"
                  autoComplete="username"
                  placeholder="admin"
                  value={username}
                  onChange={e => setUsername(e.target.value)}
                  required
                />
              </div>

              <div>
                <label className="label">Password</label>
                <div className="relative">
                  <input
                    className="input pr-10"
                    type={showPw ? 'text' : 'password'}
                    autoComplete="current-password"
                    placeholder="••••••••"
                    value={password}
                    onChange={e => setPassword(e.target.value)}
                    required
                  />
                  <button
                    type="button"
                    className="absolute right-3 top-1/2 -translate-y-1/2 text-fg-secondary hover:text-fg transition-colors"
                    onClick={() => setShowPw(v => !v)}
                    tabIndex={-1}
                  >
                    {showPw ? <EyeOff size={15} /> : <Eye size={15} />}
                  </button>
                </div>
              </div>

              <button
                type="submit"
                disabled={loading || !username || !password}
                className="btn-primary w-full mt-2 py-2.5 text-ui"
              >
                {loading ? 'Signing in…' : 'Sign in'}
              </button>
            </form>
          )}
        </div>

        <p className="text-center text-fg-secondary/40 text-label mt-6">
          Sessions last 24 hours
        </p>
      </div>
    </div>
  )
}
