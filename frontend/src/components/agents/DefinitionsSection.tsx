import { useMemo, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { agentsApi } from '../../api/agents'
import type { AgentDefinition } from '../../types'
import { Plus, RotateCcw, Save } from '../../ui/icons'

type Kind = AgentDefinition['kind']

const KIND_LABEL: Record<Kind, string> = { role: 'Roles', process: 'Processes', prompt: 'Prompts' }

/** What a new definition starts from. A new role needs its prompt saved first. */
const STARTER: Record<Kind, (name: string) => string> = {
  role: name => `id: ${name}
name: ${name}
description: What this agent is for.
reports_to: incident-leader
prompt: ${name}.md
process: analyst-investigation
conversation_process: conversation
assignable: true
max_steps: 12
tools: [case_overview, list_evidence, ingest_status, list_artifacts, store_schema, store_search,
        list_iocs, list_timeline, list_findings, record_observation, propose_finding, propose_ioc,
        propose_timeline_event, propose_ttp, request_help]
`,
  process: name => `id: ${name}
description: What the process is for.
steps:
  - id: investigate
    instructions: What to do in this step.
  - id: report
    instructions: Report what you found and what is left.
`,
  prompt: () => 'You are ... on a DFIR case. Say what you read; never invent a value.\n',
}

function errorText(e: unknown): string {
  const detail = (e as { response?: { data?: { detail?: unknown } } })?.response?.data?.detail
  return typeof detail === 'string' ? detail : 'The definition could not be saved'
}

/**
 * The roles, processes and prompts the agents follow, editable as YAML. A
 * change is loaded with every other definition before it is kept, so an
 * edit that would break a role is refused with the reason. Edits live in the
 * database, over the files of templates/agents, and can be reverted.
 */
export default function DefinitionsSection() {
  const qc = useQueryClient()
  const { data: definitions = [] } = useQuery({ queryKey: ['agent-definitions'], queryFn: agentsApi.definitions })
  const [selected, setSelected] = useState<{ kind: Kind; name: string } | null>(null)
  const [draft, setDraft] = useState('')
  const [creating, setCreating] = useState<{ kind: Kind; name: string } | null>(null)
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null)

  const current = useMemo(
    () => definitions.find(d => selected && d.kind === selected.kind && d.name === selected.name),
    [definitions, selected])

  const refresh = () => {
    qc.invalidateQueries({ queryKey: ['agent-definitions'] })
    qc.invalidateQueries({ queryKey: ['agent-roles'] })
  }
  const save = useMutation({
    mutationFn: ({ kind, name, content }: { kind: Kind; name: string; content: string }) =>
      agentsApi.saveDefinition(kind, name, content),
    onSuccess: d => { refresh(); setSelected({ kind: d.kind, name: d.name }); setCreating(null)
                      setMessage({ ok: true, text: `${d.name} saved. New tasks use it.` }) },
    onError: e => setMessage({ ok: false, text: errorText(e) }),
  })
  const revert = useMutation({
    mutationFn: (d: AgentDefinition) => agentsApi.revertDefinition(d.kind, d.name),
    onSuccess: (_, d) => {
      refresh()
      if (d.origin === 'custom') setSelected(null)
      setMessage({ ok: true, text: d.origin === 'custom' ? `${d.name} removed.` : `${d.name} is back to its file.` })
    },
    onError: e => setMessage({ ok: false, text: errorText(e) }),
  })

  const open = (d: AgentDefinition) => {
    setSelected({ kind: d.kind, name: d.name }); setDraft(d.content); setCreating(null); setMessage(null)
  }
  const startNew = (kind: Kind) => { setCreating({ kind, name: '' }); setSelected(null); setMessage(null) }

  const editing = creating ?? (current ? { kind: current.kind, name: current.name } : null)
  const newName = creating ? (creating.kind === 'prompt' && creating.name && !creating.name.endsWith('.md')
    ? `${creating.name}.md` : creating.name) : ''

  return (
    <div className="space-y-2">
      <h2 className="text-title font-semibold text-fg">Roles and processes</h2>
      <p className="text-ui text-fg-secondary">
        What each agent is told, which tools it holds and the steps it follows. Changes apply to tasks
        started after saving.
      </p>
      <div className="grid grid-cols-[14rem_minmax(0,1fr)] gap-3">
        <div className="border border-hairline bg-panel max-h-[32rem] overflow-auto">
          {(['role', 'process', 'prompt'] as Kind[]).map(kind => (
            <div key={kind}>
              <div className="flex items-center px-3 pt-2 pb-1">
                <span className="label flex-1">{KIND_LABEL[kind]}</span>
                <button className="btn-ghost" aria-label={`New ${kind}`} onClick={() => startNew(kind)}>
                  <Plus size={12} />
                </button>
              </div>
              {definitions.filter(d => d.kind === kind).map(d => (
                <button key={`${d.kind}-${d.name}`} onClick={() => open(d)}
                        className={`w-full flex items-center gap-2 px-3 py-1 text-left text-label font-mono ${
                          selected?.kind === d.kind && selected.name === d.name ? 'bg-accent/10 text-fg' : 'text-fg-secondary hover:bg-fg/5'}`}>
                  <span className="truncate flex-1">{d.name}</span>
                  {d.origin !== 'builtin' && <span className="text-agent-waiting">{d.origin}</span>}
                </button>
              ))}
            </div>
          ))}
        </div>

        <div className="space-y-2 min-w-0">
          {!editing && <p className="text-label text-fg-muted">Pick a definition to read or change it.</p>}
          {creating && (
            <label className="block"><span className="label">New {creating.kind} name</span>
              <input className="input w-full font-mono" value={creating.name}
                     placeholder={creating.kind === 'prompt' ? 'analyst-cloud.md' : 'analyst-cloud'}
                     onChange={e => { setCreating({ ...creating, name: e.target.value })
                                      setDraft(STARTER[creating.kind](e.target.value.replace(/\.md$/, ''))) }} />
            </label>
          )}
          {editing && (
            <>
              <textarea className="input w-full font-mono text-label resize-y" rows={22} spellCheck={false}
                        value={draft} onChange={e => setDraft(e.target.value)} />
              <div className="flex items-center gap-2">
                {message && (
                  <p className={`text-label flex-1 whitespace-pre-wrap ${message.ok ? 'text-agent-thinking' : 'text-agent-error'}`}>
                    {message.text}
                  </p>
                )}
                <div className="ml-auto flex items-center gap-2">
                  {current && current.origin !== 'builtin' && (
                    <button className="btn-secondary flex items-center gap-1" disabled={revert.isPending}
                            onClick={() => window.confirm(current.origin === 'custom'
                              ? `Remove ${current.name}?` : `Put ${current.name} back to its file?`) && revert.mutate(current)}>
                      <RotateCcw size={14} /> {current.origin === 'custom' ? 'Remove' : 'Revert'}
                    </button>
                  )}
                  <button className="btn-primary flex items-center gap-1"
                          disabled={save.isPending || (creating !== null && !newName)}
                          onClick={() => save.mutate({ kind: editing.kind, name: creating ? newName : editing.name,
                                                       content: draft })}>
                    <Save size={14} /> Save
                  </button>
                </div>
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  )
}
