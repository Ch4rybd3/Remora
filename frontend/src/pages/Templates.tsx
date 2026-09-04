import { useState } from 'react'
import { PageShell } from '../ui/PageShell'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import {
  FileText, Plus, Edit2, Trash2, Save, X, AlertCircle,
  ChevronDown, ChevronUp, Shield,
} from '../ui/icons'
import { templatesApi } from '../api/templates'
import type { Template } from '../types'
import { SeverityBadge, TLPBadge, Tag } from '../components/ui/Badge'
import Modal from '../components/ui/Modal'
import ConfirmDialog from '../components/ui/ConfirmDialog'
import TemplateTTPModal from '../components/mitre/TemplateTTPModal'
import TemplateFormModal from '../components/templates/TemplateFormModal'

interface EditorModalProps {
  open:        boolean
  onClose:     () => void
  initialYaml: string
  title:       string
  onSave:      (yaml: string) => Promise<void>
  isSaving:    boolean
  error:       string | null
}

function EditorModal({ open, onClose, initialYaml, title, onSave, isSaving, error }: EditorModalProps) {
  const [yaml, setYaml] = useState(initialYaml)

  return (
    <Modal open={open} onClose={onClose} title={title} size="lg">
      <div className="space-y-3">
        {error && (
          <div className="flex items-start gap-2 bg-severity-critical/10 border border-severity-critical/20 px-4 py-3">
            <AlertCircle size={14} className="text-severity-critical mt-0.5 shrink-0" />
            <p className="text-label text-severity-critical font-mono leading-relaxed">{error}</p>
          </div>
        )}
        <div>
          <label className="label">YAML</label>
          <textarea
            className="input font-mono text-label leading-relaxed resize-none"
            style={{ height: '480px' }}
            value={yaml}
            onChange={e => setYaml(e.target.value)}
            spellCheck={false}
          />
        </div>
        <div className="flex justify-end gap-3 pt-1">
          <button className="btn-secondary flex items-center gap-1.5" onClick={onClose}>
            <X size={13} /> Cancel
          </button>
          <button
            className="btn-primary flex items-center gap-1.5"
            onClick={() => onSave(yaml)}
            disabled={isSaving}
          >
            <Save size={13} />
            {isSaving ? 'Saving…' : 'Save Template'}
          </button>
        </div>
      </div>
    </Modal>
  )
}

// ── Template card ─────────────────────────────────────────────────────────────

interface TemplateCardProps {
  tpl:       Template
  onEdit:    (id: string) => void
  onDelete:  (id: string) => void
  onEditTTPs:(tpl: Template) => void
}

