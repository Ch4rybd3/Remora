import { useState, useRef, useCallback } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import {
  FileOutput, Upload, Trash2, Tag, Info,
  ChevronDown, ChevronUp, X, Check, AlertCircle,
} from '../ui/icons'
import { reportDocTemplatesApi, type ReportDocTemplate } from '../api/reportDocTemplates'
import { fmtDateTimeShort } from '../utils/dateUtils'
import { fmtBytes as fmtSize } from '../utils/formatUtils'

// ── Helpers ────────────────────────────────────────────────────────────────────

// ── Format badge ───────────────────────────────────────────────────────────────

function FormatBadge({ format }: { format: string }) {
  return format === 'docx' ? (
    <span className="text-label font-mono font-bold px-1.5 py-0.5 rounded-control border bg-severity-low/10 text-severity-low border-severity-low/20">
      DOCX
    </span>
  ) : (
    <span className="text-label font-mono font-bold px-1.5 py-0.5 rounded-control border bg-data-2/10 text-data-2 border-data-2/20">
      MD
    </span>
  )
}

// ── Tag pill ───────────────────────────────────────────────────────────────────

const BLOCK_TAGS    = new Set(['ioc_table', 'asset_table', 'evidence_table', 'timeline_table', 'attack_graph', 'mitre_matrix', 'mitre_matrix_img'])
const REPORT_TAGS   = new Set(['report_content'])

function TagPill({ tag }: { tag: string }) {
  const isBlock  = BLOCK_TAGS.has(tag)
  const isReport = REPORT_TAGS.has(tag)
  return (
    <span className={`text-label font-mono px-1.5 py-0.5 rounded-control border ${ isReport
        ? 'bg-data-2/10 text-data-2 border-data-2/20'
        : isBlock
        ? 'bg-accent/10 text-accent border-accent/20'
        : 'bg-fg/5 text-fg-secondary/60 border-hairline'
    }`}>
      {`{{${tag}}}`}
    </span>
  )
}

// ── Template card ──────────────────────────────────────────────────────────────

function TemplateCard({
  tpl, onDelete,
}: {
  tpl: ReportDocTemplate
  onDelete: (id: number) => void
}) {
  const [expanded, setExpanded] = useState(false)

  return (
    <div className="card p-5 space-y-3">
      {/* Header row */}
      <div className="flex items-start gap-3">
        <div className="shrink-0 mt-0.5">
          <FileOutput size={18} className="text-accent/70" />
        </div>

        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="font-semibold text-fg">{tpl.name}</span>
            <FormatBadge format={tpl.format} />
            <span className="text-label text-fg-secondary/40 font-mono">{fmtSize(tpl.file_size)}</span>
          </div>
          {tpl.description && (
            <p className="text-label text-fg-secondary mt-0.5">{tpl.description}</p>
          )}
          <p className="text-label text-fg-secondary/30 mt-1">
            Imported {fmtDateTimeShort(tpl.created_at)}{tpl.created_by ? ` by ${tpl.created_by}` : ''}
          </p>
        </div>

        <button
          onClick={() => onDelete(tpl.id)}
          className="shrink-0 p-1 rounded-control text-fg-secondary/40 hover:text-severity-critical transition-colors"
          title="Delete template"
        >
          <Trash2 size={14} />
        </button>
      </div>

      {/* Detected tags section */}
      {tpl.tags_detected.length > 0 && (
        <>
          <button
            onClick={() => setExpanded(e => !e)}
            className="flex items-center gap-1.5 text-label text-fg-secondary/50 hover:text-fg transition-colors"
          >
            <Tag size={10} />
            {tpl.tags_detected.length} tag{tpl.tags_detected.length !== 1 ? 's' : ''} detected
            {expanded ? <ChevronUp size={10} /> : <ChevronDown size={10} />}
          </button>

          {expanded && (
            <div className="flex flex-wrap gap-1.5 pt-1 border-t border-hairline">
              {tpl.tags_detected.map(t => <TagPill key={t} tag={t} />)}
            </div>
          )}
        </>
      )}

      {tpl.tags_detected.length === 0 && (
        <p className="text-label text-fg-secondary/30 italic flex items-center gap-1">
          <AlertCircle size={10} /> No recognised tags found in this template.
        </p>
      )}
    </div>
  )
}

// ── Upload form ────────────────────────────────────────────────────────────────

