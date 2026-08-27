import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { Play, RotateCcw, ChevronDown, ChevronUp, Terminal, AlertCircle, Loader2, CheckCircle2, Clock } from '../../ui/icons'
import { memoryApi, type MemoryPluginResult } from '../../api/memory'
import { fmtRelative } from '../../utils/dateUtils'

// ── Plugin catalog ─────────────────────────────────────────────────────────────

interface ParamDef {
  name:        string
  label:       string
  placeholder?: string
  type:        'string' | 'number' | 'flag'
}

interface PluginDef {
  name:   string
  label:  string
  params: ParamDef[]
}

const CATALOG: Record<string, PluginDef[]> = {
  'Process': [
    {
      name: 'windows.pslist', label: 'pslist — Process List', params: [
        { name: 'pid', label: 'PID filter', placeholder: '1234', type: 'number' },
      ],
    },
    {
      name: 'windows.pstree', label: 'pstree — Process Tree', params: [
        { name: 'pid', label: 'PID filter', placeholder: '1234', type: 'number' },
      ],
    },
    {
      name: 'windows.psscan', label: 'psscan — Pool Scanner', params: [
        { name: 'pid', label: 'PID filter', placeholder: '1234', type: 'number' },
      ],
    },
    {
      name: 'windows.cmdline', label: 'cmdline — Command Lines', params: [
        { name: 'pid', label: 'PID filter', placeholder: '1234', type: 'number' },
      ],
    },
    {
      name: 'windows.dlllist', label: 'dlllist — DLL List', params: [
        { name: 'pid', label: 'PID filter', placeholder: '1234', type: 'number' },
      ],
    },
    {
      name: 'windows.handles', label: 'handles — Open Handles', params: [
        { name: 'pid',         label: 'PID filter',     placeholder: '1234',  type: 'number' },
        { name: 'type',        label: 'Handle type',    placeholder: 'File',  type: 'string' },
      ],
    },
    { name: 'windows.malfind', label: 'malfind — Injected Code', params: [
        { name: 'pid',    label: 'PID filter',  placeholder: '1234',  type: 'number' },
        { name: 'dump',   label: 'Dump memory', type: 'flag' },
      ],
    },
    {
      name: 'windows.vadinfo', label: 'vadinfo — VAD Regions', params: [
        { name: 'pid', label: 'PID filter', placeholder: '1234', type: 'number' },
      ],
    },
  ],
  'Network': [
    { name: 'windows.netscan',  label: 'netscan — Network Connections', params: [] },
    { name: 'windows.netstat',  label: 'netstat — Network Statistics',   params: [] },
  ],
  'Registry': [
    { name: 'windows.registry.hivelist', label: 'hivelist — Hive List',      params: [] },
    {
      name: 'windows.registry.printkey', label: 'printkey — Print Key', params: [
        { name: 'key', label: 'Registry key path', placeholder: 'Software\\Microsoft', type: 'string' },
      ],
    },
    {
      name: 'windows.registry.userassist', label: 'userassist — User Assist', params: [] },
  ],
  'Files': [
    {
      name: 'windows.filescan', label: 'filescan — File Scanner', params: [
        { name: 'filter', label: 'Filename filter', placeholder: '.exe', type: 'string' },
      ],
    },
    {
      name: 'windows.dumpfiles', label: 'dumpfiles — Dump Files', params: [
        { name: 'physaddr', label: 'Physical address (hex)', placeholder: '0x...', type: 'string' },
      ],
    },
  ],
  'System': [
    { name: 'windows.info',       label: 'info — System Info',         params: [] },
    { name: 'windows.modules',    label: 'modules — Kernel Modules',   params: [] },
    { name: 'windows.driverscan', label: 'driverscan — Driver Scanner', params: [] },
    { name: 'windows.svcscan',    label: 'svcscan — Services',         params: [] },
    { name: 'windows.privileges', label: 'privileges — Process Privs', params: [
        { name: 'pid', label: 'PID filter', placeholder: '1234', type: 'number' },
      ],
    },
  ],
  'Linux': [
    { name: 'linux.pslist',       label: 'pslist — Process List',    params: [] },
    { name: 'linux.pstree',       label: 'pstree — Process Tree',    params: [] },
    { name: 'linux.psscan',       label: 'psscan — Pool Scanner',    params: [] },
    { name: 'linux.bash',         label: 'bash — Bash History',      params: [] },
    { name: 'linux.sockstat',     label: 'sockstat — Socket Stats',  params: [] },
    { name: 'linux.lsof',         label: 'lsof — Open Files',        params: [] },
    { name: 'linux.proc_maps',    label: 'proc_maps — Memory Maps',  params: [] },
    { name: 'linux.check_modules',label: 'check_modules — LKMs',     params: [] },
  ],
}

