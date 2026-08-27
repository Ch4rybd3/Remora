import { useState, useCallback, useEffect, useRef, useMemo } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import {
  Swords, ScanSearch, AlertTriangle, CheckCircle2,
  ChevronDown, ChevronRight, BookmarkPlus, Trash2,
  Send, X, Clock, RefreshCw, Filter,
} from '../../ui/icons'
import { evtxApi } from '../../api/evtx'
import { chainsawApi, type ChainsawScan, type ChainsawAlert, type PinnedChainsawAlert } from '../../api/chainsaw'
import { fmtDateTime, fmtDateTimeShort } from '../../utils/dateUtils'

interface Props { caseId: string }

// ── Level helpers ─────────────────────────────────────────────────────────────

const LEVEL_ORDER = ['critical', 'high', 'medium', 'low', 'informational']

const LEVEL_COLOR: Record<string, string> = {
  critical:      'text-severity-critical bg-severity-critical/10 border-severity-critical/30',
  high:          'text-orange-400 bg-orange-400/10 border-orange-400/30',
  medium:        'text-severity-medium bg-severity-medium/10 border-severity-medium/30',
  low:           'text-blue-400 bg-blue-400/10 border-blue-400/30',
  informational: 'text-accent-muted bg-white/5 border-white/10',
}

const LEVEL_DOT: Record<string, string> = {
  critical:      'bg-severity-critical',
  high:          'bg-orange-400',
  medium:        'bg-severity-medium',
  low:           'bg-blue-400',
  informational: 'bg-accent-muted',
}

function LevelBadge({ level }: { level: string | null }) {
  const l = (level || 'informational').toLowerCase()
  return (
    <span className={`inline-flex items-center px-1.5 py-0.5 rounded border text-[9px] font-bold uppercase tracking-wider ${LEVEL_COLOR[l] ?? LEVEL_COLOR.informational}`}>
      {l}
    </span>
  )
}

// ── Scan status badge ─────────────────────────────────────────────────────────

function ScanStatusBadge({ status }: { status: ChainsawScan['status'] }) {
  if (status === 'scanning' || status === 'pending')
    return <RefreshCw size={10} className="animate-spin text-accent-muted/60" />
  if (status === 'ready')
    return <CheckCircle2 size={10} className="text-accent-green" />
  if (status === 'error')
    return <AlertTriangle size={10} className="text-severity-critical" />
  return null
}

// ── File panel ────────────────────────────────────────────────────────────────

