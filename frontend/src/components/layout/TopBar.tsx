import { useState, useRef, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { FolderOpen, X, ChevronRight, Plus, Clock, Building2 } from '../../ui/icons'
import { useCurrentCase } from '../../context/CurrentCaseContext'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { incidentLogApi } from '../../api/incidentLog'
import type { IncidentLogCategory } from '../../types'

const CATEGORY_OPTIONS: { value: IncidentLogCategory; label: string }[] = [
  { value: 'remediation',   label: 'Remediation' },
  { value: 'handover',      label: 'Passation' },
  { value: 'communication', label: 'Communication client' },
  { value: 'investigation', label: 'Investigation' },
  { value: 'other',         label: 'Autre' },
]

function QuickTimelineModal({ caseId, onClose }: { caseId: string; onClose: () => void }) {
  const qc = useQueryClient()
  const overlayRef = useRef<HTMLDivElement>(null)

  const now = new Date()
  const defaultTs = now.toISOString().slice(0, 16)  // "YYYY-MM-DDTHH:mm" UTC

  const [title, setTitle]       = useState('')
  const [ts, setTs]             = useState(defaultTs)
  const [desc, setDesc]         = useState('')
  const [category, setCategory] = useState<IncidentLogCategory>('remediation')
  const [actor, setActor]       = useState('')

  const create = useMutation({
    // Dual-write, handled server-side: creates a TimelineEvent AND an
    // IncidentLogEntry (exportable to .md for client handoffs).
    mutationFn: () => incidentLogApi.create(caseId, {
      title: title.trim(),
      event_ts: ts + ':00.000Z',
      description: desc.trim(),
      actor: actor.trim(),
      category,
    }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['timeline', caseId] })
      qc.invalidateQueries({ queryKey: ['incidentLog', caseId] })
      onClose()
    },
  })

  // Close on Escape
  useEffect(() => {
    const handler = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [onClose])

  // Close on backdrop click
  function handleOverlayClick(e: React.MouseEvent) {
    if (e.target === overlayRef.current) onClose()
  }

  return (
    <div
      ref={overlayRef}
      onClick={handleOverlayClick}
      className="fixed inset-0 z-50 flex items-start justify-center pt-24 bg-black/40 backdrop-blur-sm"
    >
      <div className="w-full max-w-md bg-[#0d1927] border border-white/15 rounded-xl shadow-2xl p-5">
        {/* Header */}
        <div className="flex items-center gap-2 mb-4">
          <Clock size={14} className="text-accent-green shrink-0" />
          <h3 className="text-sm font-semibold text-white flex-1">Incident log - new event</h3>
          <button onClick={onClose} className="text-gray-500 hover:text-white transition-colors p-1">
            <X size={14} />
          </button>
        </div>

        <div className="space-y-3">
          {/* Category */}
          <div>
            <label className="block text-[10px] text-gray-500 uppercase tracking-wide mb-1">
              Category
            </label>
            <div className="flex flex-wrap gap-1.5">
              {CATEGORY_OPTIONS.map(opt => (
                <button
                  key={opt.value}
                  type="button"
                  onClick={() => setCategory(opt.value)}
                  className={`text-[11px] px-2.5 py-1 rounded-full border transition-colors ${
                    category === opt.value
                      ? 'border-accent-green/50 bg-accent-green/10 text-accent-green'
                      : 'border-white/10 text-gray-500 hover:text-white hover:border-white/20'
                  }`}
                >
                  {opt.label}
                </button>
              ))}
            </div>
          </div>

          {/* Title */}
          <div>
            <label className="block text-[10px] text-gray-500 uppercase tracking-wide mb-1">
              Title <span className="text-red-400">*</span>
            </label>
            <input
              autoFocus
              type="text"
              value={title}
              onChange={e => setTitle(e.target.value)}
              onKeyDown={e => { if (e.key === 'Enter' && title.trim()) create.mutate() }}
              placeholder="e.g. Remediation - compromised account reset"
              className="w-full bg-[#0a1120] border border-white/10 rounded-lg px-3 py-2 text-sm text-white placeholder-gray-600 focus:outline-none focus:border-accent-green/50"
            />
          </div>

          {/* Datetime */}
          <div>
            <label className="block text-[10px] text-gray-500 uppercase tracking-wide mb-1">
              Date / Heure (UTC)
            </label>
            <input
              type="datetime-local"
              value={ts}
              onChange={e => setTs(e.target.value)}
              className="w-full bg-[#0a1120] border border-white/10 rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-accent-green/50"
            />
          </div>

          {/* Actor */}
          <div>
            <label className="block text-[10px] text-gray-500 uppercase tracking-wide mb-1">
              Acteur <span className="text-gray-600">(optionnel)</span>
            </label>
            <input
              type="text"
              value={actor}
              onChange={e => setActor(e.target.value)}
              placeholder="Analyste, client, tiers…"
              className="w-full bg-[#0a1120] border border-white/10 rounded-lg px-3 py-2 text-sm text-white placeholder-gray-600 focus:outline-none focus:border-accent-green/50"
            />
          </div>

          {/* Description */}
          <div>
            <label className="block text-[10px] text-gray-500 uppercase tracking-wide mb-1">
              Description <span className="text-gray-600">(optionnel)</span>
            </label>
            <textarea
              value={desc}
              onChange={e => setDesc(e.target.value)}
              rows={2}
              placeholder="Details of the action..."
              className="w-full bg-[#0a1120] border border-white/10 rounded-lg px-3 py-2 text-sm text-white placeholder-gray-600 focus:outline-none focus:border-accent-green/50 resize-none"
            />
          </div>
        </div>

        {/* Actions */}
        <div className="flex items-center justify-end gap-2 mt-4">
          <button
            onClick={onClose}
            className="px-3 py-1.5 text-xs text-gray-400 hover:text-white transition-colors"
          >
            Cancel
          </button>
          <button
            onClick={() => create.mutate()}
            disabled={!title.trim() || create.isPending}
            className="btn-primary text-xs px-4 py-1.5 flex items-center gap-1.5 disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {create.isPending ? (
              <span className="inline-block w-3 h-3 border-2 border-white/30 border-t-white rounded-full animate-spin" />
            ) : (
              <Plus size={12} />
            )}
            Add to the incident log
          </button>
        </div>

        {create.isError && (
          <p className="text-red-400 text-xs mt-2">{String(create.error)}</p>
        )}
      </div>
    </div>
  )
}