// ── Status chip (inline) ───────────────────────────────────────────────────────

function Chip({ status }: { status: string }) {
  const map: Record<string, { cls: string; icon: React.ElementType }> = {
    pending: { cls: 'text-accent-muted/50 border-white/10',                         icon: Clock       },
    running: { cls: 'text-yellow-400 border-yellow-400/30 bg-yellow-400/8',          icon: Loader2     },
    done:    { cls: 'text-accent-green border-accent-green/30 bg-accent-green/8',    icon: CheckCircle2},
    error:   { cls: 'text-severity-critical border-severity-critical/30 bg-severity-critical/8', icon: AlertCircle },
  }
  const th   = map[status] ?? map.pending
  const Icon = th.icon
  return (
    <span className={`inline-flex items-center gap-1 text-[9px] font-mono px-1.5 py-0.5 rounded border ${th.cls}`}>
      <Icon size={9} className={status === 'running' ? 'animate-spin' : ''} />
      {status}
    </span>
  )
}

// ── History card ───────────────────────────────────────────────────────────────

function HistoryCard({ p, caseId, dumpId }: { p: MemoryPluginResult; caseId: string; dumpId: string }) {
  const qc = useQueryClient()
  const [open, setOpen] = useState(false)
  const rerun = useMutation({
    mutationFn: () => memoryApi.rerunPlugin(caseId, dumpId, p.id),
    onSuccess:  () => qc.invalidateQueries({ queryKey: ['memory-plugins', caseId, dumpId] }),
  })

  return (
    <div className={`rounded-lg border transition-colors text-[11px] ${
      p.status === 'done'  ? 'border-accent-green/15 bg-accent-green/3' :
      p.status === 'error' ? 'border-severity-critical/15 bg-severity-critical/3' :
      'border-white/8 bg-white/[0.02]'
    }`}>
      <div className="flex items-center gap-2.5 px-3 py-2">
        <Chip status={p.status} />
        <span className="font-mono text-white/70 flex-1 truncate">{p.plugin_name}</span>
        {p.plugin_args && Object.keys(p.plugin_args).length > 0 && (
          <span className="text-[9px] text-accent-muted/40 font-mono truncate max-w-32">
            {Object.entries(p.plugin_args).map(([k, v]) => `--${k} ${v}`).join(' ')}
          </span>
        )}
        {p.completed_at && (
          <span className="text-[9px] text-accent-muted/30 shrink-0">
            {fmtRelative(p.completed_at)}
          </span>
        )}
        <button
          onClick={() => rerun.mutate()}
          disabled={rerun.isPending || p.status === 'running' || p.status === 'pending'}
          className="p-1 rounded text-accent-muted/30 hover:text-white hover:bg-white/5 transition-colors disabled:opacity-30"
          title="Re-run"
        >
          <RotateCcw size={11} className={rerun.isPending ? 'animate-spin' : ''} />
        </button>
        {(p.output || p.error) && (
          <button
            onClick={() => setOpen(v => !v)}
            className="p-1 rounded text-accent-muted/30 hover:text-white hover:bg-white/5 transition-colors"
          >
            {open ? <ChevronUp size={11} /> : <ChevronDown size={11} />}
          </button>
        )}
      </div>
      {open && (
        <div className="border-t border-white/5 px-3 py-2.5 space-y-2">
          {p.output && (
            <pre className="text-[10px] font-mono text-white/70 whitespace-pre-wrap break-all max-h-80 overflow-y-auto leading-relaxed bg-black/20 rounded p-2">
              {p.output}
            </pre>
          )}
          {p.error && (
            <div className="text-[10px] font-mono text-severity-critical/80 bg-severity-critical/5 rounded p-2 whitespace-pre-wrap break-all max-h-48 overflow-y-auto">
              {p.error}
            </div>
          )}
        </div>
      )}
    </div>
  )
}