function FileScanPanel({
  caseId,
  scans,
  selectedFileId,
  onSelectFile,
  onScanStarted,
}: {
  caseId: string
  scans: ChainsawScan[]
  selectedFileId: string | null
  onSelectFile: (fileId: string | null) => void
  onScanStarted: () => void
}) {
  const qc = useQueryClient()

  const { data: files = [] } = useQuery({
    queryKey: ['evtx-files', caseId],
    queryFn:  () => evtxApi.listFiles(caseId),
  })

  const scanMap = useMemo(
    () => new Map(scans.map(s => [s.file_id, s])),
    [scans],
  )

  const startScan = useMutation({
    mutationFn: (fileId: string) => chainsawApi.startScan(caseId, fileId),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['chainsaw-scans', caseId] })
      onScanStarted()
    },
  })

  const deleteScan = useMutation({
    mutationFn: (scanId: string) => chainsawApi.deleteScan(caseId, scanId),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['chainsaw-scans', caseId] }),
  })

  // Poll while any scan is in progress — invalidate parent query on fresh data
  const hasBusy = scans.some(s => s.status === 'scanning' || s.status === 'pending')
  useQuery({
    queryKey: ['chainsaw-scans-poll', caseId],
    queryFn:  async () => {
      const fresh = await chainsawApi.listScans(caseId)
      qc.setQueryData(['chainsaw-scans', caseId], fresh)
      return fresh
    },
    refetchInterval: hasBusy ? 2000 : false,
    enabled: hasBusy,
  })

  const readyFiles = files.filter(f => f.status === 'ready')

  return (
    <div className="flex-1 overflow-y-auto py-2">
      {readyFiles.length === 0 && (
        <p className="px-3 py-3 text-[11px] italic text-accent-muted/30">
          No parsed EVTX files in this case
        </p>
      )}
      {readyFiles.map(f => {
        const scan = scanMap.get(f.id)
        const busy = scan?.status === 'scanning' || scan?.status === 'pending'
        const isScanning = startScan.isPending && (startScan.variables as string) === f.id
        const isSelected = selectedFileId === f.id
        return (
          <div
            key={f.id}
            className={`px-3 py-2.5 border-b border-white/5 last:border-0 cursor-pointer transition-colors ${
              isSelected ? 'bg-accent-green/5 border-l-2 border-l-accent-green/40' : 'hover:bg-white/[0.02]'
            }`}
            onClick={() => onSelectFile(isSelected ? null : f.id)}
          >
            <p className="text-[11px] font-medium text-white/90 truncate leading-tight mb-1" title={f.filename}>
              {f.filename}
            </p>
            {scan ? (
              <div className="flex items-center gap-1.5">
                <ScanStatusBadge status={scan.status} />
                {scan.status === 'ready' && (
                  <span className="text-[10px] text-accent-green/80 font-mono">
                    {scan.alert_count ?? 0} alert{(scan.alert_count ?? 0) !== 1 ? 's' : ''}
                  </span>
                )}
                {scan.status === 'error' && (
                  <span
                    className="text-[10px] text-severity-critical/80 flex-1 leading-tight cursor-help"
                    title={scan.error_msg ?? ''}
                  >
                    {scan.error_msg?.slice(0, 80)}{(scan.error_msg?.length ?? 0) > 80 ? '…' : ''}
                  </span>
                )}
                {(scan.status === 'ready' || scan.status === 'error') && (
                  <>
                    <button
                      onClick={e => { e.stopPropagation(); startScan.mutate(f.id) }}
                      disabled={busy || isScanning}
                      className="ml-auto text-[10px] px-2 py-0.5 rounded border border-white/10 text-accent-muted hover:text-white hover:border-white/25 disabled:opacity-40 transition-colors flex items-center gap-1"
                      title="Re-scan"
                    >
                      <RefreshCw size={9} />
                    </button>
                    <button
                      onClick={e => { e.stopPropagation(); deleteScan.mutate(scan.id) }}
                      className="text-[10px] px-1.5 py-0.5 rounded text-accent-muted/40 hover:text-severity-critical hover:bg-severity-critical/5 transition-colors"
                      title="Delete scan results"
                    >
                      <Trash2 size={9} />
                    </button>
                  </>
                )}
              </div>
            ) : (
              <button
                onClick={e => { e.stopPropagation(); startScan.mutate(f.id) }}
                disabled={isScanning}
                className="flex items-center gap-1 text-[10px] px-2 py-1 rounded border border-accent-green/30 text-accent-green/70 hover:bg-accent-green/10 disabled:opacity-50 transition-colors"
              >
                <ScanSearch size={10} />
                {isScanning ? 'Starting…' : 'Scan with Chainsaw'}
              </button>
            )}
          </div>
        )
      })}
    </div>
  )
}

// ── Alert detail row ──────────────────────────────────────────────────────────

