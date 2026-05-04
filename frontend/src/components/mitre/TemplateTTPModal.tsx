/**
 * TemplateTTPModal — visual MITRE ATT&CK TTP picker for case templates.
 *
 * Opens a full-screen modal with:
 *  - Left: MitreMatrixPicker (interactive technique matrix)
 *  - Right: selected TTP list grouped by tactic with remove buttons
 *
 * On save, calls PUT /templates/{id}/ttps with the serialised TTP list.
 * The backend injects / replaces the `ttp_definitions` block in the YAML.
 */
import { useState, useMemo, useCallback } from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { X, Shield, ExternalLink, Save, Loader2 } from 'lucide-react'
import MitreMatrixPicker from './MitreMatrixPicker'
import { type Technique, type SubTechnique, type Tactic } from '../../api/mitre'
import { templatesApi } from '../../api/templates'
import type { Template } from '../../types'

// ── Internal types ────────────────────────────────────────────────────────────

interface TTPDef {
  technique_id:   string
  technique_name: string
  tactic:         string
  tactic_name:    string
}

// ── Right panel ───────────────────────────────────────────────────────────────

function SelectedPanel({
  selected,
  onRemove,
}: {
  selected: Map<string, TTPDef>   // key = "tech_id|tactic"
  onRemove: (key: string) => void
}) {
  const byTactic = useMemo(() => {
    const map = new Map<string, Array<{ key: string; def: TTPDef }>>()
    for (const [key, def] of selected.entries()) {
      const tact = def.tactic_name || def.tactic || 'Unknown'
      if (!map.has(tact)) map.set(tact, [])
      map.get(tact)!.push({ key, def })
    }
    map.forEach(v => v.sort((a, b) =>
      a.def.technique_id.localeCompare(b.def.technique_id)
    ))
    return map
  }, [selected])

  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <div className="shrink-0 px-3 py-2.5 border-b border-white/5 flex items-center gap-2">
        <Shield size={11} className="text-accent-green/70" />
        <span className="text-[10px] font-semibold uppercase tracking-widest text-accent-muted/60 flex-1">
          Selected TTPs
        </span>
        <span className="text-[10px] font-mono text-accent-green/70">
          {selected.size}
        </span>
      </div>

      {/* List */}
      <div className="flex-1 overflow-y-auto divide-y divide-white/5">
        {selected.size === 0 && (
          <p className="px-3 py-6 text-[11px] italic text-accent-muted/30 text-center">
            Click any technique in the matrix to add it
          </p>
        )}
        {[...byTactic.entries()].map(([tacticName, entries]) => (
          <div key={tacticName}>
            <p className="px-3 pt-2 pb-0.5 text-[8px] uppercase tracking-widest text-accent-muted/30 font-semibold">
              {tacticName}
            </p>
            {entries.map(({ key, def }) => (
              <div
                key={key}
                className="flex items-center gap-1.5 px-3 py-1 group hover:bg-white/[0.02]"
              >
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-1.5">
                    <span className="text-[9px] font-mono text-accent-green/70 shrink-0">
                      {def.technique_id}
                    </span>
                    <a
                      href={`https://attack.mitre.org/techniques/${def.technique_id.replace('.', '/')}/`}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="opacity-0 group-hover:opacity-50 hover:!opacity-100 transition-opacity shrink-0"
                    >
                      <ExternalLink size={8} />
                    </a>
                  </div>
                  <p className="text-[9px] text-white/60 truncate leading-tight">
                    {def.technique_name}
                  </p>
                </div>
                <button
                  onClick={() => onRemove(key)}
                  className="shrink-0 opacity-0 group-hover:opacity-100 text-white/20 hover:text-severity-critical transition-all"
                >
                  <X size={10} />
                </button>
              </div>
            ))}
          </div>
        ))}
      </div>
    </div>
  )
}

// ── TemplateTTPModal ──────────────────────────────────────────────────────────

interface Props {
  template: Template
  onClose:  () => void
  onSaved:  () => void
}

