import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { PageShell } from '../ui/PageShell'
import { agentsApi } from '../api/agents'
import type { AgentProvider, AgentProviderWrite, RoleModel } from '../types'
import { fmtDateTimeShort } from '../utils/dateUtils'
import { CheckCircle2, FlaskConical, Loader2, Plus, Save, Trash2, XCircle } from '../ui/icons'

/** Starting points for the add form. Prices are US dollars per million tokens. */
const PRESETS: Record<string, AgentProviderWrite> = {
  anthropic: { name: 'anthropic', kind: 'anthropic', base_url: '', locality: 'cloud',
               default_model: 'claude-opus-5-5', input_price: 4, output_price: 20 },
  openai:    { name: 'openai', kind: 'openai', base_url: 'https://api.openai.com/v1', locality: 'cloud',
               default_model: '', input_price: 0, output_price: 0 },
  local:     { name: 'local-openai', kind: 'openai', base_url: 'http://host.docker.internal:1234/v1',
               locality: 'local', default_model: '', input_price: 0, output_price: 0 },
}

function errorText(e: unknown, fallback: string): string {
  const detail = (e as { response?: { data?: { detail?: unknown } } })?.response?.data?.detail
  return typeof detail === 'string' ? detail : fallback
}

function ProviderForm({ initial, onSubmit, busy, submitLabel, isNew }: {
  initial: AgentProviderWrite
  onSubmit: (data: AgentProviderWrite) => void
  busy: boolean
  submitLabel: string
  isNew: boolean
}) {
  const [form, setForm] = useState<AgentProviderWrite>(initial)
  const set = (patch: Partial<AgentProviderWrite>) => setForm(f => ({ ...f, ...patch }))
  return (
    <div className="grid grid-cols-2 gap-3">
      {isNew && (
        <label className="block"><span className="label">Name</span>
          <input className="input w-full font-mono" value={form.name ?? ''}
                 onChange={e => set({ name: e.target.value })} />
        </label>
      )}
      {isNew && (
        <label className="block"><span className="label">Protocol</span>
          <select className="input w-full" value={form.kind}
                  onChange={e => set({ kind: e.target.value as AgentProviderWrite['kind'] })}>
            <option value="anthropic">Anthropic (Claude)</option>
            <option value="openai">OpenAI-compatible</option>
          </select>
        </label>
      )}
      <label className="block col-span-2"><span className="label">Base URL</span>
        <input className="input w-full font-mono" value={form.base_url ?? ''}
               placeholder={form.kind === 'anthropic' ? 'Leave empty for the Claude API' : 'https://…/v1'}
               onChange={e => set({ base_url: e.target.value })} />
      </label>
      <label className="block"><span className="label">Where the data goes</span>
        <select className="input w-full" value={form.locality}
                onChange={e => set({ locality: e.target.value as 'local' | 'cloud' })}>
          <option value="cloud">Cloud - refused for TLP:RED and AMBER+STRICT cases</option>
          <option value="local">Local - runs on infrastructure you control</option>
        </select>
      </label>
      <label className="block"><span className="label">API key</span>
        <input className="input w-full font-mono" type="password" autoComplete="off" value={form.api_key ?? ''}
               placeholder={isNew ? 'Optional for a local server' : 'Leave empty to keep the current key'}
               onChange={e => set({ api_key: e.target.value })} />
      </label>
      <label className="block"><span className="label">Default model</span>
        <input className="input w-full font-mono" value={form.default_model ?? ''}
               onChange={e => set({ default_model: e.target.value })} />
      </label>
      <div className="grid grid-cols-2 gap-2">
        <label className="block"><span className="label">Input $ / M tokens</span>
          <input className="input w-full" type="number" min={0} step="0.01" value={form.input_price ?? 0}
                 onChange={e => set({ input_price: Number(e.target.value) })} />
        </label>
        <label className="block"><span className="label">Output $ / M tokens</span>
          <input className="input w-full" type="number" min={0} step="0.01" value={form.output_price ?? 0}
                 onChange={e => set({ output_price: Number(e.target.value) })} />
        </label>
      </div>
      <div className="col-span-2 flex justify-end">
        <button className="btn-primary flex items-center gap-1" disabled={busy}
                onClick={() => onSubmit({ ...form, api_key: form.api_key || undefined })}>
          <Save size={14} /> {submitLabel}
        </button>
      </div>
    </div>
  )
}