function AlertRow({
  alert,
  pinned,
  onPin,
}: {
  alert: ChainsawAlert
  pinned: boolean
  onPin: (a: ChainsawAlert) => void
}) {
  const [open, setOpen] = useState(false)
  const ts = alert.timestamp ? new Date(alert.timestamp) : null

  return (
    <>
      <tr
        className={`border-b border-white/5 hover:bg-white/[0.03] transition-colors ${open ? 'bg-white/[0.04]' : ''}`}
      >
        {/* Pin — left column, stops propagation so row click = expand */}
        <td className="px-2 py-2 w-8" onClick={e => e.stopPropagation()}>
          <button
            onClick={() => onPin(alert)}
            className={`p-1 rounded transition-colors ${
              pinned
                ? 'text-accent-green'
                : 'text-accent-muted/30 hover:text-accent-green hover:bg-accent-green/5'
            }`}
            title={pinned ? 'Already in selection' : 'Add to selection'}
          >
            <BookmarkPlus size={11} />
          </button>
        </td>
        {/* Expand */}
        <td className="px-2 py-2 w-5 text-accent-muted/30 cursor-pointer" onClick={() => setOpen(o => !o)}>
          {open ? <ChevronDown size={11} /> : <ChevronRight size={11} />}
        </td>
        {/* Level */}
        <td className="px-2 py-2 w-28 cursor-pointer" onClick={() => setOpen(o => !o)}>
          <LevelBadge level={alert.level} />
        </td>
        {/* Timestamp */}
        <td className="px-2 py-2 w-36 text-[10px] font-mono text-accent-muted/70 whitespace-nowrap cursor-pointer" onClick={() => setOpen(o => !o)}>
          {ts ? fmtDateTime(ts.toISOString()) : '—'}
        </td>
        {/* Rule */}
        <td className="px-2 py-2 text-[11px] text-white/90 cursor-pointer" onClick={() => setOpen(o => !o)}>
          {alert.rule_name}
        </td>
        {/* Event ID */}
        <td className="px-2 py-2 w-16 text-[10px] font-mono text-accent-muted/60 text-right cursor-pointer" onClick={() => setOpen(o => !o)}>
          {alert.event_id ?? '—'}
        </td>
        {/* Channel */}
        <td className="px-2 py-2 w-32 text-[10px] text-accent-muted/60 truncate max-w-[120px] cursor-pointer" onClick={() => setOpen(o => !o)}>
          {alert.channel || '—'}
        </td>
        {/* Computer */}
        <td className="px-2 py-2 w-32 text-[10px] text-accent-muted/60 truncate max-w-[120px] cursor-pointer" onClick={() => setOpen(o => !o)}>
          {alert.computer || '—'}
        </td>
      </tr>
      {open && (
        <tr className="bg-white/[0.02]">
          <td colSpan={8} className="px-4 py-3">
            <div className="grid grid-cols-2 gap-x-8 gap-y-1 mb-3">
              {[
                ['Level',        alert.level],
                ['Status',       alert.sigma_status],
                ['Group',        alert.group_name],
                ['Event ID',     alert.event_id],
                ['Channel',      alert.channel],
                ['Computer',     alert.computer],
                ['Provider',     alert.provider],
                ['Tags',         alert.tags],
                ['Authors',      alert.authors],
              ].filter(([, v]) => v != null && v !== '').map(([k, v]) => (
                <div key={k as string} className="flex gap-2 text-[10px]">
                  <span className="text-accent-muted/40 w-20 shrink-0">{k as string}</span>
                  <span className="text-white/80 break-all">{String(v)}</span>
                </div>
              ))}
            </div>
            {alert.event_data && Object.keys(alert.event_data).length > 0 && (
              <>
                <p className="text-[9px] uppercase tracking-widest text-accent-muted/30 mb-1.5">Event Data</p>
                <div className="grid grid-cols-2 gap-x-8 gap-y-0.5">
                  {Object.entries(alert.event_data).map(([k, v]) => (
                    <div key={k} className="flex gap-2 text-[10px]">
                      <span className="text-accent-muted/50 w-36 shrink-0 truncate font-mono">{k}</span>
                      <span className="text-white/70 break-all font-mono">{v}</span>
                    </div>
                  ))}
                </div>
              </>
            )}
          </td>
        </tr>
      )}
    </>
  )
}

// ── Selection panel ───────────────────────────────────────────────────────────

