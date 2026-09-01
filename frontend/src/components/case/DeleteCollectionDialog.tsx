import { useQuery } from '@tanstack/react-query'
import { collectionImportApi, type DeletionPlan } from '../../api/collectionImport'
import Modal from '../ui/Modal'
import { Cpu, Mail, ScrollText, ShieldCheck, Table2 } from '../../ui/icons'

/**
 * Confirming a deletion that reaches further than the page it is on.
 *
 * Removing a collection removes the tables it produced in the Artifact
 * Explorer, the files it put in the Logs module, and the rest. A plain
 * "are you sure?" asked the analyst to guess at all of that, so this asks the
 * backend what deletion would take and shows it.
 *
 * The counts come from the same function that performs the deletion, so what
 * is promised here and what happens are not two implementations that can drift.
 */

interface Props {
  open: boolean
  onClose: () => void
  onConfirm: () => void
  caseId: string
  /** One id per batch: a session uploaded in parts is several collections. */
  collectionIds: string[]
  name: string
  busy?: boolean
}

function humanBytes(bytes: number): string {
  if (bytes <= 0) return '0 B'
  const units = ['B', 'KB', 'MB', 'GB', 'TB']
  const i = Math.min(units.length - 1, Math.floor(Math.log(bytes) / Math.log(1024)))
  return `${(bytes / 1024 ** i).toFixed(i === 0 ? 0 : 1)} ${units[i]}`
}

const EMPTY: DeletionPlan = {
  tables: 0, event_logs: 0, emails: 0, memory_dumps: 0,
  files: 0, preserved: 0, bytes_on_disk: 0, preserved_names: [],
}

function sum(plans: DeletionPlan[]): DeletionPlan {
  return plans.reduce((total, p) => ({
    tables:        total.tables + p.tables,
    event_logs:    total.event_logs + p.event_logs,
    emails:        total.emails + p.emails,
    memory_dumps:  total.memory_dumps + p.memory_dumps,
    files:         total.files + p.files,
    preserved:     total.preserved + p.preserved,
    bytes_on_disk: total.bytes_on_disk + p.bytes_on_disk,
    preserved_names: [...total.preserved_names, ...p.preserved_names],
  }), EMPTY)
}

export default function DeleteCollectionDialog({
  open, onClose, onConfirm, caseId, collectionIds, name, busy = false,
}: Props) {
  const { data, isLoading, isError } = useQuery({
    queryKey: ['collection-deletion-plan', caseId, collectionIds],
    queryFn: async () => sum(await Promise.all(
      collectionIds.map(id => collectionImportApi.deletionPlan(caseId, id)),
    )),
    enabled: open,
    staleTime: 0,
  })

  const rows: { icon: typeof Table2; label: string; count: number }[] = data ? [
    { icon: Table2,     label: 'tables in the Artifact Explorer', count: data.tables },
    { icon: ScrollText, label: 'event logs, with their events',   count: data.event_logs },
    { icon: Mail,       label: 'messages in Email Analysis',      count: data.emails },
    { icon: Cpu,        label: 'memory images',                   count: data.memory_dumps },
  ].filter(r => r.count > 0) : []

  return (
    <Modal open={open} onClose={onClose} title="Delete collection" size="md">
      <p className="text-ui text-fg-secondary mb-4">
        <span className="text-fg font-medium break-all">{name}</span> and everything
        it produced will be removed. This cannot be undone.
      </p>

      {isLoading && (
        <p className="text-ui text-fg-muted mb-6">Working out what this would remove…</p>
      )}

      {isError && (
        <p className="text-ui text-severity-medium mb-6">
          What this would remove could not be read. Deleting still works, but you
          are doing it without the list.
        </p>
      )}

      {data && (
        <div className="mb-6 space-y-4">
          <div>
            <p className="text-label uppercase tracking-wide text-fg-muted mb-2">Removed</p>
            <ul className="space-y-1.5">
              <li className="flex items-center gap-2 text-ui text-fg-secondary">
                <span className="font-mono text-fg tabular-nums w-10 text-right">{data.files}</span>
                <span>ingested file{data.files === 1 ? '' : 's'}, and {humanBytes(data.bytes_on_disk)} on disk</span>
              </li>
              {rows.map(({ icon: Icon, label, count }) => (
                <li key={label} className="flex items-center gap-2 text-ui text-fg-secondary">
                  <span className="font-mono text-fg tabular-nums w-10 text-right">{count}</span>
                  <Icon size={13} className="text-fg-muted shrink-0" />
                  <span>{label}</span>
                </li>
              ))}
              {rows.length === 0 && (
                <li className="text-ui text-fg-muted pl-12">
                  Nothing was routed to another page from this import.
                </li>
              )}
            </ul>
          </div>

          {data.preserved > 0 && (
            <div className="border border-accent/25 bg-accent/[0.06] px-3 py-2.5">
              <p className="flex items-center gap-2 text-ui text-accent mb-1">
                <ShieldCheck size={13} className="shrink-0" />
                {data.preserved} item{data.preserved === 1 ? '' : 's'} kept
              </p>
              <p className="text-label text-fg-secondary">
                Preserved in the chain of custody, so they stay queryable after
                the collection is gone.
              </p>
              {data.preserved_names.length > 0 && (
                <p className="text-label text-fg-muted mt-1.5 font-mono break-all">
                  {data.preserved_names.slice(0, 6).join(', ')}
                  {data.preserved_names.length > 6
                    ? ` and ${data.preserved_names.length - 6} more`
                    : ''}
                </p>
              )}
            </div>
          )}
        </div>
      )}

      <div className="flex justify-end gap-3">
        <button onClick={onClose} className="btn-secondary" disabled={busy}>Cancel</button>
        <button onClick={onConfirm} className="btn-danger" disabled={busy}>
          {busy ? 'Deleting…' : 'Delete'}
        </button>
      </div>
    </Modal>
  )
}
