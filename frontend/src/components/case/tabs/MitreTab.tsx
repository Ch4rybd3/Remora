import { useMemo, useRef, useCallback } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { Shield, ExternalLink, X, Upload, FileJson } from '../../../ui/icons'
import { mitreApi, type MitreTTP, type Technique, type SubTechnique, type Tactic } from '../../../api/mitre'
import MitreMatrixPicker from '../../mitre/MitreMatrixPicker'

interface Props { caseId: string }

// ── Right selection panel ─────────────────────────────────────────────────────

function SelectionPanel({
  ttps,
  onRemove,
  onExport,
  onImportLayer,
}: {
  ttps:          MitreTTP[]
  onRemove:      (ttp: MitreTTP) => void
  onExport:      () => void
  onImportLayer: (layer: object) => void
}) {
  const fileRef = useRef<HTMLInputElement>(null)

  const byTactic = useMemo(() => {
    const map = new Map<string, MitreTTP[]>()
    for (const t of ttps) {
      const key = t.tactic_name || t.tactic || 'Unknown'
      if (!map.has(key)) map.set(key, [])
      map.get(key)!.push(t)
    }
    map.forEach(v => v.sort((a, b) => a.technique_id.localeCompare(b.technique_id)))
    return map
  }, [ttps])

  const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file) return
    try {
      const text = await file.text()
      const layer = JSON.parse(text)
      onImportLayer(layer)
    } catch {
      alert('Invalid JSON layer file')
    }
    e.target.value = ''
  }

  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <div className="shrink-0 px-3 py-2.5 border-b border-hairline flex items-center gap-2">
        <Shield size={11} className="text-accent/70" />
        <span className="text-label font-semibold uppercase tracking-widest text-fg-secondary/60 flex-1">
          Selected TTPs
        </span>
        <span className="text-label font-mono text-accent/70">
          {ttps.length}
        </span>
      </div>

      {/* TTP list grouped by tactic */}
      <div className="flex-1 overflow-y-auto divide-y divide-hairline">
        {ttps.length === 0 && (
          <p className="px-3 py-6 text-label italic text-fg-secondary/30 text-center">
            Click any technique in the matrix to add it
          </p>
        )}
        {[...byTactic.entries()].map(([tacticName, techList]) => (
          <div key={tacticName}>
            <p className="px-3 pt-2 pb-0.5 text-label uppercase tracking-widest text-fg-secondary/30 font-semibold">
              {tacticName}
            </p>
            {techList.map(ttp => (
              <div key={ttp.id} className="flex items-center gap-1.5 px-3 py-1 group hover:bg-white/[0.02]">
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-1.5">
                    <span className="text-label font-mono text-accent/70 shrink-0">{ttp.technique_id}</span>
                    <a
                      href={`https://attack.mitre.org/techniques/${ttp.technique_id.replace('.', '/')}/`}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="opacity-0 group-hover:opacity-50 hover:!opacity-100 transition-opacity shrink-0"
                    >
                      <ExternalLink size={8} />
                    </a>
                  </div>
                  <p className="text-label text-fg/60 truncate leading-tight">{ttp.technique_name}</p>
                </div>
                <button
                  onClick={() => onRemove(ttp)}
                  className="shrink-0 opacity-0 group-hover:opacity-100 text-fg/20 hover:text-severity-critical transition-all"
                >
                  <X size={10} />
                </button>
              </div>
            ))}
          </div>
        ))}
      </div>

      {/* Footer actions */}
      <div className="shrink-0 px-3 py-2.5 border-t border-hairline space-y-1.5">
        <button
          onClick={onExport}
          disabled={ttps.length === 0}
          className="w-full flex items-center justify-center gap-1.5 py-1.5 rounded-control border border-hairline text-fg-secondary/50 text-label hover:border-accent/30 hover:text-accent hover:bg-accent/5 disabled:opacity-30 disabled:pointer-events-none transition-colors"
        >
          <FileJson size={10} />
          Export Navigator layer
        </button>
        <button
          onClick={() => fileRef.current?.click()}
          className="w-full flex items-center justify-center gap-1.5 py-1.5 rounded-control border border-hairline text-fg-secondary/50 text-label hover:border-strong hover:text-fg transition-colors"
        >
          <Upload size={10} />
          Import Navigator layer
        </button>
        <input ref={fileRef} type="file" accept=".json" className="hidden" onChange={handleFileChange} />
      </div>
    </div>
  )
}

// ── Main MitreTab ─────────────────────────────────────────────────────────────

export default function MitreTab({ caseId }: Props) {
  const qc = useQueryClient()

  const { data: caseTTPs = [] } = useQuery({
    queryKey: ['mitre-ttps', caseId],
    queryFn:  () => mitreApi.listTTPs(caseId),
  })

  const addTTP = useMutation({
    mutationFn: (data: Parameters<typeof mitreApi.addTTP>[1]) =>
      mitreApi.addTTP(caseId, data),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['mitre-ttps', caseId] }),
  })

  const delTTP = useMutation({
    mutationFn: (ttpId: string) => mitreApi.deleteTTP(caseId, ttpId),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['mitre-ttps', caseId] }),
  })

  const importLayerMut = useMutation({
    mutationFn: (layer: object) => mitreApi.importLayer(caseId, layer),
    onSuccess: (data) => {
      qc.invalidateQueries({ queryKey: ['mitre-ttps', caseId] })
      if (data.added > 0) alert(`Imported ${data.added} technique(s) from layer.`)
    },
  })

  const selectedKeys = useMemo(
    () => new Set(caseTTPs.map(t => `${t.technique_id}|${t.tactic ?? ''}`)),
    [caseTTPs],
  )

  const handleToggle = useCallback((
    tech:   Technique | SubTechnique,
    tactic: Tactic,
  ) => {
    const key = `${tech.id}|${tactic.short_name}`
    if (selectedKeys.has(key)) {
      const existing = caseTTPs.find(
        t => t.technique_id === tech.id && t.tactic === tactic.short_name,
      )
      if (existing) delTTP.mutate(existing.id)
    } else {
      addTTP.mutate({
        technique_id:   tech.id,
        technique_name: tech.name,
        tactic:         tactic.short_name,
        tactic_name:    tactic.name,
      })
    }
  }, [selectedKeys, caseTTPs, addTTP, delTTP])

  const handleExport = async () => {
    const layer = await mitreApi.exportLayer(caseId)
    const blob  = new Blob([JSON.stringify(layer, null, 2)], { type: 'application/json' })
    const a     = document.createElement('a')
    a.href      = URL.createObjectURL(blob)
    a.download  = `remora_case_${caseId.slice(0, 8)}_layer.json`
    a.click()
    URL.revokeObjectURL(a.href)
  }

  return (
    <div className="flex h-full overflow-hidden">

      {/* Matrix — MitreMatrixPicker handles download state itself */}
      <div className="flex-1 overflow-hidden min-w-0">
        <MitreMatrixPicker
          selectedKeys={selectedKeys}
          onToggle={handleToggle}
        />
      </div>

      {/* Right: selection panel */}
      <div className="w-56 shrink-0 border-l border-hairline bg-panel flex flex-col">
        <SelectionPanel
          ttps={caseTTPs}
          onRemove={ttp => delTTP.mutate(ttp.id)}
          onExport={handleExport}
          onImportLayer={layer => importLayerMut.mutate(layer)}
        />
      </div>
    </div>
  )
}