function SelectionPanel({
  alerts,
  sentIds,
  caseId,
  onRemove,
  onClear,
  onSent,
}: {
  alerts:   PinnedChainsawAlert[]
  sentIds:  Set<string>
  caseId:   string
  onRemove: (id: string) => void
  onClear:  () => void
  onSent:   (id: string) => void
}) {
  const qc = useQueryClient()

  const sendOne = useMutation({
    mutationFn: (alertId: string) => chainsawApi.sendToTimeline(caseId, alertId),
    onSuccess: (_, alertId) => {
      onSent(alertId)
      qc.invalidateQueries({ queryKey: ['timeline', caseId] })
    },
  })

  const sendAll = async () => {
    for (const a of alerts) {
      if (!sentIds.has(a.id)) {
        await chainsawApi.sendToTimeline(caseId, a.id)
        onSent(a.id)
      }
    }
    qc.invalidateQueries({ queryKey: ['timeline', caseId] })
  }

  const unsent = alerts.filter(a => !sentIds.has(a.id))

  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <div className="shrink-0 px-3 py-2.5 border-b border-white/5 flex items-center gap-2">
        <BookmarkPlus size={11} className="text-accent-green/70" />
        <span className="text-[10px] font-semibold uppercase tracking-widest text-accent-muted/60 flex-1">
          Selection
        </span>
        {alerts.length > 0 && (
          <button
            onClick={onClear}
            className="text-[10px] text-accent-muted/30 hover:text-severity-critical transition-colors"
            title="Clear selection"
          >
            <X size={11} />
          </button>
        )}
      </div>

      {/* Alert list */}
      <div className="flex-1 overflow-y-auto divide-y divide-white/5">
        {alerts.length === 0 && (
          <p className="px-3 py-4 text-[11px] italic text-accent-muted/30 text-center">
            Click <BookmarkPlus size={10} className="inline mx-0.5" /> on any alert to add it here
          </p>
        )}
        {alerts.map(a => {
          const isSent = sentIds.has(a.id)
          const ts = a.timestamp ? fmtDateTimeShort(a.timestamp) : null
          return (
            <div key={a.id} className="px-3 py-2.5">
              <div className="flex items-start gap-1.5 mb-1.5">
                <div className={`w-1.5 h-1.5 rounded-full mt-1 shrink-0 ${LEVEL_DOT[(a.level || 'informational').toLowerCase()] ?? LEVEL_DOT.informational}`} />
                <p className="text-[11px] text-white/90 leading-snug flex-1 min-w-0">{a.rule_name}</p>
                <button
                  onClick={() => onRemove(a.id)}
                  className="text-accent-muted/20 hover:text-severity-critical transition-colors shrink-0"
                >
                  <X size={10} />
                </button>
              </div>
              <div className="ml-3 space-y-0.5 mb-1.5">
                {ts && <p className="text-[9px] font-mono text-accent-muted/40">{ts}</p>}
                <div className="flex items-center gap-2">
                  <LevelBadge level={a.level} />
                  {a.computer && (
                    <span className="text-[9px] text-accent-muted/40 truncate">{a.computer}</span>
                  )}
                </div>
                {a._filename && (
                  <p className="text-[9px] text-accent-muted/30 truncate">{a._filename}</p>
                )}
              </div>
              <button
                onClick={() => sendOne.mutate(a.id)}
                disabled={isSent || sendOne.isPending}
                className={`ml-3 flex items-center gap-1 text-[9px] px-2 py-0.5 rounded border transition-colors ${
                  isSent
                    ? 'border-accent-green/20 text-accent-green/50 bg-accent-green/5 cursor-default'
                    : 'border-white/10 text-accent-muted/50 hover:border-accent-green/30 hover:text-accent-green hover:bg-accent-green/5'
                } disabled:opacity-50`}
              >
                {isSent ? <CheckCircle2 size={9} /> : <Send size={9} />}
                {isSent ? 'In timeline' : '→ Timeline'}
              </button>
            </div>
          )
        })}
      </div>

      {/* Footer */}
      {unsent.length > 1 && (
        <div className="shrink-0 px-3 py-2.5 border-t border-white/5">
          <button
            onClick={sendAll}
            className="w-full flex items-center justify-center gap-1.5 py-1.5 rounded border border-accent-green/30 text-accent-green/70 text-[10px] hover:bg-accent-green/10 transition-colors"
          >
            <Send size={10} />
            Send all ({unsent.length}) → Timeline
          </button>
        </div>
      )}
    </div>
  )
}

