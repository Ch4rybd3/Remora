/**
 * TemplateFormModal — structured form for creating a new case template.
 * Generates YAML from form fields and calls onSave(yaml).
 * Raw YAML editing is available via the "YAML" button on the existing template card.
 */
import { useState } from 'react'
import { Plus, Trash2, Save, X, ChevronDown, AlertCircle, GripVertical } from '../../ui/icons'
import Modal from '../ui/Modal'

// ── Types ──────────────────────────────────────────────────────────────────────

// 'analyse' is the legacy French value. Existing case template YAML files
// carry it, and the backend maps both spellings, so it stays accepted on read
// while new sections are written as 'analysis'.
type SectionCategory = 'analysis' | 'analyse' | 'remediation' | 'conclusion'

interface ReportSection {
  name: string
  category: SectionCategory
  template: string
}

interface FormState {
  name: string
  description: string
  version: string
  severity: string
  tlp: string
  category: string
  tags: string          // comma-separated
  executive_summary_template: string
  sections: ReportSection[]
}

const INITIAL: FormState = {
  name: '',
  description: '',
  version: '1.0',
  severity: 'medium',
  tlp: 'TLP:AMBER',
  category: 'ir',
  tags: 'incident',
  executive_summary_template:
    'On [DATE], [ORGANISATION] identified a security incident affecting [AFFECTED_SYSTEMS].\n' +
    'The incident was detected at [DETECTION_TIME] via [DETECTION_SOURCE].',
  sections: [
    { name: 'Technical Analysis', category: 'analysis',    template: '### Root Cause\n\n*Describe how the incident started...*\n\n### Attack Chain\n\n*Describe how it progressed.*' },
    { name: 'Remediations',       category: 'remediation', template: '*Remediation actions completed or in progress.*\n\n- [ ] Action 1\n- [ ] Action 2' },
    { name: 'Conclusion',         category: 'conclusion',  template: '*Summary and long-term recommendations.*\n\n- [ ] Recommendation 1' },
  ],
}

const CATEGORY_COLORS: Record<SectionCategory, string> = {
  analysis:    'bg-severity-low/10 text-severity-low border-severity-low/20',
  analyse:     'bg-severity-low/10 text-severity-low border-severity-low/20',   // legacy
  remediation: 'bg-severity-high/10 text-severity-high border-severity-high/20',
  conclusion:  'bg-data-2/10 text-data-2 border-data-2/20',
}

// ── YAML serializer ─────────────────────────────────────────────────────────────

function indent(text: string, spaces: number): string {
  const pad = ' '.repeat(spaces)
  return text.split('\n').map(l => pad + l).join('\n')
}

function yamlLiteral(text: string, baseIndent: number): string {
  return '|\n' + indent(text || '  (empty)', baseIndent)
}

function buildYaml(f: FormState): string {
  const tags = f.tags.split(',').map(t => t.trim()).filter(Boolean)
  const tagLines = tags.length > 0
    ? 'tags:\n' + tags.map(t => `  - ${t}`).join('\n')
    : 'tags: []'

  const sectionsYaml = f.sections.map(s => {
    return (
      `  - name: "${s.name}"\n` +
      `    category: ${s.category}\n` +
      `    template: ${yamlLiteral(s.template, 6)}`
    )
  }).join('\n\n')

  return [
    `name: "${f.name}"`,
    `description: "${f.description}"`,
    `version: "${f.version}"`,
    tagLines,
    `severity: ${f.severity}`,
    `tlp: "${f.tlp}"`,
    `metadata:`,
    `  category: ${f.category}`,
    ``,
    `executive_summary_template: ${yamlLiteral(f.executive_summary_template, 2)}`,
    ``,
    `report_sections:`,
    sectionsYaml,
  ].join('\n')
}

// ── Section editor ─────────────────────────────────────────────────────────────

