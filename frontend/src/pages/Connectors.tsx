import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import {
  Plug, CheckCircle2, XCircle, Loader2, Eye, EyeOff,
  ExternalLink, Trash2, FlaskConical, Save,
} from '../ui/icons'
import {
  connectorsApi, CONNECTOR_META,
  type ConnectorConfig, type ConnectorMeta,
} from '../api/connectors'
import { fmtDateTimeShort } from '../utils/dateUtils'

// ── Connector card ────────────────────────────────────────────────────────────

interface CardProps {
  meta:   ConnectorMeta
  config: ConnectorConfig | undefined
}

function ConnectorCard({ meta, config }: CardProps) {
  const qc = useQueryClient()

  const isConfigured = !!(config?.api_key)
  const isEnabled    = config?.enabled ?? false

  const [apiKey,    setApiKey]    = useState('')
  const [baseUrl,   setBaseUrl]   = useState(config?.base_url ?? '')
  const [showKey,   setShowKey]   = useState(false)
  const [testMsg,   setTestMsg]   = useState<{ ok: boolean; text: string } | null>(null)

  const save = useMutation({
    mutationFn: () => connectorsApi.upsert(meta.name, {
      api_key:  apiKey || undefined,
      base_url: baseUrl || undefined,
      enabled:  true,
    }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['connectors'] })
      setApiKey('')
      setTestMsg(null)
    },
  })

  const clearKey = useMutation({
    mutationFn: () => connectorsApi.clearKey(meta.name),
    onSuccess:  () => {
      qc.invalidateQueries({ queryKey: ['connectors'] })
      setTestMsg(null)
    },
  })

  const toggle = useMutation({
    mutationFn: () => connectorsApi.upsert(meta.name, {
      api_key:  undefined,
      base_url: baseUrl || undefined,
      enabled:  !isEnabled,
    }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['connectors'] }),
  })

  const test = useMutation({
    mutationFn: () => connectorsApi.test(meta.name),
    onSuccess: (r) => setTestMsg({ ok: r.ok, text: r.message }),
  })

  const canSave = apiKey.trim().length > 0 || baseUrl.trim() !== (config?.base_url ?? '')

  return (
    <div className="bg-panel border border-hairline overflow-hidden">
      {/* Header */}
      <div className="flex items-start gap-4 p-5 border-b border-hairline">
        {/* Icon */}
        <div className={`w-10 h-10 ${meta.iconBg} flex items-center justify-center shrink-0`}>
          <Plug size={18} className={meta.iconColor} />
        </div>

        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <h3 className="font-semibold text-fg text-ui">{meta.label}</h3>

            {/* Status badge */}
            {isConfigured ? (
              <span className={`text-label font-mono px-1.5 py-0.5 rounded-control border ${ isEnabled
                  ? 'bg-accent/10 text-accent border-accent/25'
                  : 'bg-fg/5 text-fg-secondary/50 border-hairline'
              }`}>
                {isEnabled ? 'enabled' : 'disabled'}
              </span>
            ) : (
              <span className="text-label font-mono px-1.5 py-0.5 rounded-control border bg-fg/5 text-fg-secondary/30 border-hairline">
                not configured
              </span>
            )}
          </div>

          <p className="text-label text-fg-secondary/60 mt-0.5 leading-relaxed">
            {meta.description}
          </p>

          <a
            href={meta.docsUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-1 text-label text-accent/50 hover:text-accent mt-1 transition-colors"
          >
            <ExternalLink size={9} /> Documentation
          </a>
        </div>

        {/* Enable/disable toggle */}
        {isConfigured && (
          <button
            onClick={() => toggle.mutate()}
            disabled={toggle.isPending}
            className={`shrink-0 text-label px-2.5 py-1 rounded-control border transition-colors ${ isEnabled
                ? 'border-hairline text-fg-secondary/50 hover:text-severity-critical hover:border-severity-critical/30'
                : 'border-accent/25 text-accent/60 hover:bg-accent/5'
            }`}
          >
            {toggle.isPending ? <Loader2 size={10} className="animate-spin" /> : isEnabled ? 'Disable' : 'Enable'}
          </button>
        )}
      </div>

      {/* Config form */}
      <div className="p-5 space-y-3">

        {/* Current key info */}
        {isConfigured && (
          <div className="flex items-center gap-2 px-3 py-2 bg-panel border border-hairline text-label">
            <CheckCircle2 size={12} className="text-accent shrink-0" />
            <span className="text-fg-secondary/60 font-mono flex-1">
              API key: {config!.api_key}
            </span>
            {config?.updated_at && (
              <span className="text-fg-secondary/30 text-label shrink-0">
                updated {fmtDateTimeShort(config.updated_at)} by {config.updated_by}
              </span>
            )}
            <button
              onClick={() => clearKey.mutate()}
              disabled={clearKey.isPending}
              className="shrink-0 p-1 rounded-control text-fg-secondary/30 hover:text-severity-critical transition-colors"
              title="Remove API key"
            >
              <Trash2 size={11} />
            </button>
          </div>
        )}

        {/* API key input */}
        <div>
          <label className="block text-label font-semibold tracking-wider uppercase text-fg-secondary/50 mb-1.5">
            {isConfigured ? 'New API key' : 'API key'}
            {!isConfigured && <span className="text-severity-critical ml-1">*</span>}
          </label>
          <div className="relative">
            <input
              type={showKey ? 'text' : 'password'}
              value={apiKey}
              onChange={e => setApiKey(e.target.value)}
              placeholder={isConfigured ? 'Leave blank to keep current key' : 'Paste your API key…'}
              className="w-full pr-8 pl-3 py-2 bg-panel border border-hairline text-label font-mono text-fg placeholder:text-fg-secondary/25 focus:outline-none focus:border-accent/40 transition-colors"
              autoComplete="off"
              spellCheck={false}
            />
            <button
              onClick={() => setShowKey(v => !v)}
              className="absolute right-2 top-1/2 -translate-y-1/2 text-fg-secondary/30 hover:text-fg transition-colors"
            >
              {showKey ? <EyeOff size={13} /> : <Eye size={13} />}
            </button>
          </div>
        </div>

        {/* Base URL (MISP only) */}
        {meta.fields.includes('base_url') && (
          <div>
            <label className="block text-label font-semibold tracking-wider uppercase text-fg-secondary/50 mb-1.5">
              Base URL <span className="text-severity-critical">*</span>
            </label>
            <input
              type="url"
              value={baseUrl}
              onChange={e => setBaseUrl(e.target.value)}
              placeholder="https://misp.yourorg.internal"
              className="w-full px-3 py-2 bg-panel border border-hairline text-label font-mono text-fg placeholder:text-fg-secondary/25 focus:outline-none focus:border-accent/40 transition-colors"
            />
          </div>
        )}

        {/* Actions row */}
        <div className="flex items-center gap-2 pt-1">
          {/* Test */}
          <button
            onClick={() => { setTestMsg(null); test.mutate() }}
            disabled={test.isPending || !isConfigured}
            className="flex items-center gap-1.5 px-3 py-1.5 border border-hairline text-label text-fg-secondary/60 hover:text-fg hover:border-strong transition-colors disabled:opacity-30"
          >
            {test.isPending
              ? <Loader2 size={11} className="animate-spin" />
              : <FlaskConical size={11} />
            }
            Test connection
          </button>

          {/* Save */}
          <button
            onClick={() => save.mutate()}
            disabled={!canSave || save.isPending}
            className="flex items-center gap-1.5 px-3 py-1.5 border text-label transition-colors ml-auto disabled:opacity-30 border-accent/30 text-accent hover:bg-accent/10"
          >
            {save.isPending
              ? <Loader2 size={11} className="animate-spin" />
              : <Save size={11} />
            }
            Save
          </button>
        </div>

        {/* Test result */}
        {testMsg && (
          <div className={`flex items-start gap-2 px-3 py-2 border text-label ${
            testMsg.ok
              ? 'bg-accent/5 border-accent/20 text-accent'
              : 'bg-severity-critical/5 border-severity-critical/20 text-severity-critical'
          }`}>
            {testMsg.ok
              ? <CheckCircle2 size={13} className="shrink-0 mt-0.5" />
              : <XCircle     size={13} className="shrink-0 mt-0.5" />
            }
            {testMsg.text}
          </div>
        )}

        {save.isError && (
          <p className="text-label text-severity-critical">
            {(save.error as Error)?.message ?? 'Save failed'}
          </p>
        )}
      </div>
    </div>
  )
}