function ProviderCard({ provider }: { provider: AgentProvider }) {
  const qc = useQueryClient()
  const [editing, setEditing] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const refresh = () => qc.invalidateQueries({ queryKey: ['agent-providers'] })

  const health = useMutation({ mutationFn: () => agentsApi.health(provider.name) })
  const update = useMutation({
    mutationFn: (data: AgentProviderWrite) => agentsApi.updateProvider(provider.id, data),
    onSuccess: () => { setEditing(false); setError(null); refresh() },
    onError: e => setError(errorText(e, 'The provider could not be saved')),
  })
  const remove = useMutation({
    mutationFn: () => agentsApi.deleteProvider(provider.id),
    onSuccess: refresh,
    onError: e => setError(errorText(e, 'The provider could not be removed')),
  })

  return (
    <div className="border border-hairline bg-panel p-4 space-y-3">
      <div className="flex items-center gap-2 flex-wrap">
        <span className="text-ui font-semibold font-mono text-fg">{provider.name}</span>
        <span className="text-label px-2 py-0.5 border border-hairline rounded-control text-fg-secondary">
          {provider.kind === 'anthropic' ? 'Anthropic' : 'OpenAI-compatible'}
        </span>
        <span className={`text-label px-2 py-0.5 border rounded-control ${provider.locality === 'local'
          ? 'border-agent-thinking/30 text-agent-thinking' : 'border-agent-waiting/30 text-agent-waiting'}`}>
          {provider.locality}
        </span>
        <label className="ml-auto flex items-center gap-2 text-label text-fg-secondary">
          <input type="checkbox" checked={provider.enabled}
                 onChange={e => update.mutate({ enabled: e.target.checked })} />
          Enabled
        </label>
      </div>
      <p className="text-label font-mono text-fg-muted break-all">
        {provider.base_url || 'Claude API'} · model {provider.default_model || '(none)'} ·
        key {provider.has_key ? `…${provider.key_hint}` : 'none'} ·
        ${provider.input_price} / ${provider.output_price} per M tokens ·
        updated {fmtDateTimeShort(provider.updated_at)} by {provider.updated_by}
      </p>
      {health.data && (
        <p className={`flex items-center gap-1 text-label ${health.data.reachable ? 'text-agent-thinking' : 'text-agent-error'}`}>
          {health.data.reachable ? <CheckCircle2 size={12} /> : <XCircle size={12} />}
          {health.data.reachable ? `Reachable, ${health.data.models.length} model(s)` : health.data.detail}
        </p>
      )}
      {error && <p className="text-label text-agent-error">{error}</p>}
      {editing && (
        <ProviderForm isNew={false} busy={update.isPending} submitLabel="Save"
                      initial={{ base_url: provider.base_url, locality: provider.locality,
                                 default_model: provider.default_model, input_price: provider.input_price,
                                 output_price: provider.output_price, kind: provider.kind }}
                      onSubmit={data => update.mutate(data)} />
      )}
      <div className="flex items-center gap-2">
        <button className="btn-secondary flex items-center gap-1" disabled={health.isPending}
                onClick={() => health.mutate()}>
          {health.isPending ? <Loader2 size={14} className="animate-spin" /> : <FlaskConical size={14} />} Test
        </button>
        <button className="btn-ghost" onClick={() => setEditing(v => !v)}>{editing ? 'Cancel' : 'Edit'}</button>
        <button className="btn-ghost ml-auto flex items-center gap-1 text-agent-error"
                onClick={() => { if (window.confirm(`Remove ${provider.name}? Agents on it stop working.`)) remove.mutate() }}>
          <Trash2 size={14} /> Remove
        </button>
      </div>
    </div>
  )
}

