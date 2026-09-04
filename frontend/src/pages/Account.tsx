/**
 * The signed-in user's own account.
 *
 * Exists because two-factor authentication needs somewhere to live that is not
 * user administration: enrolling a second factor is something you do for
 * yourself, and an admin must not be able to do it for you - a factor someone
 * else enrolled is not a second factor.
 */
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useState } from 'react'

import { authApi } from '../api/auth'
import { useAuth } from '../context/AuthContext'
import { CopyButton } from '../components/custody/CustodyActions'
import Modal from '../components/ui/Modal'
import { AlertTriangle, Check, Lock, ShieldCheck, ShieldX } from '../ui/icons'
import { PageShell } from '../ui/PageShell'
import { Panel, PanelHeader } from '../ui/Panel'

export default function Account() {
  const { user } = useAuth()

  return (
    <PageShell
      route="/account"
      title="Account"
      subtitle={user ? `Signed in as ${user.username}` : undefined}
    >
      <div className="max-w-2xl space-y-4">
        <TwoFactorPanel />
      </div>
    </PageShell>
  )
}

// ─── Two-factor ───────────────────────────────────────────────────────────────

function TwoFactorPanel() {
  const qc = useQueryClient()
  const [enrolling, setEnrolling] = useState(false)
  const [disabling, setDisabling] = useState(false)
  const [reissuing, setReissuing] = useState(false)

  const { data: status, isLoading } = useQuery({
    queryKey: ['mfa-status'],
    queryFn:  () => authApi.mfaStatus(),
  })

  const refresh = () => qc.invalidateQueries({ queryKey: ['mfa-status'] })
  const low = !!status && status.enabled && status.recovery_codes_left <= 2

  return (
    <Panel>
      <PanelHeader title="Two-factor authentication" />

      <div className="p-4 space-y-4">
        {isLoading ? (
          <p className="text-label text-fg-muted">Loading…</p>
        ) : status?.enabled ? (
          <>
            <div className="flex items-center gap-2">
              <ShieldCheck size={14} className="text-accent shrink-0" />
              <span className="text-ui text-fg">Enabled</span>
              {status.enrolled_at && (
                <span className="text-label text-fg-muted">
                  since {new Date(status.enrolled_at).toLocaleDateString()}
                </span>
              )}
            </div>

            <p className="text-label text-fg-secondary">
              A code from your authenticator app is required at every sign-in.
            </p>

            <div className={`flex items-center gap-2 text-label ${
              low ? 'text-severity-medium' : 'text-fg-muted'}`}>
              {low && <AlertTriangle size={11} className="shrink-0" />}
              {status.recovery_codes_left} of {status.recovery_codes_total} recovery
              codes left
              {low && ' — issue a new set before you run out.'}
            </div>

            <div className="flex gap-2 pt-1">
              <button onClick={() => setReissuing(true)} className="btn-secondary text-label">
                New recovery codes
              </button>
              <button onClick={() => setDisabling(true)} className="btn-secondary text-label">
                Turn off
              </button>
            </div>
          </>
        ) : (
          <>
            <div className="flex items-center gap-2">
              <ShieldX size={14} className="text-severity-medium shrink-0" />
              <span className="text-ui text-fg">Not enabled</span>
            </div>
            <p className="text-label text-fg-secondary">
              Your password is the only thing protecting this account, and the cases in
              it. A second factor means a leaked or reused password is not enough on
              its own.
            </p>
            <button onClick={() => setEnrolling(true)} className="btn-primary text-label">
              Set up
            </button>
          </>
        )}
      </div>

      {enrolling && <EnrolDialog onClose={() => { setEnrolling(false); refresh() }} />}
      {disabling && <DisableDialog onClose={() => { setDisabling(false); refresh() }} />}
      {reissuing && <ReissueDialog onClose={() => { setReissuing(false); refresh() }} />}
    </Panel>
  )
}

