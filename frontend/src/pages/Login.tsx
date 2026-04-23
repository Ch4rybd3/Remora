import { useState, type FormEvent } from 'react'
import { useNavigate, useLocation } from 'react-router-dom'
import { useAuth } from '../context/AuthContext'
import { AlertCircle, Eye, EyeOff } from 'lucide-react'

export default function Login() {
  const { login } = useAuth()
  const navigate = useNavigate()
  const location = useLocation()
  const from = (location.state as any)?.from?.pathname ?? '/'

  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [showPw, setShowPw] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)

  const submit = async (e: FormEvent) => {
    e.preventDefault()
    setError(null)
    setLoading(true)
    try {
      await login(username, password)
      navigate(from, { replace: true })
    } catch (err: any) {
      setError(err.response?.data?.detail ?? 'Connexion impossible')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="min-h-screen bg-bg-primary flex items-center justify-center px-4">
      {/* Background grid */}
      <div
        className="absolute inset-0 opacity-[0.03]"
        style={{
          backgroundImage: 'linear-gradient(#9FEF00 1px, transparent 1px), linear-gradient(90deg, #9FEF00 1px, transparent 1px)',
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
            style={{ filter: 'drop-shadow(0 0 12px rgba(159,239,0,0.35))' }}
            onError={e => { (e.target as HTMLImageElement).style.display = 'none' }}
          />
          <h1 className="text-3xl font-bold text-accent-green font-mono tracking-tight">REMORA</h1>
          <p className="text-accent-muted text-sm mt-1">DFIR Case Management</p>
        </div>

        {/* Card */}
        <div className="card p-8 border-white/10">
          <h2 className="text-white font-semibold text-sm uppercase tracking-wide mb-6">
            Connexion
          </h2>

          {error && (
            <div className="flex items-center gap-2 bg-severity-critical/10 border border-severity-critical/20 rounded-lg px-4 py-3 mb-5">
              <AlertCircle size={14} className="text-severity-critical shrink-0" />
              <p className="text-xs text-severity-critical">{error}</p>
            </div>
          )}

          <form onSubmit={submit} className="space-y-4">
            <div>
              <label className="label">Nom d'utilisateur</label>
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
              <label className="label">Mot de passe</label>
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
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-accent-muted hover:text-white transition-colors"
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
              className="btn-primary w-full mt-2 py-2.5 text-sm"
            >
              {loading ? 'Connexion…' : 'Se connecter'}
            </button>
          </form>
        </div>

        <p className="text-center text-accent-muted/40 text-xs mt-6">
          Sessions valides 24h
        </p>
      </div>
    </div>
  )
}