function RoleModelRow({ row, providers }: { row: RoleModel; providers: string[] }) {
  const qc = useQueryClient()
  const [provider, setProvider] = useState(row.provider)
  const [model, setModel] = useState(row.model)
  const refresh = () => qc.invalidateQueries({ queryKey: ['agent-role-models'] })
  const save = useMutation({ mutationFn: () => agentsApi.setRoleModel(row.role, provider, model), onSuccess: refresh })
  const reset = useMutation({ mutationFn: () => agentsApi.clearRoleModel(row.role), onSuccess: refresh })
  return (
    <tr className="border-b border-hairline">
      <td className="py-2 pr-3 text-ui font-mono text-fg">{row.role}</td>
      <td className="py-2 pr-3">
        <select className="input" value={provider} onChange={e => setProvider(e.target.value)}>
          {providers.map(p => <option key={p} value={p}>{p}</option>)}
        </select>
      </td>
      <td className="py-2 pr-3">
        <input className="input w-full font-mono" value={model} placeholder="Provider default"
               onChange={e => setModel(e.target.value)} />
      </td>
      <td className="py-2 flex items-center gap-2">
        <button className="btn-secondary" disabled={save.isPending} onClick={() => save.mutate()}>Save</button>
        {row.custom && <button className="btn-ghost" onClick={() => reset.mutate()}>Default</button>}
      </td>
    </tr>
  )
}

/**
 * Where Charybdis agents run: the built-in local Ollama, and the providers an
 * administrator adds here. A case's TLP decides which of them may see its
 * data; this page only says where each one sends it.
 */
export default function AgentModels() {
  const qc = useQueryClient()
  const [adding, setAdding] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const { data: providers = [] } = useQuery({ queryKey: ['agent-providers'], queryFn: agentsApi.providers })
  const { data: roleModels = [] } = useQuery({ queryKey: ['agent-role-models'], queryFn: agentsApi.roleModels })
  const create = useMutation({
    mutationFn: (data: AgentProviderWrite) => agentsApi.createProvider(data),
    onSuccess: () => { setAdding(null); setError(null); qc.invalidateQueries({ queryKey: ['agent-providers'] }) },
    onError: e => setError(errorText(e, 'The provider could not be added')),
  })
  const choices = ['ollama', ...providers.filter(p => p.enabled).map(p => p.name)]

  return (
    <PageShell route="/config/agents" title="Agent models"
               meta={`${providers.length + 1} provider(s)`}
               subtitle="API keys are stored encrypted and never returned to the browser">
      <div className="max-w-3xl mx-auto space-y-6">
        <div className="border border-hairline bg-panel p-4">
          <p className="text-ui font-semibold font-mono text-fg">ollama</p>
          <p className="text-label text-fg-muted">
            Built in and local, set by OLLAMA_BASE_URL. Always allowed, whatever the case's TLP.
          </p>
        </div>

        {providers.map(p => <ProviderCard key={p.id} provider={p} />)}

        <div className="border border-dashed border-hairline p-4 space-y-3">
          <div className="flex items-center gap-2 flex-wrap">
            <Plus size={14} className="text-fg-muted" />
            <span className="text-ui text-fg">Add a provider</span>
            {Object.entries({ anthropic: 'Claude', openai: 'OpenAI', local: 'Local server' }).map(([key, label]) => (
              <button key={key} className={adding === key ? 'btn-secondary' : 'btn-ghost'}
                      onClick={() => setAdding(adding === key ? null : key)}>{label}</button>
            ))}
          </div>
          {error && <p className="text-label text-agent-error">{error}</p>}
          {adding && (
            <ProviderForm key={adding} isNew busy={create.isPending} submitLabel="Add"
                          initial={PRESETS[adding]} onSubmit={data => create.mutate(data)} />
          )}
        </div>

        <div className="space-y-2">
          <h2 className="text-title font-semibold text-fg">Model per role</h2>
          <p className="text-ui text-fg-secondary">
            What an agent of each role is staffed with. Agents already on a case keep theirs.
          </p>
          <table className="w-full">
            <tbody>
              {roleModels.map(r => <RoleModelRow key={`${r.role}-${r.provider}-${r.model}`} row={r} providers={choices} />)}
            </tbody>
          </table>
        </div>
      </div>
    </PageShell>
  )
}
