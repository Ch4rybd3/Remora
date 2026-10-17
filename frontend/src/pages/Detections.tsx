/**
 * Detections — Sigma rules run against the case's event logs.
 *
 * This page used to be *Logs*, and it read event logs: it parsed every EVTX a
 * second time and offered its own browser over the records, while the Artifact
 * Explorer already held the same events, parsed once at ingestion. Two parses
 * of one file, two tables that could disagree, and two places to read the
 * same record.
 *
 * What was only ever here is what is left. Chainsaw runs Sigma against the
 * EVTX itself, which no other page does, and it needs the file rather than a
 * database of it. Reading an event is the Explorer's job; lineage is the
 * process tree's, asked from a row there.
 */
import { useMemo, useRef, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'

import { PageShell } from '../ui/PageShell'
import { ArtifactFileList } from '../ui/ArtifactFileList'
import {
  AlertTriangle, BookmarkPlus, CheckCircle2, Info, Loader2, ShieldAlert,
  ShieldCheck, Trash2, Upload,
} from '../ui/icons'
import { evtxApi, type EvtxFile } from '../api/evtx'
import { useCurrentCase } from '../context/CurrentCaseContext'
import { fmtRelative } from '../utils/dateUtils'
import ChainsawTab from '../components/evtx/ChainsawTab'

function fileBadges(file: EvtxFile) {
  if (file.status === 'error') {
    return (
      <span title={file.error_msg ?? 'The file could not be read'}
        className="flex items-center gap-0.5 text-label text-severity-critical">
        <AlertTriangle size={9} /> error
      </span>
    )
  }
  return (
    <>
      <span className="text-label text-fg-secondary/40">scannable</span>
      {file.added_to_evidence && (
        <span title="Preserved in the chain of custody"
          className="flex items-center gap-0.5 text-label text-accent">
          <ShieldCheck size={9} /> preserved
        </span>
      )}
    </>
  )
}

export default function Detections() {
  const { currentCase } = useCurrentCase()
  const caseId = currentCase?.id
  const qc = useQueryClient()

  const fileRef = useRef<HTMLInputElement>(null)
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [uploadError, setUploadError] = useState<string | null>(null)

  const { data: files = [], isLoading } = useQuery({
    queryKey: ['evtx-files', caseId],
    queryFn:  () => evtxApi.listFiles(caseId!),
    enabled:  !!caseId,
  })

  const upload = useMutation({
    mutationFn: (file: File) => evtxApi.upload(caseId!, file),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['evtx-files', caseId] })
      setUploadError(null)
    },
    onError: (e: unknown) => setUploadError(
      (e as { response?: { data?: { detail?: string } } })?.response?.data?.detail
      ?? 'The upload failed.'),
  })

  const remove = useMutation({
    mutationFn: (fileId: string) => evtxApi.deleteFile(caseId!, fileId),
    onSuccess: (_r, fileId) => {
      qc.invalidateQueries({ queryKey: ['evtx-files', caseId] })
      if (selectedId === fileId) setSelectedId(null)
    },
  })

  const preserve = useMutation({
    mutationFn: (fileId: string) => evtxApi.addEvidence(caseId!, fileId),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['evtx-files', caseId] }),
  })

  const items = useMemo(() => files.map(file => ({
    id:          file.id,
    name:        file.filename,
    unavailable: file.status === 'error',
    badges:      fileBadges(file),
    footnote:    fmtRelative(file.uploaded_at),
    actions: (
      <div className="flex items-center gap-1">
        <button
          onClick={() => preserve.mutate(file.id)}
          disabled={file.added_to_evidence || preserve.isPending}
          title={file.added_to_evidence ? 'Already in evidence' : 'Preserve as evidence'}
          className={`transition-all ${ file.added_to_evidence
              ? 'text-accent/60'
              : 'opacity-0 group-hover:opacity-100 text-fg-secondary/40 hover:text-accent'
          } disabled:cursor-default`}
        >
          <BookmarkPlus size={11} />
        </button>
        <button
          onClick={() => remove.mutate(file.id)}
          title="Remove this log from the case"
          className="opacity-0 group-hover:opacity-100 text-fg-secondary/40 hover:text-severity-critical transition-all"
        >
          <Trash2 size={11} />
        </button>
      </div>
    ),
  })), [files, preserve, remove])

  return (
    <PageShell
      route="/artifacts/detections"
      title="Detections"
      subtitle={currentCase?.title}
      meta={files.length ? `${files.length} log${files.length > 1 ? 's' : ''}` : undefined}
      fullHeight
      actions={
        currentCase ? (
          <span className="flex items-center gap-1.5 text-label text-accent">
            <CheckCircle2 size={11} /> current case
          </span>
        ) : (
          <span className="flex items-center gap-1.5 text-label text-fg-muted">
            <Info size={11} /> set a case from the top bar
          </span>
        )
      }
      asideLeft={caseId ? (
        <aside className="w-64 shrink-0 border-r border-hairline bg-panel flex flex-col min-h-0 overflow-hidden">
          <div className="px-3 py-2 border-b border-hairline shrink-0">
            <input ref={fileRef} type="file" accept=".evtx" className="sr-only"
              onChange={e => {
                const chosen = e.target.files?.[0]
                if (chosen) upload.mutate(chosen)
                e.target.value = ''
              }} />
            <button onClick={() => fileRef.current?.click()} disabled={upload.isPending}
              className="w-full flex items-center justify-center gap-1.5 text-label py-1.5 rounded-control border border-dashed border-hairline text-fg-secondary hover:text-accent hover:border-accent/30 transition-colors disabled:opacity-40">
              {upload.isPending ? <Loader2 size={11} className="animate-spin" /> : <Upload size={11} />}
              {upload.isPending ? 'Uploading…' : 'Upload .evtx'}
            </button>
            {uploadError && (
              <p className="text-label text-severity-critical mt-1">{uploadError}</p>
            )}
          </div>

          <div className="flex-1 min-h-0">
            <ArtifactFileList
              items={items}
              selectedId={selectedId}
              onSelect={setSelectedId}
              title="Event logs"
              icon={ShieldAlert}
              loading={isLoading}
              emptyMessage="No event log in this case. Upload a .evtx, or drop one into the case folder and scan it from the Collection tab."
            />
          </div>
        </aside>
      ) : undefined}
    >
      {!currentCase ? (
        <div className="h-full flex items-center justify-center flex-col gap-3 text-center px-8">
          <ShieldAlert size={32} className="text-fg-secondary/15" />
          <p className="text-ui text-fg-secondary/50">No current case selected</p>
          <p className="text-label text-fg-secondary/30 max-w-md leading-relaxed">
            Set a current case from the top bar to run Sigma rules against its event logs.
          </p>
        </div>
      ) : (
        <div className="h-full min-w-0 overflow-hidden">
          <ChainsawTab caseId={currentCase.id} />
        </div>
      )}
    </PageShell>
  )
}