// ── Page ──────────────────────────────────────────────────────────────────────

export default function Connectors() {
  const { data: configs = [] } = useQuery({
    queryKey: ['connectors'],
    queryFn:  connectorsApi.list,
  })

  const configMap = Object.fromEntries(configs.map(c => [c.name, c]))

  const configured = Object.values(CONNECTOR_META).filter(m => configMap[m.name]?.api_key)
  const total      = Object.keys(CONNECTOR_META).length

  return (
    <div className="p-6 max-w-3xl mx-auto space-y-6">

      {/* Page header */}
      <div className="flex items-start justify-between">
        <div>
          <div className="flex items-center gap-2.5 mb-1">
            <Plug size={18} className="text-accent" />
            <h1 className="text-title font-semibold text-fg">Connectors</h1>
          </div>
          <p className="text-ui text-fg-secondary/50">
            Configure API keys for external threat intelligence and data sources.
            Keys are stored server-side and never exposed to the browser after saving.
          </p>
        </div>

        <div className="shrink-0 text-right">
          <p className="text-title font-bold text-accent font-mono">
            {configured.length}<span className="text-fg-secondary/30 text-prose">/{total}</span>
          </p>
          <p className="text-label text-fg-secondary/40">configured</p>
        </div>
      </div>

      {/* Cards */}
      <div className="space-y-4">
        {Object.values(CONNECTOR_META).map(meta => (
          <ConnectorCard
            key={meta.name}
            meta={meta}
            config={configMap[meta.name]}
          />
        ))}
      </div>
    </div>
  )
}
