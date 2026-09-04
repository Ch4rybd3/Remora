/**
 * What the ingestion pipeline has seen for this case.
 *
 * Every file, whichever door it came through, with what the pipeline decided
 * and why. The states that need an analyst - `unidentified` and `failed` -
 * carry their action inline, because a queue that shows a problem without
 * offering the fix is just a longer way of saying nothing happened.
 */
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useMemo, useState } from 'react'

import { ingestApi, type IngestedFile, type IngestState } from '../../api/ingest'
import {
  AlertTriangle, Check, HardDrive, RefreshCw, Upload,
} from '../../ui/icons'
import { CopyableName, CustodyActions } from '../custody/CustodyActions'

/** Colour per state. Only the ones that mean something to an analyst stand out. */
const STATE_STYLE: Record<IngestState, string> = {
  indexed:      'text-accent',
  // Not a warning. The file reached a page where it is useful, which is what
  // routing it was for - a hive is browsable rather than tabular, and colouring
  // that like `unsupported` said the pipeline had failed at something it had
  // deliberately not attempted.
  browsable:    'text-accent',
  routed:       'text-accent/70',
  parsed:       'text-accent/70',
  identified:   'text-fg-secondary',
  hashed:       'text-fg-secondary',
  discovered:   'text-fg-secondary',
  duplicate:    'text-fg-muted',
  unsupported:  'text-severity-medium',
  unidentified: 'text-severity-medium',
  failed:       'text-severity-critical',
}

/** How the file arrived. Shown because provenance is the point of the table. */
const ORIGIN_LABEL: Record<string, string> = {
  dropzone:  'drop folder',
  upload:    'uploaded',
  archive:   'from archive',
  connector: 'connector',
  legacy:    'before the pipeline',
}

function fmtSize(bytes: number): string {
  if (!bytes) return '—'
  const units = ['B', 'KB', 'MB', 'GB', 'TB']
  let value = bytes, unit = 0
  while (value >= 1024 && unit < units.length - 1) { value /= 1024; unit++ }
  return `${value.toFixed(unit === 0 ? 0 : 1)} ${units[unit]}`
}

export default function IngestQueuePanel({ caseId }: { caseId: string }) {
  const qc = useQueryClient()
  const [filter, setFilter] = useState<IngestState | null>(null)

  const { data, isLoading } = useQuery({
    queryKey: ['ingest', caseId, filter],
    queryFn:  () => ingestApi.list(caseId, filter ?? undefined),
    refetchInterval: 15_000,
  })

  const { data: kindData } = useQuery({
    queryKey: ['ingest-kinds'],
    queryFn:  () => ingestApi.kinds(),
    staleTime: Infinity,
  })

  const files   = data?.files ?? []
  const summary = data?.summary ?? {}

  const refresh = () => {
    qc.invalidateQueries({ queryKey: ['ingest', caseId] })
    qc.invalidateQueries({ queryKey: ['custody', caseId] })
  }

  // Chips only for states this case actually has: a row of ten zeroes tells
  // the analyst nothing and makes the two that matter harder to find.
  const chips = useMemo(
    () => Object.entries(summary).filter(([, n]) => n > 0).sort((a, b) => b[1] - a[1]),
    [summary],
  )

  return (
    <div className="border border-hairline">
      <div className="flex items-center gap-2 px-3 py-2 border-b border-hairline bg-white/[0.02]">
        <HardDrive size={12} className="text-accent shrink-0" />
        <span className="text-label font-semibold uppercase tracking-widest text-fg-secondary">
          Ingest queue
        </span>

        <div className="flex items-center gap-1 ml-2 flex-wrap">
          {chips.map(([state, count]) => (
            <button key={state}
              onClick={() => setFilter(filter === state ? null : state as IngestState)}
              className={`text-label px-1.5 py-0.5 rounded-control border transition-colors ${
                filter === state
                  ? 'border-accent/40 bg-accent/10 text-accent'
                  : 'border-hairline text-fg-secondary hover:text-fg'}`}>
              {state} {count}
            </button>
          ))}
        </div>

        <button onClick={refresh}
          className="ml-auto p-1 text-fg-secondary/40 hover:text-fg transition-colors"
          title="Refresh">
          <RefreshCw size={11} />
        </button>
      </div>

      {isLoading ? (
        <p className="px-3 py-4 text-label text-fg-muted">Loading…</p>
      ) : files.length === 0 ? (
        <p className="px-3 py-4 text-label text-fg-muted">
          {filter
            ? `Nothing in state "${filter}".`
            : 'Nothing ingested yet. Drop files above, or copy them into the case folder.'}
        </p>
      ) : (
        <ul className="max-h-80 overflow-y-auto">
          {files.map(file => (
            <IngestRow key={file.id} file={file} caseId={caseId}
              kinds={kindData?.kinds ?? []} onChange={refresh} />
          ))}
        </ul>
      )}
    </div>
  )
}