function UploadForm({ onDone }: { onDone: () => void }) {
  const qc = useQueryClient()
  const [name, setName] = useState('')
  const [description, setDescription] = useState('')
  const [file, setFile] = useState<File | null>(null)
  const [dragging, setDragging] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const inputRef = useRef<HTMLInputElement>(null)

  const upload = useMutation({
    mutationFn: () => reportDocTemplatesApi.upload({ name, description, file: file! }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['report-doc-templates'] })
      onDone()
    },
    onError: (err: any) => {
      setError(err.response?.data?.detail ?? 'Upload failed')
    },
  })

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault()
    setDragging(false)
    const f = e.dataTransfer.files[0]
    if (f) { setFile(f); if (!name) setName(f.name.replace(/\.(docx|md)$/, '')) }
  }, [name])

  const handleFile = (f: File | undefined) => {
    if (!f) return
    setFile(f)
    if (!name) setName(f.name.replace(/\.(docx|md)$/, ''))
  }

  return (
    <div className="card p-6 space-y-4 border-accent/20">
      <h3 className="text-ui font-semibold text-accent">Import a template</h3>

      {error && (
        <div className="flex items-start gap-2 bg-severity-critical/10 border border-severity-critical/20 px-3 py-2">
          <AlertCircle size={13} className="text-severity-critical shrink-0 mt-0.5" />
          <p className="text-label text-severity-critical">{error}</p>
        </div>
      )}

      {/* Drop zone */}
      <div
        onDragOver={e => { e.preventDefault(); setDragging(true) }}
        onDragLeave={() => setDragging(false)}
        onDrop={handleDrop}
        onClick={() => inputRef.current?.click()}
        className={`border-2 border-dashed p-6 text-center cursor-pointer transition-colors ${
          dragging ? 'border-accent/60 bg-accent/5' : 'border-hairline hover:border-strong'
        }`}
      >
        <Upload size={22} className="mx-auto mb-2 text-fg-secondary/40" />
        {file ? (
          <div className="flex items-center justify-center gap-2">
            <FileOutput size={14} className="text-accent" />
            <span className="text-ui text-fg font-medium">{file.name}</span>
            <span className="text-label text-fg-secondary/50">{fmtSize(file.size)}</span>
          </div>
        ) : (
          <>
            <p className="text-ui text-fg-secondary/60">Drop a <code className="font-mono text-label bg-fg/5 px-1 rounded-control">.docx</code> or <code className="font-mono text-label bg-fg/5 px-1 rounded-control">.md</code> file here</p>
            <p className="text-label text-fg-secondary/30 mt-1">or click to browse</p>
          </>
        )}
        <input
          ref={inputRef}
          type="file"
          accept=".docx,.md"
          className="sr-only"
          onChange={e => handleFile(e.target.files?.[0])}
        />
      </div>

      {/* Name */}
      <div>
        <label className="label">Template name <span className="text-severity-critical">*</span></label>
        <input
          className="input"
          placeholder="e.g. ACME Incident Report"
          value={name}
          onChange={e => setName(e.target.value)}
        />
      </div>

      {/* Description */}
      <div>
        <label className="label">Description</label>
        <input
          className="input"
          placeholder="Short description (optional)"
          value={description}
          onChange={e => setDescription(e.target.value)}
        />
      </div>

      <div className="flex justify-end gap-2 pt-1">
        <button className="btn-secondary text-label flex items-center gap-1.5" onClick={onDone}>
          <X size={12} /> Cancel
        </button>
        <button
          className="btn-primary text-label flex items-center gap-1.5"
          disabled={!file || !name.trim() || upload.isPending}
          onClick={() => { setError(null); upload.mutate() }}
        >
          {upload.isPending ? (
            <><span className="animate-spin">⟳</span> Importing…</>
          ) : (
            <><Check size={12} /> Import template</>
          )}
        </button>
      </div>
    </div>
  )
}

// ── Tag reference ─────────────────────────────────────────────────────────────

