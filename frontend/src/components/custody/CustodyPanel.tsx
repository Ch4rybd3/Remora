/**
 * What this case has preserved.
 *
 * Sits in the Collection tab because that is where an analyst decides what
 * survives: everything else there carries a 90-day expiry, and this list is
 * what does not. Withdrawal lives here too - it is the only screen where the
 * consequence of removing something is visible next to the item.
 */
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useState } from 'react'

import { custodyApi, type CustodyItem } from '../../api/custody'
import { AlertTriangle, Lock, ShieldCheck, ShieldX } from '../../ui/icons'
import Modal from '../ui/Modal'
import { CopyButton } from './CustodyActions'

function fmtSize(bytes: number): string {
  if (!bytes) return '—'
  const units = ['B', 'KB', 'MB', 'GB', 'TB']
  let value = bytes
  let unit = 0
  while (value >= 1024 && unit < units.length - 1) { value /= 1024; unit++ }
  return `${value.toFixed(unit === 0 ? 0 : 1)} ${units[unit]}`
}

export default function CustodyPanel({ caseId }: { caseId: string }) {
  const qc = useQueryClient()
  const [withdrawing, setWithdrawing] = useState<CustodyItem | null>(null)

  const { data, isLoading } = useQuery({
    queryKey: ['custody', caseId],
    queryFn:  () => custodyApi.list(caseId),
  })

  const items = data?.items ?? []
  const summary = data?.summary

  return (
    <div className="border border-hairline">
      <div className="flex items-center gap-2 px-3 py-2 border-b border-hairline bg-white/[0.02]">
        <ShieldCheck size={12} className="text-accent shrink-0" />
        <span className="text-label font-semibold uppercase tracking-widest text-fg-secondary">
          Chain of custody
        </span>
        {summary && summary.preserved > 0 && (
          <span className="text-label text-fg-muted ml-1">
            {summary.preserved} preserved
            {summary.contained > 0 && ` · ${summary.contained} contained`}
          </span>
        )}
        <span className="ml-auto text-label text-fg-muted">
          Preserved items do not expire
        </span>
      </div>

      {isLoading ? (
        <p className="px-3 py-4 text-label text-fg-muted">Loading…</p>
      ) : items.length === 0 ? (
        <p className="px-3 py-4 text-label text-fg-muted">
          Nothing preserved yet. Use the shield on any file above to keep a copy that
          survives the 90-day expiry.
        </p>
      ) : (
        <ul>
          {items.map(item => (
            <li key={item.id}
              className="flex items-center gap-2 px-3 py-1.5 border-b border-strong/[0.04] last:border-b-0">
              {item.contained
                ? <span className="shrink-0 flex" title="Contained in a password-protected archive">
                    <Lock size={11} className="text-severity-medium" />
                  </span>
                : <ShieldCheck size={11} className="text-accent shrink-0" />}

              <span className="font-mono text-label text-fg-secondary truncate flex-1"
                title={item.original_filename}>
                {item.name}
              </span>

              {item.contained && item.archive_password && (
                <span className="text-label text-severity-medium shrink-0">
                  password: <span className="font-mono">{item.archive_password}</span>
                </span>
              )}

              <span className="text-label font-mono text-fg-muted shrink-0 hidden md:inline">
                {fmtSize(item.file_size)}
              </span>

              <span className="text-label font-mono text-fg-muted/60 shrink-0 hidden lg:inline"
                title={`SHA-256 ${item.sha256_hash}`}>
                {item.sha256_hash.slice(0, 12)}…
              </span>

              <CopyButton value={item.sha256_hash} label="Copy SHA-256" />

              <button
                onClick={() => setWithdrawing(item)}
                className="p-1 text-fg-secondary/30 hover:text-severity-critical transition-colors"
                title="Withdraw from the chain of custody">
                <ShieldX size={12} />
              </button>
            </li>
          ))}
        </ul>
      )}

      <WithdrawModal
        caseId={caseId}
        item={withdrawing}
        onClose={() => setWithdrawing(null)}
        onDone={() => {
          qc.invalidateQueries({ queryKey: ['custody', caseId] })
          qc.invalidateQueries({ queryKey: ['collection-imports', caseId] })
        }} />
    </div>
  )
}

function WithdrawModal({ caseId, item, onClose, onDone }: {
  caseId: string
  item: CustodyItem | null
  onClose: () => void
  onDone: () => void
}) {
  const [reason, setReason] = useState('')

  const withdraw = useMutation({
    mutationFn: () => custodyApi.withdraw(caseId, item!.id, reason),
    onSuccess: () => { setReason(''); onDone(); onClose() },
  })

  return (
    <Modal open={!!item} onClose={onClose} title="Withdraw from the chain of custody" size="sm">
      {item && (
        <>
          <div className="flex items-start gap-2 mb-4">
            <AlertTriangle size={14} className="text-severity-critical mt-0.5 shrink-0" />
            <p className="text-ui text-fg-secondary">
              The preserved copy of <span className="font-mono text-fg">{item.name}</span> is
              deleted, and its 90-day expiry starts again. This is not a routine action:
              the chain of custody is the part that has to be trustworthy, so the store
              must not keep bytes the record says were withdrawn.
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

          {withdraw.isError && (
            <p className="text-label text-severity-critical mt-2">
              {withdraw.error instanceof Error ? withdraw.error.message : 'Withdrawal failed'}
            </p>
          )}

          <div className="flex justify-end gap-2 mt-4">
            <button onClick={onClose} className="btn-secondary">Cancel</button>
            <button
              onClick={() => withdraw.mutate()}
              disabled={!reason.trim() || withdraw.isPending}
              className="btn-danger disabled:opacity-40">
              Withdraw
            </button>
          </div>
        </>
      )}
    </Modal>
  )
}