function SectionRow({
  section, idx, onChange, onDelete,
}: {
  section: ReportSection
  idx: number
  onChange: (s: ReportSection) => void
  onDelete: () => void
}) {
  const [open, setOpen] = useState(idx < 3)

  return (
    <div className="border border-hairline overflow-hidden">
      <div className="flex items-center gap-2 px-3 py-2 bg-white/[0.02] cursor-pointer" onClick={() => setOpen(o => !o)}>
        <GripVertical size={12} className="text-fg-secondary/20 shrink-0" />
        <span className={`text-label font-mono font-bold px-1.5 py-0.5 rounded-control border ${CATEGORY_COLORS[section.category]}`}>
          {section.category}
        </span>
        <span className="text-label text-fg/70 flex-1 truncate">{section.name || <em className="text-fg-secondary/40">Sans nom</em>}</span>
        <ChevronDown size={12} className={`text-fg-secondary/40 transition-transform ${open ? 'rotate-180' : ''}`} />
        <button
          onClick={e => { e.stopPropagation(); onDelete() }}
          className="text-fg-secondary/30 hover:text-severity-critical transition-colors p-0.5"
        >
          <Trash2 size={11} />
        </button>
      </div>

      {open && (
        <div className="px-3 pb-3 pt-2 space-y-2 border-t border-hairline">
          <div className="grid grid-cols-2 gap-2">
            <div>
              <label className="label">Section name</label>
              <input
                className="input text-label"
                value={section.name}
                onChange={e => onChange({ ...section, name: e.target.value })}
                placeholder="Technical Analysis"
              />
            </div>
            <div>
              <label className="label">Category</label>
              <select
                className="input text-label"
                value={section.category}
                onChange={e => onChange({ ...section, category: e.target.value as SectionCategory })}
              >
                <option value="analysis">Technical Analysis</option>
                <option value="remediation">Remediations</option>
                <option value="conclusion">Conclusion</option>
              </select>
            </div>
          </div>
          <div>
            <label className="label">Contenu initial (Markdown)</label>
            <textarea
              className="input font-mono text-label resize-y"
              style={{ minHeight: 80 }}
              value={section.template}
              onChange={e => onChange({ ...section, template: e.target.value })}
              placeholder="Content pre-filled when the case is created..."
            />
          </div>
        </div>
      )}
    </div>
  )
}

// ── Modal ──────────────────────────────────────────────────────────────────────

interface Props {
  open: boolean
  onClose: () => void
  onSave: (yaml: string) => Promise<void>
  isSaving: boolean
  error: string | null
}