// ── Main component ────────────────────────────────────────────────────────────

export default function ChainsawTab({ caseId }: Props) {
  const qc = useQueryClient()

  // ── Filters ─────────────────────────────────────────────────────────────
  const [search,          setSearch]          = useState('')
  const [levelFilter,     setLevelFilter]     = useState<Set<string>>(new Set())
  const [selectedFileId,  setSelectedFileId]  = useState<string | null>(null)
  const [page,            setPage]            = useState(1)
  const [sortDir,         setSortDir]         = useState<'asc' | 'desc'>('desc')

  // Debounced search
  const [debouncedSearch, setDebouncedSearch] = useState('')
  useEffect(() => {
    const t = setTimeout(() => setDebouncedSearch(search), 350)
    return () => clearTimeout(t)
  }, [search])

  // Reset page on filter change
  useEffect(() => { setPage(1) }, [debouncedSearch, levelFilter, selectedFileId])

  // ── Selection state ──────────────────────────────────────────────────────
  const [pinnedAlerts, setPinnedAlerts] = useState<PinnedChainsawAlert[]>([])
  const [sentIds,      setSentIds]      = useState<Set<string>>(new Set())
  const initialized = useRef(false)

  // Refs for flush-on-unmount
  const latestAlerts  = useRef<PinnedChainsawAlert[]>([])
  const latestSentIds = useRef<Set<string>>(new Set())
  useEffect(() => { latestAlerts.current  = pinnedAlerts }, [pinnedAlerts])
  useEffect(() => { latestSentIds.current = sentIds      }, [sentIds])

  // ── Load saved selection ─────────────────────────────────────────────────
  const { data: savedSel } = useQuery({
    queryKey: ['chainsaw-selection', caseId],
    queryFn:  () => chainsawApi.getSelection(caseId),
    staleTime: 0,
  })

  // Load pinned alert data from alert IDs
  const { data: allAlerts } = useQuery({
    queryKey: ['chainsaw-alerts-all', caseId],
    queryFn:  () => chainsawApi.listAlerts(caseId, { page_size: 500, sort_dir: 'desc' }),
  })

  const { data: evtxFiles = [] } = useQuery({
    queryKey: ['evtx-files', caseId],
    queryFn:  () => evtxApi.listFiles(caseId),
  })

  const fileNameMap = useMemo(
    () => new Map(evtxFiles.map(f => [f.id, f.filename])),
    [evtxFiles],
  )

  useEffect(() => {
    if (savedSel && allAlerts && !initialized.current) {
      initialized.current = true
      setSentIds(new Set(savedSel.sent_ids))
      if (savedSel.alert_ids.length > 0) {
        const alertById = new Map(allAlerts.items.map(a => [a.id, a]))
        const pinned = savedSel.alert_ids
          .map(id => {
            const a = alertById.get(id)
            if (!a) return null
            return { ...a, _filename: fileNameMap.get(a.file_id) ?? '' } as PinnedChainsawAlert
          })
          .filter(Boolean) as PinnedChainsawAlert[]
        if (pinned.length > 0) {
          setPinnedAlerts(pinned)
        }
      }
    }
  }, [savedSel, allAlerts, fileNameMap])

  // ── Auto-save selection ──────────────────────────────────────────────────
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const saveSel = useMutation({
    mutationFn: ({ ids, sids }: { ids: string[]; sids: string[] }) =>
      chainsawApi.saveSelection(caseId, ids, sids),
    onSuccess: data => qc.setQueryData(['chainsaw-selection', caseId], data),
  })

  const scheduleSave = useCallback((alerts: PinnedChainsawAlert[], sids: Set<string>) => {
    if (saveTimer.current) clearTimeout(saveTimer.current)
    saveTimer.current = setTimeout(() => {
      saveSel.mutate({ ids: alerts.map(a => a.id), sids: [...sids] })
    }, 600)
  }, [saveSel])

  // Flush on unmount
  useEffect(() => {
    return () => {
      if (saveTimer.current) clearTimeout(saveTimer.current)
      chainsawApi.saveSelection(
        caseId,
        latestAlerts.current.map(a => a.id),
        [...latestSentIds.current],
      ).then(d => qc.setQueryData(['chainsaw-selection', caseId], d)).catch(() => {})
    }
   
  }, [caseId])

  // ── Scans query ──────────────────────────────────────────────────────────
  const { data: scans = [] } = useQuery({
    queryKey: ['chainsaw-scans', caseId],
    queryFn:  () => chainsawApi.listScans(caseId),
  })

  // ── Alerts query ─────────────────────────────────────────────────────────
  const levelParam = levelFilter.size > 0 ? [...levelFilter].join(',') : undefined
  const { data: alertsPage, isFetching } = useQuery({
    queryKey: ['chainsaw-alerts', caseId, debouncedSearch, levelParam, selectedFileId, page, sortDir],
    queryFn:  () => chainsawApi.listAlerts(caseId, {
      search:   debouncedSearch || undefined,
      levels:   levelParam,
      file_id:  selectedFileId || undefined,
      page,
      page_size: 100,
      sort_dir: sortDir,
    }),
    placeholderData: (prev: any) => prev,
  })

  const pinnedIds = useMemo(() => new Set(pinnedAlerts.map(a => a.id)), [pinnedAlerts])

  // ── Pin / unpin / clear ──────────────────────────────────────────────────
  const handlePin = useCallback((alert: ChainsawAlert) => {
    setPinnedAlerts(prev => {
      if (prev.some(a => a.id === alert.id)) return prev
      const pinned: PinnedChainsawAlert = {
        ...alert,
        _filename: fileNameMap.get(alert.file_id) ?? '',
      }
      const next = [...prev, pinned]
      scheduleSave(next, sentIds)
      return next
    })
  }, [fileNameMap, scheduleSave, sentIds])

  const handleRemove = useCallback((id: string) => {
    setPinnedAlerts(prev => {
      const next = prev.filter(a => a.id !== id)
      setSentIds(s => {
        const ns = new Set(s)
        ns.delete(id)
        scheduleSave(next, ns)
        return ns
      })
      return next
    })
  }, [scheduleSave])

  const handleClear = useCallback(() => {
    setPinnedAlerts([])
    setSentIds(new Set())
    scheduleSave([], new Set())
  }, [scheduleSave])

  const handleSent = useCallback((id: string) => {
    setSentIds(prev => {
      const next = new Set(prev)
      next.add(id)
      saveSel.mutate({ ids: latestAlerts.current.map(a => a.id), sids: [...next] })
      return next
    })
  }, [saveSel])

  // ── Level filter toggles ─────────────────────────────────────────────────
  // Empty set = no filter = all levels shown. Clicking a level restricts to it.
  const toggleLevel = (l: string) => {
    setLevelFilter(prev => {
      const next = new Set(prev)
      if (next.has(l)) next.delete(l)
      else next.add(l)
      return next
    })
  }

  // Pinned alerts sorted chronologically for the selection panel
  const sortedPinned = useMemo(() =>
    [...pinnedAlerts].sort((a, b) => {
      const ta = a.timestamp ? new Date(a.timestamp).getTime() : 0
      const tb = b.timestamp ? new Date(b.timestamp).getTime() : 0
      return ta - tb
    }),
  [pinnedAlerts])

  const hasScans = scans.some(s => s.status === 'ready')

  // ── Render ───────────────────────────────────────────────────────────────

  const pages = alertsPage?.pages ?? 1

  return (
    <div className="flex h-full overflow-hidden">

      {/* ── Left: file scan panel ─────────────────────────────────────── */}
      <div className="w-64 shrink-0 border-r border-white/5 bg-bg-secondary flex flex-col">
        <div className="px-3 py-2.5 border-b border-white/5 shrink-0 flex items-center gap-2">
          <Swords size={11} className="text-accent-green/70" />
          <span className="text-[10px] font-semibold uppercase tracking-widest text-accent-muted/60">
            Files to scan
          </span>
        </div>
        <FileScanPanel
          caseId={caseId}
          scans={scans}
          selectedFileId={selectedFileId}
          onSelectFile={setSelectedFileId}
          onScanStarted={() => {
            qc.invalidateQueries({ queryKey: ['chainsaw-scans', caseId] })
            qc.invalidateQueries({ queryKey: ['chainsaw-alerts', caseId] })
          }}
        />
        {/* Config hint */}
        <div className="shrink-0 px-3 py-2.5 border-t border-white/5">
          <p className="text-[9px] text-accent-muted/30 leading-relaxed">
            Set <span className="font-mono">CHAINSAW_BIN_PATH</span> and{' '}
            <span className="font-mono">CHAINSAW_RULES_PATH</span> in{' '}
            <span className="font-mono">.env</span>
          </p>
        </div>
      </div>

      {/* ── Center: alerts ────────────────────────────────────────────── */}
      <div className="flex-1 flex flex-col overflow-hidden min-w-0">

        {/* Toolbar */}
        <div className="shrink-0 flex items-center gap-2 px-3 py-2 border-b border-white/5 bg-bg-secondary/50 flex-wrap">
          {/* Level filters */}
          <span className="text-[9px] uppercase tracking-widest text-accent-muted/30 flex items-center gap-1">
            <Filter size={9} /> Level
          </span>
          {/* "All" chip — active when no level filter set */}
          <button
            onClick={() => setLevelFilter(new Set())}
            className={`text-[9px] px-2 py-0.5 rounded border capitalize transition-colors ${
              levelFilter.size === 0
                ? 'border-white/20 text-white/70 bg-white/5'
                : 'border-white/8 text-accent-muted/40 hover:border-white/20 hover:text-accent-muted'
            }`}
          >
            All
          </button>
          {LEVEL_ORDER.map(l => (
            <button
              key={l}
              onClick={() => toggleLevel(l)}
              className={`text-[9px] px-2 py-0.5 rounded border capitalize transition-colors ${
                levelFilter.size === 0 || levelFilter.has(l)
                  ? LEVEL_COLOR[l]
                  : 'border-white/8 text-accent-muted/40 hover:border-white/20 hover:text-accent-muted'
              }`}
            >
              {l}
            </button>
          ))}

          {/* Search */}
          <input
            className="input text-xs h-6 w-44 ml-2"
            placeholder="Search rule, channel…"
            value={search}
            onChange={e => setSearch(e.target.value)}
          />

          {/* Sort */}
          <button
            onClick={() => setSortDir(d => d === 'desc' ? 'asc' : 'desc')}
            className="ml-auto text-[10px] px-2 py-1 rounded border border-white/8 text-accent-muted/50 hover:border-white/20 hover:text-white transition-colors flex items-center gap-1"
          >
            <Clock size={10} />
            {sortDir === 'desc' ? 'Newest first' : 'Oldest first'}
          </button>

          {/* Selection count badge */}
          {pinnedAlerts.length > 0 && (
            <div className="flex items-center gap-1.5 px-2.5 py-1 rounded border border-accent-green/20 text-accent-green/70 text-[10px] bg-accent-green/5">
              <BookmarkPlus size={11} />
              <span className="bg-accent-green text-bg-primary text-[8px] font-bold rounded-full w-4 h-4 flex items-center justify-center leading-none">
                {pinnedAlerts.length}
              </span>
            </div>
          )}
        </div>

        {/* Table */}
        <div className="flex-1 overflow-auto">
          {!hasScans ? (
            <div className="h-full flex flex-col items-center justify-center gap-3 text-center px-8">
              <Swords size={40} className="opacity-10" />
              <p className="text-sm text-accent-muted/50">No Chainsaw scans yet</p>
              <p className="text-xs text-accent-muted/30">
                Select a parsed EVTX file on the left and click{' '}
                <span className="font-mono text-accent-green/50">Scan with Chainsaw</span>
              </p>
            </div>
          ) : (
            <table className="w-full text-left border-collapse">
              <thead className="sticky top-0 z-10 bg-bg-secondary border-b border-white/5">
                <tr>
                  <th className="w-8" />
                  <th className="w-5" />
                  <th className="px-2 py-2 text-[9px] uppercase tracking-widest text-accent-muted/40 font-semibold w-28">Level</th>
                  <th className="px-2 py-2 text-[9px] uppercase tracking-widest text-accent-muted/40 font-semibold w-36">Timestamp</th>
                  <th className="px-2 py-2 text-[9px] uppercase tracking-widest text-accent-muted/40 font-semibold">Rule</th>
                  <th className="px-2 py-2 text-[9px] uppercase tracking-widest text-accent-muted/40 font-semibold w-16 text-right">EID</th>
                  <th className="px-2 py-2 text-[9px] uppercase tracking-widest text-accent-muted/40 font-semibold w-32">Channel</th>
                  <th className="px-2 py-2 text-[9px] uppercase tracking-widest text-accent-muted/40 font-semibold w-32">Computer</th>
                </tr>
              </thead>
              <tbody>
                {isFetching && !alertsPage?.items.length && (
                  <tr>
                    <td colSpan={8} className="py-8 text-center text-accent-muted/40 text-xs">
                      Loading…
                    </td>
                  </tr>
                )}
                {alertsPage?.items.map(alert => (
                  <AlertRow
                    key={alert.id}
                    alert={alert}
                    pinned={pinnedIds.has(alert.id)}
                    onPin={handlePin}
                  />
                ))}
                {alertsPage?.items.length === 0 && !isFetching && (
                  <tr>
                    <td colSpan={8} className="py-8 text-center text-accent-muted/40 text-xs">
                      No alerts match the current filters
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          )}
        </div>

        {/* Pagination */}
        {(alertsPage?.total ?? 0) > 0 && (
          <div className="shrink-0 flex items-center justify-between px-4 py-2 border-t border-white/5 bg-bg-secondary/30">
            <span className="text-[10px] text-accent-muted/40">
              {alertsPage!.total} alert{alertsPage!.total !== 1 ? 's' : ''}
              {isFetching && ' · refreshing…'}
            </span>
            <div className="flex items-center gap-1">
              <button
                onClick={() => setPage(p => Math.max(1, p - 1))}
                disabled={page <= 1}
                className="px-2 py-1 rounded text-[10px] border border-white/8 text-accent-muted/50 hover:border-white/20 disabled:opacity-30 transition-colors"
              >
                ‹ Prev
              </button>
              <span className="text-[10px] text-accent-muted/40 px-2">
                {page} / {pages}
              </span>
              <button
                onClick={() => setPage(p => Math.min(pages, p + 1))}
                disabled={page >= pages}
                className="px-2 py-1 rounded text-[10px] border border-white/8 text-accent-muted/50 hover:border-white/20 disabled:opacity-30 transition-colors"
              >
                Next ›
              </button>
            </div>
          </div>
        )}
      </div>

      {/* ── Right: selection panel (always visible) ──────────────────── */}
      <div className="w-60 shrink-0 border-l border-white/5 bg-bg-secondary flex flex-col">
        <SelectionPanel
          alerts={sortedPinned}
          sentIds={sentIds}
          caseId={caseId}
          onRemove={handleRemove}
          onClear={handleClear}
          onSent={handleSent}
        />
      </div>
    </div>
  )
}