function TemplateCard({ tpl, onEdit, onDelete, onEditTTPs }: TemplateCardProps) {
  const [expanded, setExpanded] = useState(false)
  const ttpCount = tpl.ttp_definitions?.length ?? 0

  return (
    <div className="card p-5">
      <div className="flex items-start justify-between gap-4">
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-3 mb-1">
            <FileText size={15} className="text-accent shrink-0" />
            <h2 className="font-semibold text-fg">{tpl.name}</h2>
            <span className="text-label text-fg-secondary/60 font-mono shrink-0">v{tpl.version}</span>
            <span className="text-label text-fg-secondary/40 font-mono shrink-0">· {tpl.id}.yaml</span>
          </div>
          <p className="text-ui text-fg-secondary">{tpl.description}</p>
        </div>

        <div className="flex items-center gap-2 shrink-0">
          <SeverityBadge severity={tpl.severity} />
          <TLPBadge tlp={tpl.tlp} />

          {/* TTPs button with count badge */}
          <button
            onClick={() => onEditTTPs(tpl)}
            className="relative flex items-center gap-1.5 btn-secondary text-label ml-1"
            title="Edit MITRE ATT&CK TTPs"
          >
            <Shield size={12} />
            TTPs
            {ttpCount > 0 && (
              <span className="ml-0.5 px-1.5 py-0.5 rounded-pill bg-accent/20 text-accent text-label font-mono font-bold leading-none">
                {ttpCount}
              </span>
            )}
          </button>

          <button
            onClick={() => onEdit(tpl.id)}
            className="btn-secondary text-label flex items-center gap-1.5"
          >
            <Edit2 size={12} /> YAML
          </button>
          <button
            onClick={() => onDelete(tpl.id)}
            className="text-fg-secondary hover:text-severity-critical transition-colors p-1"
          >
            <Trash2 size={14} />
          </button>
        </div>
      </div>

      {tpl.tags && tpl.tags.length > 0 && (
        <div className="flex items-center gap-2 flex-wrap mt-3">
          {tpl.tags.map(t => <Tag key={t} label={t} />)}
        </div>
      )}

      {/* Expandable detail section */}
      {(!!tpl.report_sections || !!tpl.metadata?.mitre_tactics || ttpCount > 0) && (
        <>
          <button
            onClick={() => setExpanded(e => !e)}
            className="flex items-center gap-1.5 text-label text-fg-secondary hover:text-fg mt-3 transition-colors"
          >
            {expanded ? <ChevronUp size={13} /> : <ChevronDown size={13} />}
            {expanded ? 'Hide details' : 'Show details'}
          </button>

          {expanded && (
            <div className="mt-3 space-y-3">

              {/* ttp_definitions pills */}
              {ttpCount > 0 && (
                <div className="border-t border-hairline pt-3">
                  <div className="flex items-center gap-2 mb-2">
                    <Shield size={10} className="text-accent/60" />
                    <p className="text-label text-fg-secondary uppercase tracking-wide">
                      MITRE ATT&amp;CK TTPs
                      <span className="ml-1.5 font-mono text-accent/60">({ttpCount})</span>
                    </p>
                  </div>
                  <div className="flex flex-wrap gap-1.5">
                    {tpl.ttp_definitions!.map(t => (
                      <span
                        key={`${t.technique_id}|${t.tactic}`}
                        className="text-label bg-accent/5 text-accent/70 border border-accent/20 px-2 py-0.5 rounded-control font-mono"
                        title={`${t.technique_name} · ${t.tactic_name}`}
                      >
                        {t.technique_id}
                      </span>
                    ))}
                  </div>
                </div>
              )}

              {tpl.report_sections != null && (
                <div className="border-t border-hairline pt-3">
                  <p className="text-label text-fg-secondary uppercase tracking-wide mb-2">Report Sections</p>
                  <div className="flex flex-wrap gap-2">
                    {tpl.report_sections.map(s => (
                      <span key={s.name} className="text-label bg-fg/5 text-fg-secondary px-2 py-1 rounded-control font-mono">
                        {s.name}
                      </span>
                    ))}
                  </div>
                </div>
              )}

              {tpl.metadata?.mitre_tactics != null && Array.isArray(tpl.metadata.mitre_tactics) && (
                <div className="border-t border-hairline pt-3">
                  <p className="text-label text-fg-secondary uppercase tracking-wide mb-2">MITRE Tactics (legacy)</p>
                  <div className="flex flex-wrap gap-2">
                    {(tpl.metadata.mitre_tactics as string[]).map(t => (
                      <span key={t} className="text-label bg-fg/5 text-fg-secondary/50 border border-hairline px-2 py-0.5 rounded-control font-mono">
                        {t}
                      </span>
                    ))}
                  </div>
                </div>
              )}
            </div>
          )}
        </>
      )}
    </div>
  )
}

// ── Page ──────────────────────────────────────────────────────────────────────