export default function TemplateFormModal({ open, onClose, onSave, isSaving, error }: Props) {
  const [form, setForm] = useState<FormState>(INITIAL)

  const updateSection = (idx: number, s: ReportSection) =>
    setForm(f => { const ss = [...f.sections]; ss[idx] = s; return { ...f, sections: ss } })

  const deleteSection = (idx: number) =>
    setForm(f => ({ ...f, sections: f.sections.filter((_, i) => i !== idx) }))

  const addSection = () =>
    setForm(f => ({
      ...f,
      sections: [...f.sections, { name: 'New section', category: 'analysis', template: '' }],
    }))

  const handleSave = async () => {
    if (!form.name.trim()) return
    await onSave(buildYaml(form))
    // Reset on success (parent closes the modal)
    setForm(INITIAL)
  }

  return (
    <Modal open={open} onClose={onClose} title="New template" size="lg">
      <div className="space-y-5 max-h-[72vh] overflow-y-auto pr-1">

        {error && (
          <div className="flex items-start gap-2 bg-severity-critical/10 border border-severity-critical/20 px-4 py-3">
            <AlertCircle size={14} className="text-severity-critical mt-0.5 shrink-0" />
            <p className="text-label text-severity-critical font-mono leading-relaxed">{error}</p>
          </div>
        )}

        {/* -- Metadata ------------------------------------------------------- */}
        <div className="space-y-3">
          <p className="text-label font-semibold tracking-widest uppercase text-fg-secondary/40">Metadata</p>

          <div>
            <label className="label">Name *</label>
            <input
              className="input"
              placeholder="Ransomware — Generic"
              value={form.name}
              onChange={e => setForm(f => ({ ...f, name: e.target.value }))}
            />
          </div>

          <div>
            <label className="label">Description</label>
            <input
              className="input"
              placeholder="Generic template for ransomware incidents"
              value={form.description}
              onChange={e => setForm(f => ({ ...f, description: e.target.value }))}
            />
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="label">Category</label>
              <select className="input" value={form.category} onChange={e => setForm(f => ({ ...f, category: e.target.value }))}>
                <option value="ir">IR — Incident Response</option>
                <option value="ctf">CTF</option>
                <option value="pentest">Pentest</option>
                <option value="generic">Generic</option>
                <option value="sample">Sample / Test</option>
              </select>
            </div>
            <div>
              <label className="label">Version</label>
              <input
                className="input"
                placeholder="1.0"
                value={form.version}
                onChange={e => setForm(f => ({ ...f, version: e.target.value }))}
              />
            </div>
          </div>

          <div className="grid grid-cols-3 gap-3">
            <div>
              <label className="label">Severity</label>
              <select className="input" value={form.severity} onChange={e => setForm(f => ({ ...f, severity: e.target.value }))}>
                {['informational', 'low', 'medium', 'high', 'critical'].map(s => <option key={s}>{s}</option>)}
              </select>
            </div>
            <div>
              <label className="label">TLP</label>
              <select className="input" value={form.tlp} onChange={e => setForm(f => ({ ...f, tlp: e.target.value }))}>
                {['TLP:RED', 'TLP:AMBER', 'TLP:GREEN', 'TLP:CLEAR'].map(t => <option key={t}>{t}</option>)}
              </select>
            </div>
            <div>
              <label className="label">Tags (virgule)</label>
              <input
                className="input"
                placeholder="incident, malware"
                value={form.tags}
                onChange={e => setForm(f => ({ ...f, tags: e.target.value }))}
              />
            </div>
          </div>
        </div>

        {/* ── Executive Summary Template ────────────────────────────────────── */}
        <div className="space-y-2">
          <p className="text-label font-semibold tracking-widest uppercase text-fg-secondary/40">
            Executive Summary - initial model
          </p>
          <textarea
            className="input font-mono text-label resize-y"
            style={{ minHeight: 80 }}
            value={form.executive_summary_template}
            onChange={e => setForm(f => ({ ...f, executive_summary_template: e.target.value }))}
            placeholder="On [DATE], [ORGANISATION] identified…"
          />
        </div>

        {/* ── Report sections ───────────────────────────────────────────────── */}
        <div className="space-y-2">
          <div className="flex items-center justify-between">
            <p className="text-label font-semibold tracking-widest uppercase text-fg-secondary/40">
              Sections du rapport
              <span className="ml-2 text-accent/60">{form.sections.length}</span>
            </p>
            <button
              onClick={addSection}
              className="flex items-center gap-1 text-label px-2 py-1 rounded-control border border-accent/20 text-accent/70 hover:bg-accent/10 transition-colors"
            >
              <Plus size={10} /> Add section
            </button>
          </div>
          <div className="space-y-2">
            {form.sections.map((s, idx) => (
              <SectionRow
                key={idx}
                section={s}
                idx={idx}
                onChange={s => updateSection(idx, s)}
                onDelete={() => deleteSection(idx)}
              />
            ))}
            {form.sections.length === 0 && (
              <p className="text-label text-fg-secondary/30 italic text-center py-4">
                No section - the report will be empty by default.
              </p>
            )}
          </div>
        </div>
      </div>

      {/* ── Actions ───────────────────────────────────────────────────────────── */}
      <div className="flex justify-end gap-3 pt-4 border-t border-hairline mt-4">
        <button className="btn-secondary flex items-center gap-1.5" onClick={onClose}>
          <X size={13} /> Cancel
        </button>
        <button
          className="btn-primary flex items-center gap-1.5"
          onClick={handleSave}
          disabled={isSaving || !form.name.trim()}
        >
          <Save size={13} />
          {isSaving ? 'Creating...' : 'Create the template'}
        </button>
      </div>
    </Modal>
  )
}