const TAG_DOCS: { group: string; color: 'meta' | 'report' | 'annex'; tags: { tag: string; desc: string }[] }[] = [
  {
    group: 'Part 1 - Incident metadata',
    color: 'meta',
    tags: [
      { tag: 'case.title',             desc: 'Case title' },
      { tag: 'case.id',                desc: 'UUID du cas' },
      { tag: 'case.status',            desc: 'Status (open / in_progress / closed...)' },
      { tag: 'case.severity',          desc: 'Severity (CRITICAL, HIGH...)' },
      { tag: 'case.tlp',               desc: 'Classification TLP' },
      { tag: 'case.created_at',        desc: 'Creation date' },
      { tag: 'case.closed_at',         desc: 'Closing date (or N/A)' },
      { tag: 'case.description',       desc: 'Description du cas' },
      { tag: 'case.executive_summary', desc: 'Executive summary' },
      { tag: 'case.quick_notes',       desc: 'Notes rapides' },
      { tag: 'case.assigned_to',       desc: 'Assigned analyst(s)' },
      { tag: 'case.tags',              desc: 'Tags du cas' },
      { tag: 'report.date',            desc: 'Report generation date (YYYY-MM-DD)' },
      { tag: 'report.author',          desc: 'Analyst who generated the report' },
    ],
  },
  {
    group: 'Part 2 - Analysis, Remediations & Conclusions',
    color: 'report',
    tags: [
      {
        tag: 'report_analysis',
        desc: 'Box 1 - Technical Analysis written in the Report tab. '
            + 'In DOCX: converted to formatted Word paragraphs. In MD: inserted as-is.',
      },
      {
        tag: 'report_remediation',
        desc: 'Box 2 - Remediations written in the Report tab.',
      },
      {
        tag: 'report_conclusion',
        desc: 'Box 3 - Conclusion & Recommendations written in the Report tab.',
      },
      {
        tag: 'report_content',
        desc: 'Combined alias (backward compatible) - injects the three boxes in sequence, separated by ---.',
      },
    ],
  },
  {
    group: 'Partie 3 — Annexes (tableaux & images)',
    color: 'annex',
    tags: [
      { tag: 'ioc_table',        desc: 'Tableau des indicateurs de compromission' },
      { tag: 'asset_table',      desc: 'Table of the assets involved' },
      { tag: 'evidence_table',   desc: 'Table of evidence items' },
      { tag: 'timeline_table',   desc: 'Chronological timeline of events' },
      { tag: 'mitre_matrix',     desc: 'MITRE ATT&CK matrix as text (parents plus selected sub-techniques)' },
      { tag: 'mitre_matrix_img', desc: 'Matrice MITRE ATT&CK en image PNG (DOCX uniquement) — placeholder en MD' },
      { tag: 'attack_graph',     desc: 'Graphe d\'attaque en image PNG (DOCX) ou placeholder (MD)' },
    ],
  },
]

const GROUP_STYLE: Record<string, { border: string; header: string; badge: string; badgeText: string; codeColor: string }> = {
  meta:   { border: 'border-severity-low/15',   header: 'text-severity-low/70',   badge: 'bg-severity-low/8 border-severity-low/20 text-severity-low',     badgeText: 'Metadata', codeColor: 'text-severity-low' },
  report: { border: 'border-data-2/20', header: 'text-data-2/80', badge: 'bg-data-2/8 border-data-2/20 text-data-2', badgeText: 'Report',     codeColor: 'text-data-2' },
  annex:  { border: 'border-accent/15', header: 'text-accent/70', badge: 'bg-accent/8 border-accent/20 text-accent', badgeText: 'Annexe', codeColor: 'text-accent' },
}

function TagReference({ open, onClose }: { open: boolean; onClose: () => void }) {
  if (!open) return null
  return (
    <div className="card p-5 space-y-5">
      <div className="flex items-center justify-between">
        <h3 className="text-ui font-semibold text-fg flex items-center gap-2">
          <Info size={14} className="text-accent" />
          Available tag reference
        </h3>
        <button onClick={onClose} className="text-fg-secondary/40 hover:text-fg">
          <X size={14} />
        </button>
      </div>

      <p className="text-label text-fg-secondary/60">
        Place these tags in your DOCX or Markdown file using double braces <code className="font-mono text-label bg-fg/5 px-1 rounded-control">{'{{tag}}'}</code>.
        Block tags (Report &amp; Annexes) must sit <em>alone on their own paragraph or line</em> in the DOCX template.
      </p>

      {/* Visual structure reminder */}
      <div className=" border border-hairline bg-white/[0.02] px-4 py-3 font-mono text-label leading-6 text-fg-secondary/50 space-y-0.5">
        <p className="text-fg-secondary/30 italic mb-1">Recommended template structure:</p>
        <p><span className="text-severity-low">{'{{case.title}}'}</span>  <span className="text-severity-low">{'{{case.created_at}}'}</span>  …</p>
        <p className="text-fg-secondary/30">-- part 1: metadata --------------------</p>
        <p className="mt-1">
          <span className="text-data-2">{'{{report_analysis}}'}</span>
        </p>
        <p><span className="text-data-2">{'{{report_remediation}}'}</span></p>
        <p><span className="text-data-2">{'{{report_conclusion}}'}</span></p>
        <p className="text-fg-secondary/30">-- part 2: analysis & remediations -----</p>
        <p className="mt-1">
          <span className="text-accent">{'{{ioc_table}}'}</span>{'  '}
          <span className="text-accent">{'{{timeline_table}}'}</span>{'  '}
          <span className="text-accent">{'{{mitre_matrix_img}}'}</span>{'  …'}
        </p>
        <p className="text-fg-secondary/30">── partie 3 : annexes ──────────────────</p>
      </div>

      <div className="space-y-4">
        {TAG_DOCS.map(g => {
          const s = GROUP_STYLE[g.color]
          return (
            <div key={g.group}>
              <div className="flex items-center gap-2 mb-2">
                <p className={`text-label font-semibold tracking-widest uppercase ${s.header}`}>{g.group}</p>
                <span className={`text-label font-semibold px-1.5 py-0.5 rounded-control border ${s.badge}`}>{s.badgeText}</span>
              </div>
              <div className={` border ${s.border} overflow-hidden`}>
                {g.tags.map((t, i) => (
                  <div
                    key={t.tag}
                    className={`flex items-start gap-3 px-3 py-2 ${i % 2 === 0 ? 'bg-white/[0.02]' : ''}`}
                  >
                    <code className={`text-label font-mono shrink-0 mt-0.5 ${s.codeColor}`}>{`{{${t.tag}}}`}</code>
                    <span className="text-label text-fg-secondary/60 flex-1">{t.desc}</span>
                  </div>
                ))}
              </div>
            </div>
          )
        })}
      </div>
    </div>
  )
}

