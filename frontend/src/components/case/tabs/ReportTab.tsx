import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { FileDown, RefreshCw, Save, History, RotateCcw, User, Clock, Hash, PanelRight } from 'lucide-react'
import { casesApi } from '../../../api/cases'
import { reportVersionsApi, type ReportVersionMeta } from '../../../api/reportVersions'
import MarkdownEditor from '../../ui/MarkdownEditor'
import type { Case } from '../../../types'
import { formatDistanceToNow, format } from 'date-fns'

interface Props { case_: Case }

// ── Version card ──────────────────────────────────────────────────────────────

function VersionCard({
  v, caseId, onRestore,
}: {
  v: ReportVersionMeta
  caseId: string
  onRestore: (content: string) => void
}) {
  const [loading, setLoading] = useState(false)

  const handleRestore = async () => {
    if (!confirm(`Restore version ${v.version}? This will replace the current content (unsaved changes will be lost).`)) return
    setLoading(true)
    try {
      const full = await reportVersionsApi.get(caseId, v.id)
      onRestore(full.content)
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="rounded-lg border border-white/8 bg-white/[0.02] px-3 py-2.5 space-y-2 group hover:border-white/15 transition-colors">
      {/* Version badge + date */}
      <div className="flex items-center gap-2">
        <span className="text-[9px] font-mono font-bold px-1.5 py-0.5 rounded bg-accent-green/10 text-accent-green border border-accent-green/20">
          v{v.version}
        </span>
        <span className="text-[10px] text-white/70 font-medium flex-1" title={format(new Date(v.created_at), 'dd MMM yyyy HH:mm:ss')}>
          {formatDistanceToNow(new Date(v.created_at), { addSuffix: true })}
        </span>
        <button
          onClick={handleRestore}
          disabled={loading}
          className="opacity-0 group-hover:opacity-100 flex items-center gap-1 text-[9px] px-1.5 py-0.5 rounded border border-accent-green/20 text-accent-green/70 hover:bg-accent-green/10 transition-all disabled:opacity-40"
          title="Restore this version"
        >
          <RotateCcw size={9} className={loading ? 'animate-spin' : ''} />
          Restore
        </button>
      </div>

      {/* Meta */}
      <div className="flex flex-wrap gap-x-3 gap-y-1">
        {v.created_by && (
          <span className="flex items-center gap-1 text-[9px] text-accent-muted/50">
            <User size={8} /> {v.created_by}
          </span>
        )}
        <span className="flex items-center gap-1 text-[9px] text-accent-muted/50">
          <Hash size={8} /> {v.line_count} line{v.line_count !== 1 ? 's' : ''}
        </span>
        <span className="flex items-center gap-1 text-[9px] text-accent-muted/35">
          <Clock size={8} /> {format(new Date(v.created_at), 'HH:mm:ss')}
        </span>
      </div>
    </div>
  )
}

// ── Main ──────────────────────────────────────────────────────────────────────

export default function ReportTab({ case_ }: Props) {
  const qc = useQueryClient()
  const [value, setValue] = useState(case_.report ?? '')
  const [dirty, setDirty] = useState(false)
  const [editorMode, setEditorMode] = useState<'edit' | 'split' | 'preview'>('edit')
  const [versionsOpen, setVersionsOpen] = useState(false)

  // ── Version history ───────────────────────────────────────────────────────
  const { data: versions = [] } = useQuery({
    queryKey: ['report-versions', case_.id],
    queryFn:  () => reportVersionsApi.list(case_.id),
  })

  // ── Save (updates case + creates version) ─────────────────────────────────
  const save = useMutation({
    mutationFn: () => reportVersionsApi.save(case_.id, value),
    onSuccess: () => {
      // Refresh the case so case_.report is up to date, and refresh versions list
      qc.invalidateQueries({ queryKey: ['case', case_.id] })
      qc.invalidateQueries({ queryKey: ['report-versions', case_.id] })
      setDirty(false)
    },
  })

  // ── Auto-generate ─────────────────────────────────────────────────────────
  const generate = useMutation({
    mutationFn: () => casesApi.generateReport(case_.id),
    onSuccess: (md) => { setValue(md); setDirty(true) },
  })

  // ── Export ────────────────────────────────────────────────────────────────
  const download = () => {
    const blob = new Blob([value], { type: 'text/markdown' })
    const url  = URL.createObjectURL(blob)
    const a    = document.createElement('a')
    a.href     = url
    a.download = `${case_.title.replace(/\s+/g, '_')}_report.md`
    a.click()
    URL.revokeObjectURL(url)
  }

  // ── Restore from version ──────────────────────────────────────────────────
  const handleRestore = (content: string) => {
    setValue(content)
    setDirty(true)
  }

  // Sidebar visible inline only when NOT in split mode
  const sidebarInline = editorMode !== 'split'

  const versionsSidebar = (
    <div className="space-y-3">
      <div className="flex items-center gap-2">
        <History size={13} className="text-accent-muted/50" />
        <span className="text-[10px] font-semibold tracking-widest uppercase text-accent-muted/50">
          Versions
        </span>
        {versions.length > 0 && (
          <span className="ml-auto text-[9px] text-accent-muted/30">
            {versions.length}/5
          </span>
        )}
      </div>

      {versions.length === 0 ? (
        <div className="rounded-lg border border-dashed border-white/10 px-3 py-6 text-center">
          <p className="text-[10px] text-accent-muted/30">No versions yet</p>
          <p className="text-[9px] text-accent-muted/20 mt-1">Save to create the first snapshot</p>
        </div>
      ) : (
        <div className="space-y-2">
          {versions.map(v => (
            <VersionCard
              key={v.id}
              v={v}
              caseId={case_.id}
              onRestore={handleRestore}
            />
          ))}
        </div>
      )}

      {dirty && (
        <div className="rounded border border-yellow-500/20 bg-yellow-500/5 px-3 py-2">
          <p className="text-[9px] text-yellow-400/70">Unsaved changes — save to create a new version</p>
        </div>
      )}
    </div>
  )

  return (
    <div className="flex gap-5 items-start relative">

      {/* ── Main editor ────────────────────────────────────────────────── */}
      <div className="flex-1 min-w-0 space-y-3">
        {/* Toolbar */}
        <div className="flex items-center gap-2 flex-wrap">
          <h3 className="text-accent-green font-semibold text-sm uppercase tracking-wide mr-2">
            Report
          </h3>

          <button
            className="btn-secondary text-xs flex items-center gap-1.5"
            onClick={() => generate.mutate()}
            disabled={generate.isPending}
          >
            <RefreshCw size={12} className={generate.isPending ? 'animate-spin' : ''} />
            {generate.isPending ? 'Generating…' : 'Auto-Generate'}
          </button>

          <button
            className="btn-secondary text-xs flex items-center gap-1.5"
            onClick={download}
          >
            <FileDown size={12} />
            Export .md
          </button>

          {/* Versions toggle — only shown in split/preview mode */}
          {!sidebarInline && (
            <button
              className={`text-xs flex items-center gap-1.5 ${
                versionsOpen ? 'btn-secondary text-accent-green border-accent-green/30' : 'btn-secondary'
              }`}
              onClick={() => setVersionsOpen(o => !o)}
            >
              <PanelRight size={12} />
              Versions{versions.length > 0 ? ` (${versions.length})` : ''}
            </button>
          )}

          <button
            className={`text-xs flex items-center gap-1.5 ml-auto ${
              dirty ? 'btn-primary' : 'btn-secondary opacity-60'
            }`}
            onClick={() => save.mutate()}
            disabled={save.isPending || !dirty}
          >
            <Save size={12} className={save.isPending ? 'animate-pulse' : ''} />
            {save.isPending ? 'Saving…' : dirty ? 'Save' : 'Saved'}
          </button>
        </div>

        {/* Editor — auto-resize, no scroll */}
        <MarkdownEditor
          value={value}
          onChange={v => { setValue(v); setDirty(true) }}
          caseId={case_.id}
          minHeight={400}
          autoResize
          mode={editorMode}
          onModeChange={m => {
            setEditorMode(m)
            if (m !== 'split') setVersionsOpen(false)
          }}
          placeholder="# Incident Report&#10;&#10;Write or auto-generate the report in Markdown…"
        />
      </div>

      {/* ── Version history sidebar — inline (edit/preview) or overlay (split) */}
      {sidebarInline ? (
        <div className="w-56 shrink-0">
          {versionsSidebar}
        </div>
      ) : versionsOpen ? (
        <div className="absolute right-0 top-0 z-20 w-60 rounded-lg border border-white/10 bg-[#0f1117] shadow-xl p-3">
          {versionsSidebar}
        </div>
      ) : null}
    </div>
  )
}
