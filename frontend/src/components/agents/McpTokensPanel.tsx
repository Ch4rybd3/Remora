import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { agentsApi } from '../../api/agents'
import type { McpToken } from '../../types'
import { fmtDateTimeShort } from '../../utils/dateUtils'
import { CopyButton } from '../custody/CustodyActions'
import { Panel, PanelHeader } from '../../ui/Panel'
import { Plus, Trash2 } from '../../ui/icons'

/**
 * Personal tokens for MCP clients - Claude Code, an IDE - to read cases as you,
 * with your permissions and client scope, each call in the audit log. Only
 * read tools are offered, and TLP:RED and AMBER+STRICT cases stay unreadable.
 */
export default function McpTokensPanel() {
  const qc = useQueryClient()
  const [name, setName] = useState('')
  const [created, setCreated] = useState<McpToken | null>(null)
  const { data: tokens = [] } = useQuery({ queryKey: ['mcp-tokens'], queryFn: agentsApi.mcpTokens })
  const create = useMutation({
    mutationFn: () => agentsApi.createMcpToken(name.trim()),
    onSuccess: token => { setCreated(token); setName(''); qc.invalidateQueries({ queryKey: ['mcp-tokens'] }) },
  })
  const revoke = useMutation({
    mutationFn: (id: string) => agentsApi.revokeMcpToken(id),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['mcp-tokens'] }),
  })
  const endpoint = `${window.location.origin}/api/v1/agents/mcp`
  const command = created?.token
    ? `claude mcp add --transport http remora ${endpoint} --header "Authorization: Bearer ${created.token}"`
    : ''

  return (
    <Panel>
      <PanelHeader title="MCP clients" />
      <div className="p-4 space-y-3">
        <p className="text-ui text-fg-secondary">
          Let an MCP client such as Claude Code read your cases through Remora's tools, as you.
          Every call is in the audit log. TLP:RED and AMBER+STRICT cases are not readable this way:
          such a client usually sends what it reads to a cloud model.
        </p>
        <div className="flex items-center gap-2">
          <input className="input flex-1" placeholder="Token name, e.g. Claude Code on my laptop"
                 value={name} onChange={e => setName(e.target.value)} />
          <button className="btn-secondary flex items-center gap-1" disabled={!name.trim() || create.isPending}
                  onClick={() => create.mutate()}>
            <Plus size={14} /> Create
          </button>
        </div>
        {command && (
          <div className="border border-accent/30 bg-accent/5 p-3 space-y-2">
            <p className="text-label text-fg">Copy it now: the token is not shown again. To add it to Claude Code:</p>
            <div className="flex items-start gap-2">
              <code className="flex-1 text-label font-mono text-fg break-all">{command}</code>
              <CopyButton value={command} />
            </div>
          </div>
        )}
        <ul className="divide-y divide-hairline">
          {tokens.map(t => (
            <li key={t.id} className="flex items-center gap-2 py-2">
              <span className="text-ui text-fg">{t.name}</span>
              <span className="text-label font-mono text-fg-muted">{t.prefix}…</span>
              <span className="text-label text-fg-muted ml-auto">
                {t.revoked_at ? `revoked ${fmtDateTimeShort(t.revoked_at)}`
                  : t.last_used_at ? `used ${fmtDateTimeShort(t.last_used_at)}` : 'never used'}
              </span>
              {!t.revoked_at && (
                <button className="btn-ghost text-agent-error" aria-label={`Revoke ${t.name}`}
                        onClick={() => revoke.mutate(t.id)}>
                  <Trash2 size={14} />
                </button>
              )}
            </li>
          ))}
        </ul>
      </div>
    </Panel>
  )
}
