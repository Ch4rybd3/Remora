import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import {
  CheckCircle2, AlertCircle, Loader2, Clock, RotateCcw, ChevronDown, ChevronUp,
} from 'lucide-react'
import { useState } from 'react'
import { memoryApi, type MemoryPluginResult } from '../../api/memory'
import { formatDistanceToNow } from 'date-fns'

// ── Status chip ────────────────────────────────────────────────────────────────

function StatusChip({ status }: { status: string }) {
  const map: Record<string, { cls: string; icon: React.ElementType }> = {
    pending:  { cls: 'text-accent-muted/50 border-white/10',                          icon: Clock       },
    running:  { cls: 'text-yellow-400 border-yellow-400/30 bg-yellow-400/8',           icon: Loader2     },
    done:     { cls: 'text-accent-green border-accent-green/30 bg-accent-green/8',     icon: CheckCircle2},
    error:    { cls: 'text-severity-critical border-severity-critical/30 bg-severity-critical/8', icon: AlertCircle },
  }
  const theme = map[status] ?? map.pending
  const Icon  = theme.icon
  return (
    <span className={`inline-flex items-center gap-1 text-[9px] font-mono px-1.5 py-0.5 rounded border ${theme.cls}`}>
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
    <div className={`rounded-lg border transition-colors ${
      plugin.status === 'done'    ? 'border-accent-green/20 bg-accent-green/3' :
      plugin.status === 'error'   ? 'border-severity-critical/20 bg-severity-critical/3' :
      plugin.status === 'running' ? 'border-yellow-400/20 bg-yellow-400/3' :
      'border-white/8 bg-white/[0.02]'
    }`}>
      {/* Header */}
      <div className="flex items-center gap-3 px-3 py-2.5">
        <StatusChip status={plugin.status} />
        <span className="text-[11px] font-mono font-medium text-white flex-1 truncate">
          {plugin.plugin_name}
        </span>
        {plugin.completed_at && (
          <span className="text-[9px] text-accent-muted/30">
            {formatDistanceToNow(new Date(plugin.completed_at), { addSuffix: true })}
          </span>
        )}
        <button
          onClick={() => rerun.mutate()}
          disabled={rerun.isPending || plugin.status === 'running' || plugin.status === 'pending'}
          className="p-1 rounded text-accent-muted/30 hover:text-white hover:bg-white/5 transition-colors disabled:opacity-30"
          title="Re-run"
        >
          <RotateCcw size={11} className={rerun.isPending ? 'animate-spin' : ''} />
        </button>
        {(hasOutput || hasError) && (
          <button
            onClick={() => setOpen(v => !v)}
            className="p-1 rounded text-accent-muted/30 hover:text-white hover:bg-white/5 transition-colors"
          >
            {open ? <ChevronUp size={11} /> : <ChevronDown size={11} />}
          </button>
        )}
      </div>

      {/* Output / error */}
      {open && (
        <div className="border-t border-white/5 px-3 py-2.5 space-y-2">
          {hasOutput && (
            <pre className="text-[10px] font-mono text-white/70 whitespace-pre-wrap break-all max-h-96 overflow-y-auto leading-relaxed bg-black/20 rounded p-2">
              {plugin.output}
            </pre>
          )}
          {hasError && (
            <div className="text-[10px] font-mono text-severity-critical/80 bg-severity-critical/5 rounded p-2 whitespace-pre-wrap break-all max-h-48 overflow-y-auto">
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
      <div className="flex items-center justify-center h-48 text-accent-muted/40 text-sm">
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
        <div className="flex-1 h-1.5 rounded-full bg-white/5 overflow-hidden">
          <div
            className="h-full bg-accent-green rounded-full transition-all"
            style={{ width: `${Math.round((done / defaults.length) * 100)}%` }}
          />
        </div>
        <span className="text-[10px] text-accent-muted/50 font-mono shrink-0">
          {done}/{defaults.length} done
          {running > 0 && <> · <span className="text-yellow-400">{running} running</span></>}
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
