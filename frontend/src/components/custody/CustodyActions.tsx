/**
 * The per-artifact action set: copy the name, preserve it, withdraw it.
 *
 * Every page that lists artifacts renders this and nothing else. That is the
 * point - the Collection tab, the Artifact Explorer and whatever page comes
 * next all get the same behaviour, the same confirmation, the same audit
 * trail, without any of them reimplementing it.
 *
 * A new page needs two things: a `kind` registered in
 * `backend/app/services/custody.py`, and this component in its row.
 */
import { useState } from 'react'

import { custodyApi, type CustodySourceKind } from '../../api/custody'
import { AlertTriangle, Check, Copy, Lock, ShieldCheck, ShieldX } from '../../ui/icons'
import { copyText } from '../../utils/clipboard'
import Modal from '../ui/Modal'

interface Props {
  caseId:      string
  kind:        CustodySourceKind
  sourceId:    string
  /** Shown in dialogs and copied by the copy button. */
  name:        string
  /** Set when the artifact is already preserved; enables withdrawal instead. */
  evidenceId?: string | null
  /** Refetch the list once custody changed. */
  onChange?:   () => void
  /** Hide the copy button where the row already offers one. */
  showCopy?:   boolean
}

export function CustodyActions({
  caseId, kind, sourceId, name, evidenceId, onChange, showCopy = true,
}: Props) {
  const [busy,     setBusy]     = useState(false)
  const [error,    setError]    = useState<string | null>(null)
  const [askKeep,  setAskKeep]  = useState(false)
  const [askDrop,  setAskDrop]  = useState(false)

  const preserved = !!evidenceId

  async function preserve(asIoc: boolean) {
    setBusy(true); setError(null)
    try {
      await custodyApi.promote(caseId, kind, sourceId, { asIoc })
      setAskKeep(false)
      onChange?.()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not preserve this artifact')
    } finally {
      setBusy(false)
    }
  }

  async function drop(reason: string) {
    if (!evidenceId) return
    setBusy(true); setError(null)
    try {
      await custodyApi.withdraw(caseId, evidenceId, reason)
      setAskDrop(false)
      onChange?.()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not withdraw this item')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="flex items-center gap-0.5">
      {showCopy && <CopyButton value={name} />}

      {preserved ? (
        <button
          onClick={e => { e.stopPropagation(); setAskDrop(true) }}
          disabled={busy}
          className="p-1 text-accent hover:text-severity-critical transition-colors disabled:opacity-40"
          title="In the chain of custody - click to withdraw">
          <ShieldCheck size={12} />
        </button>
      ) : (
        <button
          onClick={e => { e.stopPropagation(); setAskKeep(true) }}
          disabled={busy}
          className="p-1 text-fg-secondary/40 hover:text-accent transition-colors disabled:opacity-40"
          title="Preserve in the chain of custody">
          <ShieldCheck size={12} />
        </button>
      )}

      {error && (
        <span className="text-label text-severity-critical ml-1" title={error}>
          <AlertTriangle size={10} />
        </span>
      )}

      <PreserveDialog
        open={askKeep} name={name} busy={busy}
        onClose={() => { setAskKeep(false); setError(null) }}
        onConfirm={preserve} error={error} />

      <WithdrawDialog
        open={askDrop} name={name} busy={busy}
        onClose={() => { setAskDrop(false); setError(null) }}
        onConfirm={drop} error={error} />
    </div>
  )
}

// ─── Copy ─────────────────────────────────────────────────────────────────────

/** A copy button that says whether it worked, because on plain HTTP it can fail. */
export function CopyButton({ value, label }: { value: string; label?: string }) {
  const [state, setState] = useState<'idle' | 'ok' | 'fail'>('idle')

  async function run(e: React.MouseEvent) {
    e.stopPropagation()
    const ok = await copyText(value)
    setState(ok ? 'ok' : 'fail')
    window.setTimeout(() => setState('idle'), 1400)
  }

  return (
    <button
      onClick={run}
      className={`p-1 transition-colors ${
        state === 'ok'   ? 'text-accent'
        : state === 'fail' ? 'text-severity-critical'
        : 'text-fg-secondary/40 hover:text-fg'}`}
      title={state === 'fail' ? 'The browser refused clipboard access' : (label ?? 'Copy name')}>
      {state === 'ok' ? <Check size={12} /> : <Copy size={12} />}
    </button>
  )
}

/**
 * A filename that copies itself when clicked.
 *
 * The name is the thing an analyst pastes into a command line most often, so
 * it is the affordance rather than a button next to one.
 */
export function CopyableName({ value, className = '' }: { value: string; className?: string }) {
  const [copied, setCopied] = useState(false)

  return (
    <button
      onClick={async e => {
        e.stopPropagation()
        if (await copyText(value)) {
          setCopied(true)
          window.setTimeout(() => setCopied(false), 1400)
        }
      }}
      title="Click to copy"
      className={`text-left truncate transition-colors ${
        copied ? 'text-accent' : 'hover:text-accent'} ${className}`}>
      {value}
    </button>
  )
}

// ─── Dialogs ──────────────────────────────────────────────────────────────────

function PreserveDialog({ open, name, busy, error, onClose, onConfirm }: {
  open: boolean; name: string; busy: boolean; error: string | null
  onClose: () => void; onConfirm: (asIoc: boolean) => void
}) {
  return (
    <Modal open={open} onClose={onClose} title="Preserve in the chain of custody" size="sm">
      <p className="text-ui text-fg-secondary mb-4">
        A copy of <span className="font-mono text-fg">{name}</span> is written to the
        evidence store and hashed. The collection it came from expires after 90 days;
        the preserved copy does not.
      </p>

      <div className="border border-hairline rounded-control p-3 mb-4">
        <div className="flex items-start gap-2">
          <Lock size={12} className="text-severity-medium mt-0.5 shrink-0" />
          <div>
            <p className="text-ui text-fg">Contains an IOC</p>
            <p className="text-label text-fg-secondary mt-1">
              Wraps the copy in a password-protected archive. Use it for anything that
              could execute: it stops an accidental double-click after a download, and
              stops endpoint protection quarantining the sample out of the evidence
              store. The password is shown next to the download - this is containment,
              not confidentiality.
            </p>
          </div>
        </div>
      </div>

      {error && (
        <p className="text-label text-severity-critical mb-3">{error}</p>
      )}

      <div className="flex justify-end gap-2">
        <button onClick={onClose} className="btn-secondary" disabled={busy}>Cancel</button>
        <button onClick={() => onConfirm(true)} className="btn-secondary" disabled={busy}>
          Preserve as IOC
        </button>
        <button onClick={() => onConfirm(false)} className="btn-primary" disabled={busy}>
          Preserve
        </button>
      </div>
    </Modal>
  )
}

function WithdrawDialog({ open, name, busy, error, onClose, onConfirm }: {
  open: boolean; name: string; busy: boolean; error: string | null
  onClose: () => void; onConfirm: (reason: string) => void
}) {
  const [reason, setReason] = useState('')

  return (
    <Modal open={open} onClose={onClose} title="Withdraw from the chain of custody" size="sm">
      <div className="flex items-start gap-2 mb-4">
        <ShieldX size={14} className="text-severity-critical mt-0.5 shrink-0" />
        <p className="text-ui text-fg-secondary">
          The preserved copy of <span className="font-mono text-fg">{name}</span> is
          deleted. Leaving the bytes behind after the record says they were withdrawn
          would make the store disagree with the chain of custody, and the chain is the
          part that has to be trustworthy.
        </p>
      </div>

      <label className="block text-label uppercase tracking-widest text-fg-secondary mb-1">
        Reason (recorded in the audit trail)
      </label>
      <textarea
        value={reason}
        onChange={e => setReason(e.target.value)}
        rows={3}
        autoFocus
        placeholder="Added to the wrong case, duplicate of another item, ..."
        className="w-full bg-transparent border border-hairline rounded-control px-2.5 py-1.5 text-ui outline-none focus:border-accent/40 transition-colors" />

      {error && <p className="text-label text-severity-critical mt-2">{error}</p>}

      <div className="flex justify-end gap-2 mt-4">
        <button onClick={onClose} className="btn-secondary" disabled={busy}>Cancel</button>
        <button
          onClick={() => onConfirm(reason)}
          disabled={busy || !reason.trim()}
          className="btn-danger disabled:opacity-40">
          Withdraw
        </button>
      </div>
    </Modal>
  )
}
