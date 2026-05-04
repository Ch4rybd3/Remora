import { useMemo, useRef, useCallback } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import {
  Shield, Download, RefreshCw, ExternalLink, X,
  Upload, FileJson,
} from 'lucide-react'
import { mitreApi, type MitreTTP, type Technique, type SubTechnique, type Tactic } from '../../../api/mitre'
import MitreMatrixPicker from '../../mitre/MitreMatrixPicker'

interface Props { caseId: string }

// ── Download / status screen ──────────────────────────────────────────────────

function DownloadPrompt({ onDownload, state }: { onDownload: () => void; state: string }) {
  return (
    <div className="h-full flex flex-col items-center justify-center gap-4 text-center px-8">
      <Shield size={48} className="opacity-10" />
      <div>
        <p className="text-sm text-white/60 font-medium mb-1">
          {state === 'downloading' ? 'Downloading ATT&CK data…' : 'ATT&CK data not available'}
        </p>
        <p className="text-xs text-accent-muted/40 max-w-sm">
          {state === 'downloading'
            ? 'The Enterprise ATT&CK STIX bundle is being downloaded and processed. This takes ~30 seconds. Refresh to check.'
            : 'Download the MITRE ATT&CK Enterprise technique tree to enable the matrix. The data is fetched once and cached locally.'}
        </p>
      </div>
      {state !== 'downloading' && (
        <button
          onClick={onDownload}
          className="flex items-center gap-2 px-4 py-2 rounded border border-accent-green/40 text-accent-green text-sm hover:bg-accent-green/10 transition-colors"
        >
          <Download size={14} />
          Download ATT&CK Enterprise (~30 MB, one-time)
        </button>
      )}
      {state === 'downloading' && (
        <RefreshCw size={18} className="animate-spin text-accent-muted/40" />
      )}
    </div>
  )
}

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
      <div className="shrink-0 px-3 py-2.5 border-b border-white/5 flex items-center gap-2">
        <Shield size={11} className="text-accent-green/70" />
        <span className="text-[10px] font-semibold uppercase tracking-widest text-accent-muted/60 flex-1">
          Selected TTPs
        </span>
        <span className="text-[10px] font-mono text-accent-green/70">
          {ttps.length}
        </span>
      </div>

      {/* TTP list grouped by tactic */}
      <div className="flex-1 overflow-y-auto divide-y divide-white/5">
        {ttps.length === 0 && (
          <p className="px-3 py-6 text-[11px] italic text-accent-muted/30 text-center">
            Click any technique in the matrix to add it
          </p>
        )}
        {[...byTactic.entries()].map(([tacticName, techList]) => (
          <div key={tacticName}>
            <p className="px-3 pt-2 pb-0.5 text-[8px] uppercase tracking-widest text-accent-muted/30 font-semibold">
              {tacticName}
            </p>
            {techList.map(ttp => (
              <div key={ttp.id} className="flex items-center gap-1.5 px-3 py-1 group hover:bg-white/[0.02]">
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-1.5">
                    <span className="text-[9px] font-mono text-accent-green/70 shrink-0">{ttp.technique_id}</span>
                    <a
                      href={`https://attack.mitre.org/techniques/${ttp.technique_id.replace('.', '/')}/`}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="opacity-0 group-hover:opacity-50 hover:!opacity-100 transition-opacity shrink-0"
                    >
                      <ExternalLink size={8} />
                    </a>
                  </div>
                  <p className="text-[9px] text-white/60 truncate leading-tight">{ttp.technique_name}</p>
                </div>
                <button
                  onClick={() => onRemove(ttp)}
                  className="shrink-0 opacity-0 group-hover:opacity-100 text-white/20 hover:text-severity-critical transition-all"
                >
                  <X size={10} />
                </button>
              </div>
            ))}
          </div>
        ))}
      </div>

      {/* Footer actions */}
      <div className="shrink-0 px-3 py-2.5 border-t border-white/5 space-y-1.5">
        <button
          onClick={onExport}
          disabled={ttps.length === 0}
          className="w-full flex items-center justify-center gap-1.5 py-1.5 rounded border border-white/10 text-accent-muted/50 text-[10px] hover:border-accent-green/30 hover:text-accent-green hover:bg-accent-green/5 disabled:opacity-30 disabled:pointer-events-none transition-colors"
        >
          <FileJson size={10} />
          Export Navigator layer
        </button>
        <button
          onClick={() => fileRef.current?.click()}
          className="w-full flex items-center justify-center gap-1.5 py-1.5 rounded border border-white/10 text-accent-muted/50 text-[10px] hover:border-white/20 hover:text-white transition-colors"
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

  // ── Data queries ─────────────────────────────────────────────────────────

  const { data: mitreStatus, refetch: refetchStatus } = useQuery({
    queryKey:        ['mitre-status'],
    queryFn:         mitreApi.status,
    refetchInterval: (q) =>
      q.state.data?.state === 'downloading' ? 3000 : false,
  })

  const { data: caseTTPs = [] } = useQuery({
    queryKey: ['mitre-ttps', caseId],
    queryFn:  () => mitreApi.listTTPs(caseId),
  })

  // ── Mutations ─────────────────────────────────────────────────────────────

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

  const downloadMut = useMutation({
    mutationFn: mitreApi.download,
    onSuccess:  () => { setTimeout(() => refetchStatus(), 1000) },
  })

  // ── Derived state ─────────────────────────────────────────────────────────

  const selectedKeys = useMemo(
    () => new Set(caseTTPs.map(t => `${t.technique_id}|${t.tactic ?? ''}`)),
    [caseTTPs],
  )

  // ── Toggle handler ────────────────────────────────────────────────────────

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

  // ── Export layer ──────────────────────────────────────────────────────────

  const handleExport = async () => {
    const layer = await mitreApi.exportLayer(caseId)
    const blob  = new Blob([JSON.stringify(layer, null, 2)], { type: 'application/json' })
    const a     = document.createElement('a')
    a.href      = URL.createObjectURL(blob)
    a.download  = `remora_case_${caseId.slice(0, 8)}_layer.json`
    a.click()
    URL.revokeObjectURL(a.href)
  }

  // ── Render ────────────────────────────────────────────────────────────────

  if (!mitreStatus?.available) {
    return (
      <DownloadPrompt
        state={mitreStatus?.state ?? 'not_downloaded'}
        onDownload={() => downloadMut.mutate()}
      />
    )
  }

  return (
    <div className="flex h-full overflow-hidden">

      {/* ── Center: shared matrix picker ────────────────────────────────── */}
      <div className="flex-1 overflow-hidden min-w-0">
        <MitreMatrixPicker
          selectedKeys={selectedKeys}
          onToggle={handleToggle}
        />
      </div>

      {/* ── Right: selection panel ───────────────────────────────────────── */}
      <div className="w-56 shrink-0 border-l border-white/5 bg-bg-secondary flex flex-col">
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