/** Enrolment: scan, then prove it works. Two steps on purpose. */
function EnrolDialog({ onClose }: { onClose: () => void }) {
  const [code, setCode] = useState('')
  const [saved, setSaved] = useState(false)

  const setup = useQuery({
    queryKey: ['mfa-setup'],
    queryFn:  () => authApi.mfaSetup(),
    // Each call mints a new secret and a new set of recovery codes, so a
    // refetch would silently invalidate the codes already on screen.
    staleTime: Infinity,
    gcTime: 0,
    retry: false,
  })

  const confirm = useMutation({
    mutationFn: () => authApi.mfaConfirm(code),
    onSuccess: onClose,
  })

  return (
    <Modal open onClose={onClose} title="Set up two-factor authentication" size="md">
      {setup.isLoading ? (
        <p className="text-label text-fg-muted">Preparing…</p>
      ) : setup.isError ? (
        <p className="text-label text-severity-critical">
          {(setup.error as any)?.response?.data?.detail ?? 'Could not start enrolment'}
        </p>
      ) : setup.data ? (
        <div className="space-y-5">
          <div>
            <p className="text-ui text-fg mb-2">1. Scan this with your authenticator</p>
            <div className="flex items-start gap-4">
              {/* Rendered server-side as inline SVG, so no QR library ships to
                  the browser and the secret is never turned into an image here.
                  Black on white because a QR read light-on-dark is rejected by
                  many phone scanners. */}
              <div className="bg-white p-2 rounded-control shrink-0"
                dangerouslySetInnerHTML={{ __html: setup.data.qr_svg }} />
              <div className="min-w-0">
                <p className="text-label text-fg-secondary mb-1">
                  Or enter the key by hand:
                </p>
                <div className="flex items-center gap-1">
                  <code className="text-label font-mono text-fg break-all">
                    {new URL(setup.data.provisioning_uri.replace('otpauth://', 'https://'))
                      .searchParams.get('secret')}
                  </code>
                  <CopyButton
                    value={new URL(setup.data.provisioning_uri.replace('otpauth://', 'https://'))
                      .searchParams.get('secret') ?? ''}
                    label="Copy key" />
                </div>
              </div>
            </div>
          </div>

          <div>
            <p className="text-ui text-fg mb-2">2. Save your recovery codes</p>
            <div className="flex items-start gap-2 mb-2">
              <Lock size={12} className="text-severity-medium mt-0.5 shrink-0" />
              <p className="text-label text-severity-medium">
                Shown once. They are stored hashed, so nothing can display them again.
                Each one signs you in if you lose your phone, and works only once.
              </p>
            </div>
            <div className="grid grid-cols-2 gap-x-4 gap-y-1 border border-hairline rounded-control p-3">
              {setup.data.recovery_codes.map(rc => (
                <code key={rc} className="text-label font-mono text-fg">{rc}</code>
              ))}
            </div>
            <div className="flex items-center gap-2 mt-2">
              <CopyButton value={setup.data.recovery_codes.join('\n')} label="Copy all codes" />
              <label className="flex items-center gap-1.5 text-label text-fg-secondary cursor-pointer">
                <input type="checkbox" checked={saved} onChange={e => setSaved(e.target.checked)} />
                I have saved these somewhere safe
              </label>
            </div>
          </div>

          <div>
            <p className="text-ui text-fg mb-2">3. Enter a code to confirm</p>
            <input
              className="input font-mono tracking-[0.3em] text-center"
              autoComplete="one-time-code"
              placeholder="000000"
              value={code}
              onChange={e => setCode(e.target.value)} />
            {confirm.isError && (
              <p className="text-label text-severity-critical mt-2">
                {(confirm.error as any)?.response?.data?.detail ?? 'That code was not accepted'}
              </p>
            )}
          </div>

          <div className="flex justify-end gap-2">
            <button onClick={onClose} className="btn-secondary">Cancel</button>
            <button
              onClick={() => confirm.mutate()}
              disabled={!saved || code.trim().length < 6 || confirm.isPending}
              className="btn-primary disabled:opacity-40">
              {confirm.isPending ? 'Checking…' : 'Turn on'}
            </button>
          </div>
        </div>
      ) : null}
    </Modal>
  )
}