export default function TemplateTTPModal({ template, onClose, onSaved }: Props) {
  const qc = useQueryClient()

  // Initialise selectedMap from template.ttp_definitions
  const [selectedMap, setSelectedMap] = useState<Map<string, TTPDef>>(() => {
    const map = new Map<string, TTPDef>()
    const defs = (template as any).ttp_definitions as TTPDef[] | undefined
    if (Array.isArray(defs)) {
      for (const d of defs) {
        const key = `${d.technique_id}|${d.tactic}`
        map.set(key, d)
      }
    }
    return map
  })

  // Derived selectedKeys set for MitreMatrixPicker
  const selectedKeys = useMemo(
    () => new Set(selectedMap.keys()),
    [selectedMap],
  )

  // Toggle handler
  const handleToggle = useCallback((
    tech:   Technique | SubTechnique,
    tactic: Tactic,
  ) => {
    const key = `${tech.id}|${tactic.short_name}`
    setSelectedMap(prev => {
      const next = new Map(prev)
      if (next.has(key)) {
        next.delete(key)
      } else {
        next.set(key, {
          technique_id:   tech.id,
          technique_name: tech.name,
          tactic:         tactic.short_name,
          tactic_name:    tactic.name,
        })
      }
      return next
    })
  }, [])

  // Save mutation
  const saveMut = useMutation({
    mutationFn: () =>
      templatesApi.updateTTPs(template.id, [...selectedMap.values()]),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['templates'] })
      onSaved()
    },
  })

  return (
    /* Full-screen overlay */
    <div className="fixed inset-0 z-50 flex flex-col bg-bg-primary">

      {/* ── Modal header ──────────────────────────────────────────────────── */}
      <div className="shrink-0 flex items-center gap-3 px-5 py-3.5 border-b border-white/8 bg-bg-secondary">
        <Shield size={15} className="text-accent-green shrink-0" />
        <div className="flex-1 min-w-0">
          <p className="text-sm font-semibold text-white truncate">
            MITRE ATT&amp;CK — {template.name}
          </p>
          <p className="text-[10px] text-accent-muted/40">
            Select techniques to pre-populate when a case is created from this template
          </p>
        </div>

        <div className="flex items-center gap-2 shrink-0">
          <span className="text-[10px] text-accent-muted/50 font-mono">
            {selectedMap.size} technique{selectedMap.size !== 1 ? 's' : ''}
          </span>
          <button
            onClick={() => saveMut.mutate()}
            disabled={saveMut.isPending}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded border border-accent-green/40 text-accent-green text-xs font-medium hover:bg-accent-green/10 disabled:opacity-50 disabled:pointer-events-none transition-colors"
          >
            {saveMut.isPending
              ? <><Loader2 size={12} className="animate-spin" /> Saving…</>
              : <><Save size={12} /> Save TTPs</>
            }
          </button>
          <button
            onClick={onClose}
            className="text-accent-muted/40 hover:text-white transition-colors p-1"
          >
            <X size={16} />
          </button>
        </div>
      </div>

      {/* ── Body: matrix + right panel ────────────────────────────────────── */}
      <div className="flex-1 flex overflow-hidden min-h-0">

        {/* Matrix */}
        <div className="flex-1 overflow-hidden min-w-0">
          <MitreMatrixPicker
            selectedKeys={selectedKeys}
            onToggle={handleToggle}
          />
        </div>

        {/* Right panel */}
        <div className="w-60 shrink-0 border-l border-white/5 bg-bg-secondary flex flex-col">
          <SelectedPanel
            selected={selectedMap}
            onRemove={key =>
              setSelectedMap(prev => { const n = new Map(prev); n.delete(key); return n })
            }
          />
        </div>
      </div>

      {/* ── Save error ────────────────────────────────────────────────────── */}
      {saveMut.isError && (
        <div className="shrink-0 px-5 py-2.5 bg-severity-critical/10 border-t border-severity-critical/20 text-xs text-severity-critical font-mono">
          Save failed — {(saveMut.error as any)?.response?.data?.detail ?? 'Unknown error'}
        </div>
      )}
    </div>
  )
}
