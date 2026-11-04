import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { agentsApi } from '../../api/agents'
import type { McpServer, McpServerWrite } from '../../types'
import { CheckCircle2, Loader2, Plus, Trash2, XCircle } from '../../ui/icons'

function errorText(e: unknown, fallback: string): string {
  const detail = (e as { response?: { data?: { detail?: unknown } } })?.response?.data?.detail
  return typeof detail === 'string' ? detail : fallback
}

const EMPTY: McpServerWrite = { name: '', url: '', locality: 'local', authorization: '', description: '' }

function ServerCard({ server }: { server: McpServer }) {
  const qc = useQueryClient()
  const [error, setError] = useState<string | null>(null)
  const refresh = () => qc.invalidateQueries({ queryKey: ['agent-mcp-servers'] })
  const toggle = useMutation({
    mutationFn: () => agentsApi.updateMcpServer(server.id, { enabled: !server.enabled }),
    onSuccess: refresh, onError: e => setError(errorText(e, 'The server could not be changed')),
  })
  const remove = useMutation({
    mutationFn: () => agentsApi.deleteMcpServer(server.id),
    onSuccess: refresh, onError: e => setError(errorText(e, 'The server could not be removed')),
  })
  const test = useMutation({ mutationFn: () => agentsApi.mcpServerTools(server.id) })
  return (
    <div className="border border-hairline bg-panel p-4 space-y-2">
      <div className="flex items-center gap-2">
        <span className="text-ui font-semibold font-mono text-fg">{server.name}</span>
        <span className="text-label text-fg-muted">{server.locality}</span>
        {!server.enabled && <span className="text-label text-agent-error">disabled</span>}
        <div className="ml-auto flex items-center gap-2">
          <button className="btn-ghost" disabled={test.isPending} onClick={() => test.mutate()}>
            {test.isPending ? <Loader2 size={14} className="animate-spin" /> : 'Test'}
          </button>
          <button className="btn-ghost" disabled={toggle.isPending} onClick={() => toggle.mutate()}>
            {server.enabled ? 'Disable' : 'Enable'}
          </button>
          <button className="btn-ghost" disabled={remove.isPending} aria-label="Remove"
                  onClick={() => window.confirm(`Remove ${server.name}?`) && remove.mutate()}>
            <Trash2 size={14} />
          </button>
        </div>
      </div>
      <p className="text-label font-mono text-fg-secondary break-all">{server.url}</p>
      {server.description && <p className="text-ui text-fg-secondary">{server.description}</p>}
      <p className="text-label text-fg-muted">
        {server.has_authorization ? 'Authorization header set' : 'No authorization header'} · by {server.updated_by}
      </p>
      {error && <p className="text-label text-agent-error">{error}</p>}
      {test.data && (
        <div className="text-label space-y-1">
          <p className={`flex items-center gap-1 ${test.data.reachable ? 'text-agent-thinking' : 'text-agent-error'}`}>
            {test.data.reachable ? <CheckCircle2 size={12} /> : <XCircle size={12} />}
            {test.data.reachable ? `${test.data.tools.length} tool(s)` : test.data.detail}
          </p>
          {test.data.tools.map(t => (
            <p key={t.name} className="text-fg-secondary">
              <span className="font-mono text-fg">{t.name}</span> {t.description}
            </p>
          ))}
        </div>
      )}
    </div>
  )
}

/**
 * Third-party MCP servers the agents may call. Every call is held for an
 * analyst's approval, and a cloud server is refused on a TLP RED or
 * AMBER+STRICT case.
 */
export default function McpServersSection() {
  const qc = useQueryClient()
  const [form, setForm] = useState<McpServerWrite | null>(null)
  const [error, setError] = useState<string | null>(null)
  const { data: servers = [] } = useQuery({ queryKey: ['agent-mcp-servers'], queryFn: agentsApi.mcpServers })
  const create = useMutation({
    mutationFn: (data: McpServerWrite) => agentsApi.createMcpServer(data),
    onSuccess: () => { setForm(null); setError(null); qc.invalidateQueries({ queryKey: ['agent-mcp-servers'] }) },
    onError: e => setError(errorText(e, 'The server could not be added')),
  })
  const set = (patch: Partial<McpServerWrite>) => setForm(f => ({ ...(f ?? EMPTY), ...patch }))

  return (
    <div className="space-y-2">
      <h2 className="text-title font-semibold text-fg">MCP servers</h2>
      <p className="text-ui text-fg-secondary">
        Tools outside Remora the agents may call. Each call waits for an analyst's approval in the
        case's Team tab; a cloud server is never called on a TLP RED or AMBER+STRICT case.
      </p>
      {servers.map(s => <ServerCard key={s.id} server={s} />)}
      <div className="border border-dashed border-hairline p-4 space-y-3">
        <button className="flex items-center gap-2 text-ui text-fg" onClick={() => setForm(form ? null : EMPTY)}>
          <Plus size={14} className="text-fg-muted" /> Add a server
        </button>
        {error && <p className="text-label text-agent-error">{error}</p>}
        {form && (
          <div className="grid grid-cols-2 gap-3">
            <label className="block"><span className="label">Name</span>
              <input className="input w-full font-mono" value={form.name ?? ''} placeholder="threat-intel"
                     onChange={e => set({ name: e.target.value })} />
            </label>
            <label className="block"><span className="label">Where it runs</span>
              <select className="input w-full" value={form.locality}
                      onChange={e => set({ locality: e.target.value as 'local' | 'cloud' })}>
                <option value="local">local</option>
                <option value="cloud">cloud</option>
              </select>
            </label>
            <label className="block col-span-2"><span className="label">URL</span>
              <input className="input w-full font-mono" value={form.url ?? ''} placeholder="https://mcp.example.org/mcp"
                     onChange={e => set({ url: e.target.value })} />
            </label>
            <label className="block col-span-2"><span className="label">Authorization header (optional)</span>
              <input className="input w-full font-mono" type="password" value={form.authorization ?? ''}
                     placeholder="Bearer ..." onChange={e => set({ authorization: e.target.value })} />
            </label>
            <label className="block col-span-2"><span className="label">What it is for</span>
              <input className="input w-full" value={form.description ?? ''}
                     onChange={e => set({ description: e.target.value })} />
            </label>
            <div className="col-span-2 flex justify-end">
              <button className="btn-primary" disabled={create.isPending} onClick={() => create.mutate(form)}>Add</button>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
