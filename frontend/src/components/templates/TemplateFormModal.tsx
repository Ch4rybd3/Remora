/**
 * TemplateFormModal — structured form for creating a new case template.
 * Generates YAML from form fields and calls onSave(yaml).
 * Raw YAML editing is available via the "YAML" button on the existing template card.
 */
import { useState } from 'react'
import { Plus, Trash2, Save, X, ChevronDown, AlertCircle, GripVertical } from 'lucide-react'
import Modal from '../ui/Modal'

// ── Types ──────────────────────────────────────────────────────────────────────

type SectionCategory = 'analyse' | 'remediation' | 'conclusion'

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
    { name: 'Analyse Technique', category: 'analyse',     template: '### Cause Racine\n\n*Décrire l\'origine de l\'incident…*\n\n### Chaîne d\'Attaque\n\n*Décrire la progression.*' },
    { name: 'Remédiations',      category: 'remediation', template: '*Actions de remédiation réalisées ou en cours.*\n\n- [ ] Action 1\n- [ ] Action 2' },
    { name: 'Conclusion',        category: 'conclusion',  template: '*Synthèse et recommandations long terme.*\n\n- [ ] Recommandation 1' },
  ],
}

const CATEGORY_COLORS: Record<SectionCategory, string> = {
  analyse:     'bg-blue-500/10 text-blue-400 border-blue-500/20',
  remediation: 'bg-orange-500/10 text-orange-400 border-orange-500/20',
  conclusion:  'bg-purple-500/10 text-purple-400 border-purple-500/20',
}

// ── YAML serializer ─────────────────────────────────────────────────────────────

function indent(text: string, spaces: number): string {
  const pad = ' '.repeat(spaces)
  return text.split('\n').map(l => pad + l).join('\n')
}

function yamlLiteral(text: string, baseIndent: number): string {
  return '|\n' + indent(text || '  (vide)', baseIndent)
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
    <div className="border border-white/8 rounded-lg overflow-hidden">
      <div className="flex items-center gap-2 px-3 py-2 bg-white/[0.02] cursor-pointer" onClick={() => setOpen(o => !o)}>
        <GripVertical size={12} className="text-accent-muted/20 shrink-0" />
        <span className={`text-[9px] font-mono font-bold px-1.5 py-0.5 rounded border ${CATEGORY_COLORS[section.category]}`}>
          {section.category}
        </span>
        <span className="text-xs text-white/70 flex-1 truncate">{section.name || <em className="text-accent-muted/40">Sans nom</em>}</span>
        <ChevronDown size={12} className={`text-accent-muted/40 transition-transform ${open ? 'rotate-180' : ''}`} />
        <button
          onClick={e => { e.stopPropagation(); onDelete() }}
          className="text-accent-muted/30 hover:text-severity-critical transition-colors p-0.5"
        >
          <Trash2 size={11} />
        </button>
      </div>

      {open && (
        <div className="px-3 pb-3 pt-2 space-y-2 border-t border-white/5">
          <div className="grid grid-cols-2 gap-2">
            <div>
              <label className="label">Nom de la section</label>
              <input
                className="input text-xs"
                value={section.name}
                onChange={e => onChange({ ...section, name: e.target.value })}
                placeholder="Analyse Technique"
              />
            </div>
            <div>
              <label className="label">Catégorie</label>
              <select
                className="input text-xs"
                value={section.category}
                onChange={e => onChange({ ...section, category: e.target.value as SectionCategory })}
              >
                <option value="analyse">Analyse Technique</option>
                <option value="remediation">Remédiations</option>
                <option value="conclusion">Conclusion</option>
              </select>
            </div>
          </div>
          <div>
            <label className="label">Contenu initial (Markdown)</label>
            <textarea
              className="input font-mono text-xs resize-y"
              style={{ minHeight: 80 }}
              value={section.template}
              onChange={e => onChange({ ...section, template: e.target.value })}
              placeholder="Contenu pré-rempli lors de la création du case…"
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
      sections: [...f.sections, { name: 'Nouvelle section', category: 'analyse', template: '' }],
    }))

  const handleSave = async () => {
    if (!form.name.trim()) return
    await onSave(buildYaml(form))
    // Reset on success (parent closes the modal)
    setForm(INITIAL)
  }

  return (
    <Modal open={open} onClose={onClose} title="Nouveau template" size="lg">
      <div className="space-y-5 max-h-[72vh] overflow-y-auto pr-1">

        {error && (
          <div className="flex items-start gap-2 bg-severity-critical/10 border border-severity-critical/20 rounded-lg px-4 py-3">
            <AlertCircle size={14} className="text-severity-critical mt-0.5 shrink-0" />
            <p className="text-xs text-severity-critical font-mono leading-relaxed">{error}</p>
          </div>
        )}

        {/* ── Métadonnées ───────────────────────────────────────────────────── */}
        <div className="space-y-3">
          <p className="text-[10px] font-semibold tracking-widest uppercase text-accent-muted/40">Métadonnées</p>

          <div>
            <label className="label">Nom *</label>
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
              placeholder="Template générique pour les incidents ransomware"
              value={form.description}
              onChange={e => setForm(f => ({ ...f, description: e.target.value }))}
            />
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="label">Catégorie</label>
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
          <p className="text-[10px] font-semibold tracking-widest uppercase text-accent-muted/40">
            Executive Summary — modèle initial
          </p>
          <textarea
            className="input font-mono text-xs resize-y"
            style={{ minHeight: 80 }}
            value={form.executive_summary_template}
            onChange={e => setForm(f => ({ ...f, executive_summary_template: e.target.value }))}
            placeholder="On [DATE], [ORGANISATION] identified…"
          />
        </div>

        {/* ── Report sections ───────────────────────────────────────────────── */}
        <div className="space-y-2">
          <div className="flex items-center justify-between">
            <p className="text-[10px] font-semibold tracking-widest uppercase text-accent-muted/40">
              Sections du rapport
              <span className="ml-2 text-accent-green/60">{form.sections.length}</span>
            </p>
            <button
              onClick={addSection}
              className="flex items-center gap-1 text-[10px] px-2 py-1 rounded border border-accent-green/20 text-accent-green/70 hover:bg-accent-green/10 transition-colors"
            >
              <Plus size={10} /> Ajouter section
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
              <p className="text-[10px] text-accent-muted/30 italic text-center py-4">
                Aucune section — le rapport sera vide par défaut.
              </p>
            )}
          </div>
        </div>
      </div>

      {/* ── Actions ───────────────────────────────────────────────────────────── */}
      <div className="flex justify-end gap-3 pt-4 border-t border-white/5 mt-4">
        <button className="btn-secondary flex items-center gap-1.5" onClick={onClose}>
          <X size={13} /> Annuler
        </button>
        <button
          className="btn-primary flex items-center gap-1.5"
          onClick={handleSave}
          disabled={isSaving || !form.name.trim()}
        >
          <Save size={13} />
          {isSaving ? 'Création…' : 'Créer le template'}
        </button>
      </div>
    </Modal>
  )
}
