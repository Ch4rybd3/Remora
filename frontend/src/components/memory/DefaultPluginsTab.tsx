import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import {
  CheckCircle2, AlertCircle, Loader2, Clock, RotateCcw, ChevronDown, ChevronUp,
} from '../../ui/icons'
import { useState } from 'react'
import { memoryApi, type MemoryPluginResult } from '../../api/memory'
import { fmtRelative } from '../../utils/dateUtils'

// ── Status chip ────────────────────────────────────────────────────────────────

function StatusChip({ status }: { status: string }) {
  const map: Record<string, { cls: string; icon: React.ElementType }> = {
    pending:  { cls: 'text-fg-secondary/50 border-hairline',                          icon: Clock       },
    running:  { cls: 'text-severity-medium border-severity-medium/30 bg-severity-medium/8',           icon: Loader2     },
    done:     { cls: 'text-accent border-accent/30 bg-accent/8',     icon: CheckCircle2},
    error:    { cls: 'text-severity-critical border-severity-critical/30 bg-severity-critical/8', icon: AlertCircle },
  }
  const theme = map[status] ?? map.pending
  const Icon  = theme.icon
  return (
    <span className={`inline-flex items-center gap-1 text-label font-mono px-1.5 py-0.5 rounded-control border ${theme.cls}`}>
      <Icon size={9} className={status === 'running' ? 'animate-spin' : ''} />
      {status}
    </span>
  )
}

// ── Plugin card ────────────────────────────────────────────────────────────────

function PluginCard({
  plugin, caseId, dumpId,
}: {
  plugin:  MemoryPluginResult
  caseId:  string
  dumpId:  string
}) {
  const qc      = useQueryClient()
  const [open, setOpen] = useState(false)

  const rerun = useMutation({
    mutationFn: () => memoryApi.rerunPlugin(caseId, dumpId, plugin.id),
    onSuccess:  () => qc.invalidateQueries({ queryKey: ['memory-plugins', caseId, dumpId] }),
  })

  const hasOutput = plugin.output && plugin.output.trim().length > 0
  const hasError  = plugin.error  && plugin.error.trim().length > 0

  return (
    <div className={` border transition-colors ${ plugin.status === 'done'    ? 'border-accent/20 bg-accent/3' :
      plugin.status === 'error'   ? 'border-severity-critical/20 bg-severity-critical/3' :
      plugin.status === 'running' ? 'border-severity-medium/20 bg-severity-medium/3' :
      'border-hairline bg-white/[0.02]'
    }`}>
      {/* Header */}
      <div className="flex items-center gap-3 px-3 py-2.5">
        <StatusChip status={plugin.status} />
        <span className="text-label font-mono font-medium text-fg flex-1 truncate">
          {plugin.plugin_name}
        </span>
        {plugin.completed_at && (
          <span className="text-label text-fg-secondary/30">
            {fmtRelative(plugin.completed_at)}
          </span>
        )}
        <button
          onClick={() => rerun.mutate()}
          disabled={rerun.isPending || plugin.status === 'running' || plugin.status === 'pending'}
          className="p-1 rounded-control text-fg-secondary/30 hover:text-fg hover:bg-fg/5 transition-colors disabled:opacity-30"
          title="Re-run"
        >
          <RotateCcw size={11} className={rerun.isPending ? 'animate-spin' : ''} />
        </button>
        {(hasOutput || hasError) && (
          <button
            onClick={() => setOpen(v => !v)}
            className="p-1 rounded-control text-fg-secondary/30 hover:text-fg hover:bg-fg/5 transition-colors"
          >
            {open ? <ChevronUp size={11} /> : <ChevronDown size={11} />}
          </button>
        )}
      </div>

      {/* Output / error */}
      {open && (
        <div className="border-t border-hairline px-3 py-2.5 space-y-2">
          {hasOutput && (
            <pre className="text-label font-mono text-fg/70 whitespace-pre-wrap break-all max-h-96 overflow-y-auto leading-relaxed bg-black/20 rounded-control p-2">
              {plugin.output}
            </pre>
          )}
          {hasError && (
            <div className="text-label font-mono text-severity-critical/80 bg-severity-critical/5 rounded-control p-2 whitespace-pre-wrap break-all max-h-48 overflow-y-auto">
              {plugin.error}
            </div>
          )}
        </div>
      )}
    </div>
  )
}

// ── Main ───────────────────────────────────────────────────────────────────────

interface Props { caseId: string; dumpId: string }

export default function DefaultPluginsTab({ caseId, dumpId }: Props) {
  const { data: plugins = [] } = useQuery({
    queryKey:      ['memory-plugins', caseId, dumpId],
    queryFn:       () => memoryApi.listPlugins(caseId, dumpId),
    refetchInterval: (query) => {
      const d = query.state.data ?? []
      return d.some(p => p.status === 'pending' || p.status === 'running') ? 2000 : false
    },
  })

  const defaults = plugins.filter(p => !p.is_custom)

  if (defaults.length === 0) {
    return (
      <div className="flex items-center justify-center h-48 text-fg-secondary/40 text-ui">
        No plugin results yet
      </div>
    )
  }

  const done    = defaults.filter(p => p.status === 'done').length
  const errored = defaults.filter(p => p.status === 'error').length
  const running = defaults.filter(p => p.status === 'running').length
  const pending = defaults.filter(p => p.status === 'pending').length

  return (
    <div className="space-y-4">
      {/* Progress bar */}
      <div className="flex items-center gap-3">
        <div className="flex-1 h-1.5 rounded-pill bg-fg/5 overflow-hidden">
          <div
            className="h-full bg-accent rounded-pill transition-all"
            style={{ width: `${Math.round((done / defaults.length) * 100)}%` }}
          />
        </div>
        <span className="text-label text-fg-secondary/50 font-mono shrink-0">
          {done}/{defaults.length} done
          {running > 0 && <> · <span className="text-severity-medium">{running} running</span></>}
          {pending > 0 && <> · {pending} pending</>}
          {errored > 0 && <> · <span className="text-severity-critical">{errored} errors</span></>}
        </span>
      </div>

      {/* Cards */}
      <div className="space-y-2">
        {defaults.map(p => (
          <PluginCard key={p.id} plugin={p} caseId={caseId} dumpId={dumpId} />
        ))}
      </div>
    </div>
  )
}