export default function TopBar() {
  const { currentCase, clearCurrentCase } = useCurrentCase()
  const navigate = useNavigate()
  const [showModal, setShowModal] = useState(false)

  if (!currentCase) return null

  return (
    <>
      <div className="h-9 border-b border-white/5 bg-bg-secondary/60 backdrop-blur-sm px-4 flex items-center justify-between shrink-0">
        {/* Left — breadcrumb hint */}
        <div className="flex items-center gap-1.5 text-[11px] text-accent-muted/50">
          <span>Current case</span>
          <ChevronRight size={10} />
        </div>

        {/* Center — case pill */}
        <button
          onClick={() => navigate(`/cases/${currentCase.id}`)}
          className="flex items-center gap-2 px-3 py-1 rounded-full border border-accent-green/25
                     bg-accent-green/5 hover:bg-accent-green/10 hover:border-accent-green/50
                     text-accent-green text-xs font-medium transition-all group max-w-xs"
        >
          <FolderOpen size={12} className="shrink-0" />
          <span className="truncate">{currentCase.title}</span>
        </button>

        {/* Right — client docs + quick event + clear */}
        <div className="flex items-center gap-1">
          {currentCase.client_id && (
            <button
              onClick={() => navigate(`/config/clients/${currentCase.client_id}`)}
              title="Go to this case's client documentation"
              className="flex items-center gap-1 text-[11px] text-accent-muted/50 hover:text-accent-green transition-colors px-1.5 py-1 rounded hover:bg-accent-green/5"
            >
              <Building2 size={12} />
              <span className="hidden sm:inline">Client</span>
            </button>
          )}
          <button
            onClick={() => setShowModal(true)}
            title="Add an event to the incident log (dual-written to the timeline)"
            className="flex items-center gap-1 text-[11px] text-accent-muted/50 hover:text-accent-green transition-colors px-1.5 py-1 rounded hover:bg-accent-green/5"
          >
            <Plus size={12} />
            <span className="hidden sm:inline">Incident log</span>
          </button>
          <button
            onClick={clearCurrentCase}
            title="Quitter ce case"
            className="text-accent-muted/40 hover:text-accent-muted transition-colors p-1 rounded"
          >
            <X size={12} />
          </button>
        </div>
      </div>

      {showModal && (
        <QuickTimelineModal caseId={currentCase.id} onClose={() => setShowModal(false)} />
      )}
    </>
  )
}