export default function Templates() {
  const qc = useQueryClient()
  const { data: templates = [], isLoading } = useQuery({
    queryKey: ['templates'],
    queryFn:  templatesApi.list,
  })

  const [editTarget,    setEditTarget]    = useState<{ id: string; yaml: string } | null>(null)
  const [createOpen,    setCreateOpen]    = useState(false)
  const [deleteTarget,  setDeleteTarget]  = useState<string | null>(null)
  const [ttpTarget,     setTtpTarget]     = useState<Template | null>(null)
  const [yamlError,     setYamlError]     = useState<string | null>(null)

  const updateMutation = useMutation({
    mutationFn: ({ id, yaml }: { id: string; yaml: string }) =>
      templatesApi.update(id, yaml),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['templates'] })
      setEditTarget(null)
      setYamlError(null)
    },
    onError: (err: any) => {
      setYamlError(err.response?.data?.detail ?? 'Failed to save template')
    },
  })

  const createMutation = useMutation({
    mutationFn: (yaml: string) => templatesApi.create(yaml),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['templates'] })
      setCreateOpen(false)
      setYamlError(null)
    },
    onError: (err: any) => {
      setYamlError(err.response?.data?.detail ?? 'Failed to create template')
    },
  })

  const deleteMutation = useMutation({
    mutationFn: (id: string) => templatesApi.delete(id),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['templates'] }),
  })

  const openEdit = async (id: string) => {
    setYamlError(null)
    const raw = await templatesApi.getRaw(id)
    setEditTarget({ id, yaml: raw })
  }

  return (
    <PageShell
      route="/templates"
      title="Case Templates"
      subtitle={"Stored as YAML in templates/"}
      actions={(
        <button
          className="btn-primary flex items-center gap-1.5"
          onClick={() => { setYamlError(null); setCreateOpen(true) }}
        >
          <Plus size={13} /> New Template
        </button>
      )}
    >
      <div className="max-w-4xl mx-auto">
      {isLoading ? (
        <div className="text-fg-secondary text-ui">Loading…</div>
      ) : templates.length === 0 ? (
        <div className="card p-8 text-center">
          <FileText size={32} className="mx-auto mb-3 text-fg-secondary/30" />
          <p className="text-fg-secondary text-ui">No templates found.</p>
          <button className="btn-primary mt-4 text-label" onClick={() => setCreateOpen(true)}>
            Create first template
          </button>
        </div>
      ) : (
        <div className="space-y-4">
          {templates.map(tpl => (
            <TemplateCard
              key={tpl.id}
              tpl={tpl}
              onEdit={openEdit}
              onDelete={id => setDeleteTarget(id)}
              onEditTTPs={setTtpTarget}
            />
          ))}
        </div>
      )}

      {/* YAML Edit modal */}
      {editTarget && (
        <EditorModal
          open={true}
          onClose={() => { setEditTarget(null); setYamlError(null) }}
          initialYaml={editTarget.yaml}
          title={`Edit — ${editTarget.id}.yaml`}
          onSave={async yaml => { await updateMutation.mutateAsync({ id: editTarget.id, yaml }) }}
          isSaving={updateMutation.isPending}
          error={yamlError}
        />
      )}

      {/* Form-based Create modal */}
      <TemplateFormModal
        open={createOpen}
        onClose={() => { setCreateOpen(false); setYamlError(null) }}
        onSave={async yaml => { await createMutation.mutateAsync(yaml) }}
        isSaving={createMutation.isPending}
        error={yamlError}
      />

      {/* Delete confirm */}
      <ConfirmDialog
        open={!!deleteTarget}
        onClose={() => setDeleteTarget(null)}
        onConfirm={() => deleteTarget && deleteMutation.mutate(deleteTarget)}
        title="Delete Template"
        message={`The file ${deleteTarget}.yaml will be permanently deleted.`}
      />

      {/* TTP picker — full-screen modal */}
      {ttpTarget && (
        <TemplateTTPModal
          template={ttpTarget}
          onClose={() => setTtpTarget(null)}
          onSaved={() => setTtpTarget(null)}
        />
      )}
      </div>
    </PageShell>
  )
}