function IngestRow({ file, caseId, kinds, onChange }: {
  file: IngestedFile
  caseId: string
  kinds: { kind: string; available: boolean }[]
  onChange: () => void
}) {
  const [forcing, setForcing] = useState(false)

  const force = useMutation({
    mutationFn: (kind: string) => ingestApi.forceKind(caseId, file.id, kind),
    onSuccess: () => { setForcing(false); onChange() },
  })

  const retry = useMutation({
    mutationFn: () => ingestApi.retry(caseId, file.id),
    onSuccess: onChange,
  })

  // Only a raw dump needs this. A Windows crash dump and a LiME image say which
  // OS they are in their header, and offering to set one would invite an
  // analyst to contradict the file.
  const setOs = useMutation({
    mutationFn: (os: 'windows' | 'linux') => ingestApi.setMemoryOs(caseId, file.id, os),
    onSuccess: onChange,
  })
  const needsOs = file.detected_kind === 'memory_dump' && file.state === 'unsupported'

  return (
    <li className="px-3 py-1.5 border-b border-strong/[0.04] last:border-b-0">
      <div className="flex items-center gap-2">
        {file.origin === 'upload'
          ? <Upload size={10} className="text-fg-secondary/40 shrink-0" />
          : <HardDrive size={10} className="text-fg-secondary/40 shrink-0" />}

        <CopyableName value={file.original_name}
          className="font-mono text-label text-fg-secondary flex-1 min-w-0" />

        <span className={`text-label shrink-0 ${STATE_STYLE[file.state] ?? 'text-fg-muted'}`}>
          {file.state}
        </span>

        <span className="text-label text-fg-muted shrink-0 hidden md:inline">
          {file.magic_type ?? '—'}
        </span>

        {/* A type derived from the name is a guess; one derived from bytes is
            not. Saying which lets the analyst know when to override. */}
        {file.detection_source && file.detection_source !== 'magic' && (
          <span className="text-label text-severity-medium/70 shrink-0 hidden lg:inline"
            title="Not identified from a byte signature">
            by {file.detection_source}
          </span>
        )}

        <span className="text-label font-mono text-fg-muted shrink-0 hidden lg:inline">
          {fmtSize(file.size_bytes)}
        </span>

        <span className="text-label text-fg-muted/50 shrink-0 hidden xl:inline">
          {ORIGIN_LABEL[file.origin] ?? file.origin}
        </span>

        {file.state === 'failed' && (
          <button onClick={() => retry.mutate()} disabled={retry.isPending}
            className="p-1 text-fg-secondary/40 hover:text-accent transition-colors disabled:opacity-40"
            title="Send back through the pipeline">
            <RefreshCw size={11} />
          </button>
        )}

        {needsOs && (
          <span className="flex items-center gap-1 shrink-0">
            <span className="text-label text-severity-medium">OS:</span>
            {(['windows', 'linux'] as const).map(os => (
              <button key={os}
                onClick={() => setOs.mutate(os)}
                disabled={setOs.isPending}
                className="text-label px-1.5 py-0.5 rounded-control border border-severity-medium/30 text-severity-medium hover:bg-severity-medium/10 transition-colors disabled:opacity-40">
                {os}
              </button>
            ))}
          </span>
        )}

        {file.state === 'unidentified' && !forcing && (
          <button onClick={() => setForcing(true)}
            className="text-label px-1.5 py-0.5 rounded-control border border-severity-medium/30 text-severity-medium hover:bg-severity-medium/10 transition-colors shrink-0">
            Set type
          </button>
        )}

        <CustodyActions
          caseId={caseId} kind="ingested_file" sourceId={file.id}
          name={file.original_name} evidenceId={file.evidence_id}
          showCopy={false} onChange={onChange} />
      </div>

      {forcing && (
        <div className="flex items-center gap-2 mt-1.5 pl-6">
          <select
            autoFocus
            defaultValue=""
            onChange={e => e.target.value && force.mutate(e.target.value)}
            className="bg-panel border border-hairline rounded-control px-2 py-1 text-label outline-none focus:border-accent/40">
            <option value="" disabled>Choose a type…</option>
            {kinds.map(k => (
              <option key={k.kind} value={k.kind}>
                {k.kind}{k.available ? '' : ' (no parser yet)'}
              </option>
            ))}
          </select>
          <button onClick={() => setForcing(false)}
            className="text-label text-fg-secondary/50 hover:text-fg transition-colors">
            Cancel
          </button>
          {force.isError && (
            <span className="text-label text-severity-critical">
              {force.error instanceof Error ? force.error.message : 'Failed'}
            </span>
          )}
        </div>
      )}

      {file.error && (
        <p className="flex items-start gap-1 mt-1 pl-6 text-label text-severity-critical/80">
          <AlertTriangle size={9} className="mt-0.5 shrink-0" />
          {file.error}
        </p>
      )}

      {file.preserved && (
        <p className="flex items-center gap-1 mt-1 pl-6 text-label text-accent/70">
          <Check size={9} />
          Preserved in the chain of custody — this file does not expire
        </p>
      )}
    </li>
  )
}