// ── Main ───────────────────────────────────────────────────────────────────────

interface Props { caseId: string; dumpId: string; osType: string }

export default function CustomCommandTab({ caseId, dumpId, osType }: Props) {
  const qc = useQueryClient()

  // Filter catalog by OS
  const categories = Object.entries(CATALOG).filter(([cat]) =>
    osType === 'linux' ? cat === 'Linux' : cat !== 'Linux'
  )

  const [activeCat,    setActiveCat]    = useState(categories[0]?.[0] ?? '')
  const [selectedPlugin, setSelectedPlugin] = useState<PluginDef | null>(null)
  const [paramValues,  setParamValues]  = useState<Record<string, string>>({})

  // Query custom plugin results
  const { data: plugins = [] } = useQuery({
    queryKey:      ['memory-plugins', caseId, dumpId],
    queryFn:       () => memoryApi.listPlugins(caseId, dumpId),
    refetchInterval: (query) => {
      const d = query.state.data ?? []
      return d.some(p => p.status === 'pending' || p.status === 'running') ? 2000 : false
    },
  })
  const customs = plugins.filter(p => p.is_custom).reverse()

  const runPlugin = useMutation({
    mutationFn: () => {
      if (!selectedPlugin) return Promise.reject('No plugin selected')
      const args: Record<string, unknown> = {}
      for (const param of selectedPlugin.params) {
        const val = paramValues[param.name]
        if (param.type === 'flag') {
          if (val === 'true') args[param.name] = ''
        } else if (val && val.trim()) {
          args[param.name] = param.type === 'number' ? Number(val) : val.trim()
        }
      }
      return memoryApi.runPlugin(caseId, dumpId, selectedPlugin.name,
        Object.keys(args).length > 0 ? args : undefined)
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['memory-plugins', caseId, dumpId] }),
  })

  // Build command preview
  const preview = selectedPlugin
    ? [
        'vol', '-f', '<dump>', selectedPlugin.name,
        ...selectedPlugin.params.flatMap(p => {
          const v = paramValues[p.name]
          if (!v || !v.trim()) return []
          if (p.type === 'flag') return v === 'true' ? [`--${p.name}`] : []
          return [`--${p.name}`, v.trim()]
        }),
      ].join(' ')
    : null

  const selectPlugin = (plugin: PluginDef) => {
    setSelectedPlugin(plugin)
    setParamValues({})
  }

  return (
    <div className="flex gap-5 h-full">
      {/* ── Left: builder ─────────────────────────────────────────────────── */}
      <div className="w-72 shrink-0 flex flex-col gap-4">

        {/* Category tabs */}
        <div>
          <p className="text-[9px] font-semibold tracking-widest uppercase text-accent-muted/40 mb-2">
            Category
          </p>
          <div className="flex flex-wrap gap-1">
            {categories.map(([cat]) => (
              <button
                key={cat}
                onClick={() => { setActiveCat(cat); setSelectedPlugin(null); setParamValues({}) }}
                className={`text-[10px] px-2 py-1 rounded border transition-colors ${
                  activeCat === cat
                    ? 'bg-accent-green/10 border-accent-green/30 text-accent-green'
                    : 'border-white/8 text-accent-muted hover:text-white hover:border-white/20'
                }`}
              >
                {cat}
              </button>
            ))}
          </div>
        </div>

        {/* Plugin list */}
        <div>
          <p className="text-[9px] font-semibold tracking-widest uppercase text-accent-muted/40 mb-2">
            Plugin
          </p>
          <div className="space-y-1">
            {(CATALOG[activeCat] ?? []).map(plugin => (
              <button
                key={plugin.name}
                onClick={() => selectPlugin(plugin)}
                className={`w-full text-left text-[11px] px-2.5 py-2 rounded border transition-colors ${
                  selectedPlugin?.name === plugin.name
                    ? 'bg-accent-green/8 border-accent-green/25 text-accent-green'
                    : 'border-transparent text-accent-muted hover:text-white hover:bg-white/5'
                }`}
              >
                <span className="font-mono">{plugin.label}</span>
              </button>
            ))}
          </div>
        </div>

        {/* Params */}
        {selectedPlugin && selectedPlugin.params.length > 0 && (
          <div>
            <p className="text-[9px] font-semibold tracking-widest uppercase text-accent-muted/40 mb-2">
              Parameters
            </p>
            <div className="space-y-2">
              {selectedPlugin.params.map(param => (
                <div key={param.name}>
                  <label className="text-[10px] text-accent-muted/60 mb-1 block">{param.label}</label>
                  {param.type === 'flag' ? (
                    <div className="flex gap-1.5">
                      {['true', 'false'].map(v => (
                        <button
                          key={v}
                          onClick={() => setParamValues(pv => ({ ...pv, [param.name]: v }))}
                          className={`flex-1 text-[10px] py-1 rounded border transition-colors ${
                            (paramValues[param.name] ?? 'false') === v
                              ? 'bg-accent-green/10 border-accent-green/30 text-accent-green'
                              : 'border-white/8 text-accent-muted hover:text-white'
                          }`}
                        >
                          {v}
                        </button>
                      ))}
                    </div>
                  ) : (
                    <input
                      className="input text-xs py-1 w-full font-mono"
                      placeholder={param.placeholder}
                      value={paramValues[param.name] ?? ''}
                      onChange={e => setParamValues(pv => ({ ...pv, [param.name]: e.target.value }))}
                    />
                  )}
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Command preview */}
        {preview && (
          <div>
            <p className="text-[9px] font-semibold tracking-widest uppercase text-accent-muted/40 mb-1.5">
              Preview
            </p>
            <div className="bg-black/30 rounded border border-white/8 px-3 py-2 flex items-start gap-2">
              <Terminal size={11} className="text-accent-green/50 shrink-0 mt-0.5" />
              <code className="text-[10px] font-mono text-accent-green/80 break-all leading-relaxed">
                {preview}
              </code>
            </div>
          </div>
        )}

        {/* Run button */}
        <button
          onClick={() => runPlugin.mutate()}
          disabled={!selectedPlugin || runPlugin.isPending}
          className="btn-primary flex items-center justify-center gap-2 text-xs disabled:opacity-40"
        >
          {runPlugin.isPending
            ? <><Loader2 size={13} className="animate-spin" /> Running…</>
            : <><Play size={13} /> Run plugin</>
          }
        </button>

        {runPlugin.isError && (
          <p className="text-[10px] text-severity-critical">
            {(runPlugin.error as Error)?.message ?? 'Failed to run plugin'}
          </p>
        )}
      </div>

      {/* ── Right: history ────────────────────────────────────────────────── */}
      <div className="flex-1 min-w-0 overflow-y-auto">
        <p className="text-[9px] font-semibold tracking-widest uppercase text-accent-muted/40 mb-3">
          Run History ({customs.length})
        </p>
        {customs.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-48 gap-2 text-center">
            <Terminal size={24} className="text-accent-muted/20" />
            <p className="text-xs text-accent-muted/40">No custom runs yet</p>
            <p className="text-[10px] text-accent-muted/25">
              Select a plugin and click Run to get started
            </p>
          </div>
        ) : (
          <div className="space-y-2">
            {customs.map(p => (
              <HistoryCard key={p.id} p={p} caseId={caseId} dumpId={dumpId} />
            ))}
          </div>
        )}
      </div>
    </div>
  )
}