// ── Page ───────────────────────────────────────────────────────────────────────

export default function ReportTemplates() {
  const qc = useQueryClient()
  const [showUpload, setShowUpload] = useState(false)
  const [showRef, setShowRef] = useState(false)

  const { data: templates = [], isLoading } = useQuery({
    queryKey: ['report-doc-templates'],
    queryFn: reportDocTemplatesApi.list,
  })

  const deleteMutation = useMutation({
    mutationFn: reportDocTemplatesApi.delete,
    onSuccess: () => qc.invalidateQueries({ queryKey: ['report-doc-templates'] }),
  })

  const handleDelete = (id: number) => {
    if (confirm('Delete this report template? This cannot be undone.')) {
      deleteMutation.mutate(id)
    }
  }

  return (
    <div className="p-6 max-w-4xl mx-auto space-y-6">
      {/* Header */}
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-title font-bold text-accent flex items-center gap-2">
            <FileOutput size={22} />
            Report Templates
          </h1>
          <p className="text-fg-secondary text-ui mt-1">
            Import DOCX or Markdown templates with <code className="font-mono text-label bg-fg/5 px-1.5 py-0.5 rounded-control">{'{{tags}}'}</code> to generate formatted incident reports.
          </p>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          <button
            className="btn-secondary text-label flex items-center gap-1.5"
            onClick={() => setShowRef(r => !r)}
          >
            <Info size={12} />
            Tag reference
          </button>
          <button
            className="btn-primary flex items-center gap-2 text-ui"
            onClick={() => setShowUpload(u => !u)}
          >
            <Upload size={14} />
            Import template
          </button>
        </div>
      </div>

      {/* Tag reference panel */}
      <TagReference open={showRef} onClose={() => setShowRef(false)} />

      {/* Upload form */}
      {showUpload && <UploadForm onDone={() => setShowUpload(false)} />}

      {/* Template list */}
      {isLoading ? (
        <p className="text-fg-secondary text-ui">Loading…</p>
      ) : templates.length === 0 && !showUpload ? (
        <div className="card p-10 text-center space-y-3">
          <FileOutput size={36} className="mx-auto text-fg-secondary/20" />
          <p className="text-fg-secondary text-ui">No report templates imported yet.</p>
          <p className="text-fg-secondary/50 text-label max-w-sm mx-auto">
            Import a <strong>.docx</strong> file (with your company branding) or a <strong>.md</strong> file containing <code className="font-mono bg-fg/5 px-1 rounded-control">{'{{tags}}'}</code> placeholders.
          </p>
          <button className="btn-primary text-label mt-2" onClick={() => setShowUpload(true)}>
            <Upload size={12} className="inline mr-1.5" />
            Import first template
          </button>
        </div>
      ) : (
        <div className="space-y-3">
          {templates.map(tpl => (
            <TemplateCard key={tpl.id} tpl={tpl} onDelete={handleDelete} />
          ))}
        </div>
      )}
    </div>
  )
}