/** Both the password and a code. A session alone must not be enough. */
function DisableDialog({ onClose }: { onClose: () => void }) {
  const [password, setPassword] = useState('')
  const [code, setCode] = useState('')

  const disable = useMutation({
    mutationFn: () => authApi.mfaDisable(password, code),
    onSuccess: onClose,
  })

  return (
    <Modal open onClose={onClose} title="Turn off two-factor authentication" size="sm">
      <div className="flex items-start gap-2 mb-4">
        <AlertTriangle size={14} className="text-severity-critical mt-0.5 shrink-0" />
        <p className="text-ui text-fg-secondary">
          Your password becomes the only thing protecting this account. Both your
          password and a current code are required — an unattended browser is exactly
          what a second factor exists to survive.
        </p>
      </div>

      <label className="label">Password</label>
      <input className="input mb-3" type="password" autoComplete="current-password"
        value={password} onChange={e => setPassword(e.target.value)} />

      <label className="label">Code</label>
      <input className="input font-mono" autoComplete="one-time-code" placeholder="000000"
        value={code} onChange={e => setCode(e.target.value)} />

      {disable.isError && (
        <p className="text-label text-severity-critical mt-2">
          {(disable.error as any)?.response?.data?.detail ?? 'Could not turn it off'}
        </p>
      )}

      <div className="flex justify-end gap-2 mt-4">
        <button onClick={onClose} className="btn-secondary">Cancel</button>
        <button onClick={() => disable.mutate()}
          disabled={!password || !code.trim() || disable.isPending}
          className="btn-danger disabled:opacity-40">
          Turn off
        </button>
      </div>
    </Modal>
  )
}

/** Guarded like disabling: anyone who can mint codes can bypass the factor. */
function ReissueDialog({ onClose }: { onClose: () => void }) {
  const [password, setPassword] = useState('')
  const [code, setCode] = useState('')
  const [codes, setCodes] = useState<string[] | null>(null)

  const reissue = useMutation({
    mutationFn: () => authApi.mfaNewRecoveryCodes(password, code),
    onSuccess: data => setCodes(data.recovery_codes),
  })

  return (
    <Modal open onClose={onClose} title="New recovery codes" size="sm">
      {codes ? (
        <>
          <div className="flex items-start gap-2 mb-3">
            <Check size={12} className="text-accent mt-0.5 shrink-0" />
            <p className="text-label text-fg-secondary">
              Your previous codes no longer work. These are shown once.
            </p>
          </div>
          <div className="grid grid-cols-2 gap-x-4 gap-y-1 border border-hairline rounded-control p-3">
            {codes.map(rc => <code key={rc} className="text-label font-mono text-fg">{rc}</code>)}
          </div>
          <div className="flex justify-between items-center mt-3">
            <CopyButton value={codes.join('\n')} label="Copy all codes" />
            <button onClick={onClose} className="btn-primary">Done</button>
          </div>
        </>
      ) : (
        <>
          <p className="text-ui text-fg-secondary mb-4">
            The current set stops working immediately.
          </p>

          <label className="label">Password</label>
          <input className="input mb-3" type="password" autoComplete="current-password"
            value={password} onChange={e => setPassword(e.target.value)} />

          <label className="label">Code</label>
          <input className="input font-mono" autoComplete="one-time-code" placeholder="000000"
            value={code} onChange={e => setCode(e.target.value)} />

          {reissue.isError && (
            <p className="text-label text-severity-critical mt-2">
              {(reissue.error as any)?.response?.data?.detail ?? 'Could not issue new codes'}
            </p>
          )}

          <div className="flex justify-end gap-2 mt-4">
            <button onClick={onClose} className="btn-secondary">Cancel</button>
            <button onClick={() => reissue.mutate()}
              disabled={!password || !code.trim() || reissue.isPending}
              className="btn-primary disabled:opacity-40">
              Issue new codes
            </button>
          </div>
        </>
      )}
    </Modal>
  )
}
